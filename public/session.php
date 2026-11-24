<?php
/*
 * Keeps you signed in to Maillo on a device, without a new Google sign-in every hour.
 *
 * Signing in with features.staySignedIn hands this file a one-time Google authorization code.
 * It trades the code for a refresh token, which stays on the server (encrypted). The browser
 * only gets an HttpOnly cookie, and asks here for a fresh one-hour access token when it needs one.
 *
 * Actions (POST, with the X-Maillo header so other sites can't call it):
 *   ready          whether the client secret is set up, so sign-in can use this file
 *   exchange       trade an authorization code (code) for a session
 *   token          a fresh access token for this device's session
 *   signout        forget this device's session and revoke its refresh token
 *   secret_status  whether the OAuth client secret is stored (token required)
 *   set_secret     store the OAuth client secret (token, secret)
 *   remove_secret  delete the stored secret and every session (token)
 *
 * The client secret comes from maillo-config.php (googleClientSecret) if it's set there, else a
 * GOOGLE_CLIENT_SECRET environment variable, else the one saved from Settings in .maillo-oauth.php.
 * The encryption key lives in .maillo-oauth.php; sessions in .maillo-sessions/. Neither is ever
 * served, backed up or replaced by updates.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require __DIR__ . '/maillo-common.php';

const COOKIE = 'maillo_session';
const SESSION_DAYS = 180;

$root = __DIR__;
$secretFile = $root . '/.maillo-oauth.php';
$sessionDir = $root . '/.maillo-sessions';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'method_not_allowed');
}
// A custom header forces a CORS preflight, so pages on other sites can't use the cookie.
if (($_SERVER['HTTP_X_MAILLO'] ?? '') !== '1') {
    fail(403, 'bad_request');
}

$cfg = read_config($root);
if (!$cfg['staySignedIn']) {
    fail(403, 'disabled');
}

function oauth_store(string $file): array
{
    $data = is_file($file) ? include $file : null;
    return is_array($data) ? $data : [];
}

/** The OAuth client secret and where it came from: maillo-config.php, the environment, or Settings. */
function secret_info(array $cfg, string $file): array
{
    return pick_secret($cfg['clientSecret'], 'GOOGLE_CLIENT_SECRET', (string) (oauth_store($file)['secret'] ?? ''));
}

function client_secret(array $cfg, string $file): string
{
    return secret_info($cfg, $file)[0];
}

/** The key that encrypts refresh tokens at rest, created the first time it's needed. */
function crypto_key(string $file): string
{
    global $cfg;
    $fixed = session_key_override($cfg);
    if ($fixed !== '') {
        return $fixed;
    }
    $data = oauth_store($file);
    $key = base64_decode((string) ($data['key'] ?? ''), true);
    if (is_string($key) && strlen($key) === 32) {
        return $key;
    }
    $data['key'] = base64_encode(random_bytes(32));
    save_store($file, $data);
    return base64_decode($data['key'], true);
}

function save_store(string $file, array $data): void
{
    $php = "<?php\n// Maillo sign-in secrets. Do not share this file.\nreturn " . var_export($data, true) . ";\n";
    if (@file_put_contents($file, $php, LOCK_EX) === false) {
        fail(500, 'not_writable');
    }
    @chmod($file, 0600);
}

function seal(string $plain, string $key): string
{
    if (!function_exists('openssl_encrypt')) {
        fail(500, 'no_crypto');
    }
    $iv = random_bytes(12);
    $tag = '';
    $c = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $c);
}

function unseal(string $sealed, string $key): string
{
    $raw = base64_decode($sealed, true);
    if (!is_string($raw) || strlen($raw) < 29 || !function_exists('openssl_decrypt')) {
        return '';
    }
    $p = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return is_string($p) ? $p : '';
}

function session_path(string $dir, string $sid): string
{
    return $dir . '/' . hash('sha256', $sid) . '.php';
}

function ensure_dir(string $dir): void
{
    if (!is_dir($dir) && !@mkdir($dir, 0700)) {
        fail(500, 'not_writable');
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    }
}

function read_session(string $dir): ?array
{
    $sid = (string) ($_COOKIE[COOKIE] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $sid)) {
        return null;
    }
    $file = session_path($dir, $sid);
    $data = is_file($file) ? include $file : null;
    if (!is_array($data) || (int) ($data['used'] ?? 0) < time() - SESSION_DAYS * 86400) {
        return null;
    }
    return $data + ['sid' => $sid, 'file' => $file];
}

function write_session(string $file, array $data): void
{
    unset($data['sid'], $data['file']);
    $php = "<?php\nreturn " . var_export($data, true) . ";\n";
    if (@file_put_contents($file, $php, LOCK_EX) === false) {
        fail(500, 'not_writable');
    }
    @chmod($file, 0600);
}

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
        return true;
    }
    return strpos((string) ($_SERVER['HTTP_CF_VISITOR'] ?? ''), 'https') !== false;
}

function set_cookie(string $value, int $expires): void
{
    $path = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
    setcookie(COOKIE, $value, [
        'expires' => $expires,
        'path' => $path,
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function prune(string $dir): void
{
    if (random_int(1, 20) !== 1) {
        return;
    }
    foreach (glob($dir . '/*.php') ?: [] as $f) {
        if (filemtime($f) < time() - SESSION_DAYS * 86400) {
            @unlink($f);
        }
    }
}

/** Asks Google for an access token; returns [http code, response]. */
function token_call(array $fields): array
{
    return http_post_form('https://oauth2.googleapis.com/token', $fields);
}

$action = (string) ($_POST['action'] ?? '');

// Whether signing in here can work at all (only says yes or no, nothing about any account).
if ($action === 'ready') {
    out(200, ['ok' => true, 'configured' => client_secret($cfg, $secretFile) !== '' && function_exists('openssl_encrypt')]);
}

if ($action === 'exchange') {
    $secret = client_secret($cfg, $secretFile);
    if ($secret === '') {
        fail(409, 'no_secret');
    }
    $code = (string) ($_POST['code'] ?? '');
    if ($code === '' || strlen($code) > 1024) {
        fail(400, 'no_code');
    }
    [$status, $res] = token_call([
        'code' => $code,
        'client_id' => $cfg['clientId'],
        'client_secret' => $secret,
        // Codes from Google's sign-in popup use this special redirect.
        'redirect_uri' => 'postmessage',
        'grant_type' => 'authorization_code',
    ]);
    if ($status !== 200 || !is_array($res) || empty($res['access_token'])) {
        fail(401, 'exchange_failed', ['detail' => is_array($res) ? (string) ($res['error'] ?? '') : '']);
    }
    $email = check_account($cfg, (string) $res['access_token']);
    $refresh = (string) ($res['refresh_token'] ?? '');
    $persistent = false;
    if ($refresh !== '') {
        ensure_dir($sessionDir);
        $sid = bin2hex(random_bytes(32));
        write_session(session_path($sessionDir, $sid), [
            'email' => $email,
            'rt' => seal($refresh, crypto_key($secretFile)),
            'created' => time(),
            'used' => time(),
        ]);
        set_cookie($sid, time() + SESSION_DAYS * 86400);
        prune($sessionDir);
        $persistent = true;
    }
    out(200, [
        'ok' => true,
        'access_token' => (string) $res['access_token'],
        'expires_in' => (int) ($res['expires_in'] ?? 3600),
        'scope' => (string) ($res['scope'] ?? ''),
        'email' => $email,
        'persistent' => $persistent,
    ]);
}

if ($action === 'token') {
    $s = read_session($sessionDir);
    if (!$s) {
        fail(401, 'no_session');
    }
    $secret = client_secret($cfg, $secretFile);
    $refresh = unseal((string) ($s['rt'] ?? ''), crypto_key($secretFile));
    if ($secret === '' || $refresh === '') {
        @unlink($s['file']);
        set_cookie('', time() - 3600);
        fail(401, 'no_session');
    }
    [$status, $res] = token_call([
        'refresh_token' => $refresh,
        'client_id' => $cfg['clientId'],
        'client_secret' => $secret,
        'grant_type' => 'refresh_token',
    ]);
    if ($status === 400 || $status === 401) {
        // Revoked, expired or the password changed: this device has to sign in again.
        @unlink($s['file']);
        set_cookie('', time() - 3600);
        fail(401, 'no_session');
    }
    if ($status !== 200 || !is_array($res) || empty($res['access_token'])) {
        fail(502, 'google_unreachable');
    }
    // The allowed-accounts list may have changed since this session started.
    $email = strtolower((string) $s['email']);
    $domain = substr((string) strrchr($email, '@'), 1);
    if (($cfg['accounts'] || $cfg['domains']) && !in_array($email, $cfg['accounts'], true) && !in_array($domain, $cfg['domains'], true)) {
        @unlink($s['file']);
        set_cookie('', time() - 3600);
        fail(403, 'not_allowed');
    }
    $s['used'] = time();
    write_session($s['file'], $s);
    set_cookie($s['sid'], time() + SESSION_DAYS * 86400);
    out(200, [
        'ok' => true,
        'access_token' => (string) $res['access_token'],
        'expires_in' => (int) ($res['expires_in'] ?? 3600),
        'scope' => (string) ($res['scope'] ?? ''),
        'email' => $email,
    ]);
}

if ($action === 'signout') {
    $s = read_session($sessionDir);
    if ($s) {
        $refresh = unseal((string) ($s['rt'] ?? ''), crypto_key($secretFile));
        if ($refresh !== '') {
            http_post_form('https://oauth2.googleapis.com/revoke', ['token' => $refresh]);
        }
        @unlink($s['file']);
    }
    set_cookie('', time() - 3600);
    out(200, ['ok' => true]);
}

if ($action === 'secret_status' || $action === 'set_secret' || $action === 'remove_secret') {
    authorize($cfg);
    $fixed = in_array(secret_info($cfg, $secretFile)[1], ['config', 'environment'], true);
    if ($fixed && $action !== 'secret_status') {
        // Set in maillo-config.php or by the host: change it there.
        fail(409, 'secret_fixed');
    }
    if ($action === 'set_secret') {
        $secret = trim((string) ($_POST['secret'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_\-]{10,128}$/', $secret)) {
            fail(400, 'invalid_secret');
        }
        // Google answers "invalid_grant" (not "invalid_client") when the secret matches the client.
        [, $res] = token_call([
            'code' => 'maillo-check',
            'client_id' => $cfg['clientId'],
            'client_secret' => $secret,
            'redirect_uri' => 'postmessage',
            'grant_type' => 'authorization_code',
        ]);
        if (is_array($res) && ($res['error'] ?? '') === 'invalid_client') {
            fail(400, 'secret_rejected');
        }
        $data = oauth_store($secretFile);
        $data['secret'] = $secret;
        $data['saved'] = gmdate('c');
        save_store($secretFile, $data);
    }
    if ($action === 'remove_secret') {
        if (is_file($secretFile) && !@unlink($secretFile)) {
            fail(500, 'not_writable');
        }
        // Without the secret, stored sessions can't be used; drop them.
        foreach (glob($sessionDir . '/*.php') ?: [] as $f) {
            @unlink($f);
        }
    }
    [$secret, $source] = secret_info($cfg, $secretFile);
    out(200, [
        'ok' => true,
        'configured' => $secret !== '',
        'source' => $source ?: 'stored',
        'writable' => is_writable($root),
        'crypto' => function_exists('openssl_encrypt'),
    ]);
}

fail(400, 'unknown_action');
