<?php
/*
 * New mail within seconds, and notifications while Maillo is closed (features.push).
 *
 * Gmail tells Google Cloud Pub/Sub when a mailbox changes (users.watch); Pub/Sub posts that here.
 * This file then asks Gmail what's new, using the refresh token session.php keeps for the account
 * (so features.staySignedIn is needed too), and sends a web push to each device that turned on
 * notifications, following that device's notification rules. Push messages are encrypted for the
 * device (RFC 8291) and signed with this install's own VAPID key (RFC 8292); no third party sees them.
 *
 * Requests:
 *   POST ?key=…                from Pub/Sub (the key is this install's own, shown in Settings)
 *   GET  ?renew=…              renews every mailbox watch that's due (for a daily cron job; same key)
 *   POST action=status         push setup for this account (token)
 *   POST action=subscribe      this device's push subscription and rules (token, subscription, prefs)
 *   POST action=prefs          update this device's rules (token, endpoint, prefs)
 *   POST action=unsubscribe    forget this device (token, endpoint)
 *   POST action=test           send a test notification to this device (token, endpoint)
 *
 * Kept in .maillo-push/ (never served, backed up or replaced by updates): the endpoint key, the
 * VAPID key pair, and per account the watch, the last history id seen and each device's subscription.
 */
declare(strict_types=1);

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require __DIR__ . '/maillo-common.php';

const PUSH_TTL = 86400;
const MAX_DEVICES = 20;
// Mail older than this when it's first seen doesn't notify (a watch that lapsed for days, say).
const MAX_AGE = 2 * 86400;

$root = __DIR__;
$dir = $root . '/.maillo-push';

/* ---------- storage ---------- */

function php_read(string $file): array
{
    $data = is_file($file) ? include $file : null;
    return is_array($data) ? $data : [];
}

function php_write(string $file, array $data): void
{
    $php = "<?php\n// Maillo push data. Do not share this file.\nreturn " . var_export($data, true) . ";\n";
    if (@file_put_contents($file, $php, LOCK_EX) === false) {
        fail(500, 'not_writable');
    }
    @chmod($file, 0600);
}

function push_dir(string $dir): void
{
    if (!is_dir($dir) && !@mkdir($dir, 0700)) {
        fail(500, 'not_writable');
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    }
}

/** The endpoint key and VAPID keys, created the first time they're needed. */
function push_state(string $dir): array
{
    push_dir($dir);
    $file = $dir . '/state.php';
    $s = php_read($file);
    $changed = false;
    if (empty($s['key'])) {
        $s['key'] = bin2hex(random_bytes(24));
        $changed = true;
    }
    if (empty($s['vapidPrivate']) || empty($s['vapidPublic'])) {
        if (!function_exists('openssl_pkey_new')) {
            fail(500, 'no_crypto');
        }
        $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if (!$k || !openssl_pkey_export($k, $pem)) {
            fail(500, 'no_crypto');
        }
        $d = openssl_pkey_get_details($k);
        $s['vapidPrivate'] = $pem;
        $s['vapidPublic'] = b64u("\x04" . pad32($d['ec']['x']) . pad32($d['ec']['y']));
        $changed = true;
    }
    if ($changed) {
        php_write($file, $s);
    }
    return $s;
}

function account_file(string $dir, string $email): string
{
    return $dir . '/acct-' . hash('sha256', strtolower($email)) . '.php';
}

/** Runs $fn with the account's data locked, and saves what it returns (null: no change). */
function with_account(string $dir, string $email, callable $fn)
{
    push_dir($dir);
    $file = account_file($dir, $email);
    $fh = fopen($file . '.lock', 'c');
    if ($fh) {
        flock($fh, LOCK_EX);
    }
    try {
        $a = php_read($file) + ['email' => strtolower($email), 'devices' => [], 'seen' => []];
        $result = $fn($a);
        if (is_array($result)) {
            php_write($file, $result);
        }
        return $result;
    } finally {
        if ($fh) {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }
}

/* ---------- base64url, keys ---------- */

function b64u(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function unb64u(string $s): string
{
    return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
}

function pad32(string $n): string
{
    return str_pad($n, 32, "\0", STR_PAD_LEFT);
}

/** A raw uncompressed P-256 point as a PEM public key, for openssl. */
function p256_pem(string $point): string
{
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $point;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/** openssl's DER ECDSA signature as the 64-byte r||s that JWT ES256 wants. */
function der_to_raw(string $der): string
{
    $pos = 2;
    if (ord($der[1]) & 0x80) {
        $pos += ord($der[1]) & 0x7f;
    }
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$pos + 1]);
        $int = substr($der, $pos + 2, $len);
        $out .= pad32(ltrim($int, "\0"));
        $pos += 2 + $len;
    }
    return $out;
}

/* ---------- web push (RFC 8291 encryption, RFC 8292 VAPID) ---------- */

function hmac(string $key, string $data): string
{
    return hash_hmac('sha256', $data, $key, true);
}

/** Encrypts a payload for one browser subscription (aes128gcm). */
function encrypt_payload(string $payload, string $uaPublic, string $authSecret): string
{
    $eph = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    $d = openssl_pkey_get_details($eph);
    $asPublic = "\x04" . pad32($d['ec']['x']) . pad32($d['ec']['y']);
    $shared = openssl_pkey_derive(openssl_pkey_get_public(p256_pem($uaPublic)), $eph, 32);
    if (!is_string($shared)) {
        throw new RuntimeException('ecdh');
    }
    $ikm = hmac(hmac($authSecret, $shared), "WebPush: info\0" . $uaPublic . $asPublic . "\x01");
    $salt = random_bytes(16);
    $prk = hmac($salt, $ikm);
    $cek = substr(hmac($prk, "Content-Encoding: aes128gcm\0\x01"), 0, 16);
    $nonce = substr(hmac($prk, "Content-Encoding: nonce\0\x01"), 0, 12);
    $tag = '';
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(65) . $asPublic . $cipher . $tag;
}

function vapid_header(array $state, string $endpoint, string $subject): string
{
    $u = parse_url($endpoint);
    $claims = ['aud' => $u['scheme'] . '://' . $u['host'], 'exp' => time() + 12 * 3600, 'sub' => $subject];
    $input = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . b64u(json_encode($claims, JSON_UNESCAPED_SLASHES));
    openssl_sign($input, $der, $state['vapidPrivate'], OPENSSL_ALGO_SHA256);
    return 'vapid t=' . $input . '.' . b64u(der_to_raw($der)) . ', k=' . $state['vapidPublic'];
}

/** Sends one push; returns the push service's HTTP status (404/410: the subscription is gone). */
function send_push(array $state, array $device, array $message, string $subject): int
{
    $endpoint = (string) $device['endpoint'];
    $body = encrypt_payload(json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), unb64u((string) $device['p256dh']), unb64u((string) $device['auth']));
    $headers = [
        'Authorization: ' . vapid_header($state, $endpoint, $subject),
        'Content-Encoding: aes128gcm',
        'Content-Type: application/octet-stream',
        'TTL: ' . PUSH_TTL,
        'Urgency: high',
    ];
    if (function_exists('curl_init')) {
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $code;
    }
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body, 'timeout' => 10, 'ignore_errors' => true]]);
    @file_get_contents($endpoint, false, $ctx);
    return isset($http_response_header[0]) && preg_match('/\s(\d{3})/', $http_response_header[0], $m) ? (int) $m[1] : 0;
}

/** Push services accept only https endpoints on their own hosts; anything else is refused. */
function valid_endpoint(string $url): bool
{
    $u = parse_url($url);
    if (($u['scheme'] ?? '') !== 'https' || empty($u['host']) || strlen($url) > 1024) {
        return false;
    }
    $h = strtolower($u['host']);
    foreach (['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'] as $ok) {
        if ($h === $ok || substr($h, -strlen('.' . $ok)) === '.' . $ok) {
            return true;
        }
    }
    return false;
}

/* ---------- Google: tokens, watch, history ---------- */

/** The OAuth client secret: maillo-config.php, then the environment, then what Settings stored. */
function push_client_secret(array $cfg, string $root): string
{
    $stored = php_read($root . '/.maillo-oauth.php');
    if (function_exists('pick_secret')) {
        return pick_secret((string) ($cfg['clientSecret'] ?? ''), 'GOOGLE_CLIENT_SECRET', (string) ($stored['secret'] ?? ''))[0];
    }
    $env = getenv('GOOGLE_CLIENT_SECRET');
    return is_string($env) && $env !== '' ? $env : (string) ($stored['secret'] ?? '');
}

function unseal_rt(string $sealed, string $root, array $cfg): string
{
    $key = function_exists('session_key_override') ? session_key_override($cfg) : '';
    if ($key === '') {
        $key = base64_decode((string) (php_read($root . '/.maillo-oauth.php')['key'] ?? ''), true);
    }
    $raw = base64_decode($sealed, true);
    if (!is_string($key) || strlen($key) !== 32 || !is_string($raw) || strlen($raw) < 29) {
        return '';
    }
    $p = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return is_string($p) ? $p : '';
}

/** A fresh access token for an account, from the most recently used session.php session. */
function server_token(array $cfg, string $root, string $email): string
{
    $best = null;
    foreach (glob($root . '/.maillo-sessions/*.php') ?: [] as $f) {
        $s = php_read($f);
        if (strtolower((string) ($s['email'] ?? '')) === strtolower($email) && (!$best || (int) $s['used'] > (int) $best['used'])) {
            $best = $s;
        }
    }
    $secret = push_client_secret($cfg, $root);
    $rt = $best ? unseal_rt((string) ($best['rt'] ?? ''), $root, $cfg) : '';
    if ($rt === '' || $secret === '') {
        return '';
    }
    [$code, $res] = http_post_form('https://oauth2.googleapis.com/token', [
        'refresh_token' => $rt,
        'client_id' => $cfg['clientId'],
        'client_secret' => $secret,
        'grant_type' => 'refresh_token',
    ]);
    return $code === 200 && is_array($res) ? (string) ($res['access_token'] ?? '') : '';
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Starts or renews the mailbox watch: the Inbox, plus labels a device asked to hear about. */
function start_watch(array $cfg, string $token, array &$a): bool
{
    $labels = ['INBOX'];
    foreach ($a['devices'] as $d) {
        foreach ((array) ($d['prefs']['labels'] ?? []) as $l) {
            if (is_string($l) && preg_match('/^Label_[0-9A-Za-z_]+$/', $l)) {
                $labels[] = $l;
            }
        }
    }
    [$code, $res] = http_post_json(GMAIL . '/watch', [
        'topicName' => $cfg['pushTopic'],
        'labelIds' => array_values(array_unique($labels)),
        'labelFilterBehavior' => 'INCLUDE',
    ], ['Authorization: Bearer ' . $token]);
    if ($code !== 200 || !is_array($res)) {
        $a['watchError'] = is_array($res) ? (string) ($res['error']['message'] ?? $code) : (string) $code;
        return false;
    }
    unset($a['watchError']);
    $a['expiration'] = (int) round(((int) ($res['expiration'] ?? 0)) / 1000);
    $a['watched'] = time();
    if (empty($a['historyId'])) {
        $a['historyId'] = (string) ($res['historyId'] ?? '');
    }
    return true;
}

/** Google asks for a renewal at least weekly and suggests daily. */
function watch_due(array $a): bool
{
    return empty($a['expiration']) || (int) ($a['watched'] ?? 0) < time() - 86400 || (int) $a['expiration'] < time() + 2 * 86400;
}

function header_value(array $headers, string $name): string
{
    foreach ($headers as $h) {
        if (strcasecmp((string) ($h['name'] ?? ''), $name) === 0) {
            return (string) ($h['value'] ?? '');
        }
    }
    return '';
}

/** New, unread messages since the last history id seen; moves it forward. */
function new_mail(string $token, array &$a, string $upTo): array
{
    $start = (string) ($a['historyId'] ?? '');
    $a['historyId'] = $upTo !== '' && ($start === '' || (int) $upTo > (int) $start) ? $upTo : $start;
    if ($start === '') {
        return [];
    }
    [$code, $res] = http_get(GMAIL . '/history?' . http_build_query(['startHistoryId' => $start, 'historyTypes' => 'messageAdded', 'maxResults' => 100]), ['Authorization: Bearer ' . $token]);
    if ($code === 404) {
        // Too far back (Google keeps about a week): start over from now.
        return [];
    }
    if ($code !== 200 || !is_array($res)) {
        $a['historyId'] = $start;
        return [];
    }
    if (!empty($res['historyId']) && (int) $res['historyId'] > (int) $a['historyId']) {
        $a['historyId'] = (string) $res['historyId'];
    }
    $ids = [];
    foreach ((array) ($res['history'] ?? []) as $h) {
        foreach ((array) ($h['messagesAdded'] ?? []) as $m) {
            $msg = $m['message'] ?? [];
            $labels = (array) ($msg['labelIds'] ?? []);
            $id = (string) ($msg['id'] ?? '');
            if ($id === '' || in_array($id, $a['seen'], true) || !in_array('UNREAD', $labels, true) || array_intersect($labels, ['DRAFT', 'SENT', 'SPAM', 'TRASH', 'CHAT'])) {
                continue;
            }
            $ids[$id] = ['id' => $id, 'threadId' => (string) ($msg['threadId'] ?? ''), 'labels' => $labels];
        }
    }
    $ids = array_slice(array_values($ids), -10);
    $out = [];
    foreach ($ids as $i => $m) {
        $a['seen'][] = $m['id'];
        // Details for the last few only: more than three become one summary notification.
        if ($i < count($ids) - 4) {
            $out[] = $m + ['from' => '', 'fromEmail' => '', 'subject' => '', 'snippet' => '', 'date' => time()];
            continue;
        }
        [$c, $msg] = http_get(GMAIL . '/messages/' . rawurlencode($m['id']) . '?' . http_build_query(['format' => 'metadata', 'metadataHeaders' => 'From']) . '&metadataHeaders=Subject', ['Authorization: Bearer ' . $token]);
        if ($c !== 200 || !is_array($msg)) {
            continue;
        }
        $from = header_value((array) ($msg['payload']['headers'] ?? []), 'From');
        preg_match('/<([^>]+)>/', $from, $em);
        $out[] = array_merge($m, [
            'labels' => (array) ($msg['labelIds'] ?? $m['labels']),
            'from' => trim(preg_replace('/\s*<[^>]*>\s*$/', '', $from), " \"'") ?: $from,
            'fromEmail' => strtolower(trim($em[1] ?? $from)),
            'subject' => header_value((array) ($msg['payload']['headers'] ?? []), 'Subject'),
            'snippet' => html_entity_decode((string) ($msg['snippet'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
            'date' => (int) floor(((int) ($msg['internalDate'] ?? 0)) / 1000),
        ]);
    }
    $a['seen'] = array_slice($a['seen'], -300);
    return $out;
}

/* ---------- each device's notification rules (the same as in Settings → Notifications) ---------- */

function clean_prefs($p): array
{
    $p = is_array($p) ? $p : [];
    $list = function ($v, string $re) {
        return array_values(array_slice(array_filter(array_map('strval', is_array($v) ? $v : []), function ($x) use ($re) {
            return (bool) preg_match($re, $x);
        }), 0, 100));
    };
    $time = function ($v, string $d) {
        return is_string($v) && preg_match('/^\d{2}:\d{2}$/', $v) ? $v : $d;
    };
    return [
        'enabled' => !empty($p['enabled']),
        'scope' => in_array($p['scope'] ?? '', ['all', 'primary', 'important', 'none'], true) ? $p['scope'] : 'primary',
        'vips' => array_map('strtolower', $list($p['vips'] ?? [], '/^[^\s<>"]{1,200}$/')),
        'labels' => $list($p['labels'] ?? [], '/^Label_[0-9A-Za-z_]+$/'),
        'preview' => !empty($p['preview']),
        'sound' => !empty($p['sound']),
        'quiet' => !empty($p['quiet']),
        'quietFrom' => $time($p['quietFrom'] ?? '', '22:00'),
        'quietTo' => $time($p['quietTo'] ?? '', '07:00'),
        'tz' => is_string($p['tz'] ?? null) && in_array($p['tz'], timezone_identifiers_list(), true) ? $p['tz'] : 'UTC',
        'lang' => ($p['lang'] ?? '') === 'fr' ? 'fr' : 'en',
    ];
}

function in_quiet_hours(array $p): bool
{
    if (!$p['quiet'] || $p['quietFrom'] === $p['quietTo']) {
        return false;
    }
    $now = new DateTime('now', new DateTimeZone($p['tz']));
    $cur = (int) $now->format('G') * 60 + (int) $now->format('i');
    [$ah, $am] = array_map('intval', explode(':', $p['quietFrom']));
    [$bh, $bm] = array_map('intval', explode(':', $p['quietTo']));
    $a = $ah * 60 + $am;
    $b = $bh * 60 + $bm;
    return $a < $b ? $cur >= $a && $cur < $b : $cur >= $a || $cur < $b;
}

function wanted(array $p, array $m): bool
{
    $vip = false;
    foreach ($p['vips'] as $v) {
        $v = ltrim($v, '@');
        $vip = $vip || $m['fromEmail'] === $v || substr($m['fromEmail'], -strlen('@' . $v)) === '@' . $v;
    }
    if ($vip || array_intersect($p['labels'], $m['labels'])) {
        return true;
    }
    if (!in_array('INBOX', $m['labels'], true)) {
        return false;
    }
    switch ($p['scope']) {
        case 'all':
            return true;
        case 'primary':
            // Mailboxes without categories have no Primary label: everything there counts.
            return in_array('CATEGORY_PERSONAL', $m['labels'], true) || !array_filter($m['labels'], function ($l) {
                return strpos($l, 'CATEGORY_') === 0;
            });
        case 'important':
            return in_array('IMPORTANT', $m['labels'], true);
    }
    return false;
}

function message_for(array $p, array $items): array
{
    $silent = !$p['sound'];
    if (count($items) > 3) {
        $names = array_values(array_unique(array_filter(array_column($items, 'from'))));
        return [
            'type' => 'mail',
            'title' => $p['lang'] === 'fr' ? count($items) . ' nouveaux messages' : count($items) . ' new messages',
            'body' => implode(', ', array_slice($names, 0, 4)) . (count($names) > 4 ? '…' : ''),
            'tag' => 'maillo-summary',
            'threadId' => '',
            'silent' => $silent,
        ];
    }
    $i = $items[0];
    $subject = $i['subject'] !== '' ? $i['subject'] : ($p['lang'] === 'fr' ? '(sans objet)' : '(no subject)');
    return [
        'type' => 'mail',
        'title' => $i['from'] !== '' ? $i['from'] : $i['fromEmail'],
        'body' => $p['preview'] ? trim($subject . "\n" . $i['snippet']) : $subject,
        'tag' => 'thread-' . $i['threadId'],
        'threadId' => $i['threadId'],
        'silent' => $silent,
    ];
}

/** Sends what each device wants to hear about; forgets devices whose subscription has ended. */
function deliver(array $state, array &$a, array $items, string $subject): void
{
    $fresh = array_values(array_filter($items, function ($m) {
        return $m['date'] >= time() - MAX_AGE;
    }));
    if (!$fresh) {
        return;
    }
    foreach ($a['devices'] as $k => $d) {
        $p = clean_prefs($d['prefs'] ?? []);
        if (!$p['enabled'] || in_quiet_hours($p)) {
            continue;
        }
        $mine = array_values(array_filter($fresh, function ($m) use ($p) {
            return wanted($p, $m);
        }));
        // Up to three conversations get a notification each; more become one summary.
        $batches = count($mine) > 3 ? [$mine] : array_map(function ($m) {
            return [$m];
        }, $mine);
        foreach ($batches as $batch) {
            $code = send_push($state, $d, message_for($p, $batch), $subject);
            if ($code === 404 || $code === 410) {
                unset($a['devices'][$k]);
                break;
            }
        }
    }
    $a['devices'] = array_values($a['devices']);
}

function install_url(): string
{
    $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https' ? 'https' : 'http';
    $host = preg_replace('/[^A-Za-z0-9.\-:\[\]]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $path = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
    return $proto . '://' . $host . $path;
}

/** The "sub" of VAPID: how push services can reach whoever runs this install. */
function vapid_subject(): string
{
    $u = install_url();
    return strpos($u, 'https://') === 0 ? $u : 'mailto:postmaster@example.com';
}

/* ---------- requests ---------- */

$cfg = read_config($root);
$cfg += ['pushEnabled' => false, 'pushTopic' => ''];
$cli = PHP_SAPI === 'cli';

/** Renews each watched mailbox that's due (cron, or as a side effect of other requests). */
function renew_all(array $cfg, string $root, string $dir): int
{
    $n = 0;
    foreach (glob($dir . '/acct-*.php') ?: [] as $f) {
        $email = (string) (php_read($f)['email'] ?? '');
        if ($email === '') {
            continue;
        }
        with_account($dir, $email, function (array $a) use ($cfg, $root, $email, &$n) {
            if (!$a['devices'] || !watch_due($a)) {
                return null;
            }
            $token = server_token($cfg, $root, $email);
            if ($token !== '' && start_watch($cfg, $token, $a)) {
                $n++;
            }
            return $a;
        });
    }
    return $n;
}

if ($cli || isset($_GET['renew'])) {
    header('Content-Type: text/plain; charset=utf-8');
    if (!$cfg['pushEnabled'] || $cfg['pushTopic'] === '') {
        echo "Push is off.\n";
        exit;
    }
    $state = push_state($dir);
    if (!$cli && !hash_equals($state['key'], (string) $_GET['renew'])) {
        http_response_code(404);
        exit;
    }
    echo 'Renewed ' . renew_all($cfg, $root, $dir) . " mailbox watch(es).\n";
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit;
}

// From Pub/Sub: {"message": {"data": base64({"emailAddress", "historyId"}), ...}, "subscription": ...}
if (isset($_GET['key'])) {
    if (!$cfg['pushEnabled'] || $cfg['pushTopic'] === '') {
        // Acknowledge so Pub/Sub stops retrying while push is turned off.
        http_response_code(204);
        exit;
    }
    $state = push_state($dir);
    if (!hash_equals($state['key'], (string) $_GET['key'])) {
        http_response_code(404);
        exit;
    }
    $body = json_decode((string) file_get_contents('php://input'), true);
    $data = json_decode((string) base64_decode((string) ($body['message']['data'] ?? ''), true), true);
    $email = strtolower((string) ($data['emailAddress'] ?? ''));
    $historyId = (string) ($data['historyId'] ?? '');
    // Acknowledge first (Pub/Sub only waits a few seconds), then do the work.
    http_response_code(204);
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        // LiteSpeed (common on shared hosting) has its own version.
        litespeed_finish_request();
    } else {
        // Anything else: send the empty answer and close the connection before working.
        header('Content-Length: 0');
        header('Connection: close');
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        flush();
    }
    if ($email === '' || !is_file(account_file($dir, $email))) {
        exit;
    }
    ignore_user_abort(true);
    with_account($dir, $email, function (array $a) use ($cfg, $root, $state, $email, $historyId) {
        if (!$a['devices']) {
            return null;
        }
        $token = server_token($cfg, $root, $email);
        if ($token === '') {
            $a['tokenError'] = time();
            return $a;
        }
        unset($a['tokenError']);
        $items = new_mail($token, $a, preg_match('/^\d+$/', $historyId) ? $historyId : '');
        deliver($state, $a, $items, vapid_subject());
        if (watch_due($a)) {
            start_watch($cfg, $token, $a);
        }
        return $a;
    });
    exit;
}

header('Content-Type: application/json; charset=utf-8');
if (!$cfg['pushEnabled']) {
    fail(403, 'push_disabled');
}
$email = authorize($cfg);
$action = (string) ($_POST['action'] ?? '');
$token = (string) $_POST['token'];

if ($action === 'status') {
    $state = push_state($dir);
    $a = is_file(account_file($dir, $email)) ? php_read(account_file($dir, $email)) : [];
    $endpoint = (string) ($_POST['endpoint'] ?? '');
    $device = false;
    foreach ((array) ($a['devices'] ?? []) as $d) {
        $device = $device || $d['endpoint'] === $endpoint;
    }
    // Opening Maillo is also a chance to renew the watch.
    if (!empty($a['devices']) && watch_due($a) && $cfg['pushTopic'] !== '') {
        with_account($dir, $email, function (array $acc) use ($cfg, $token) {
            start_watch($cfg, $token, $acc);
            return $acc;
        });
        $a = php_read(account_file($dir, $email));
    }
    out(200, [
        'ok' => true,
        'topic' => $cfg['pushTopic'] !== '',
        'staySignedIn' => $cfg['staySignedIn'],
        'vapidPublic' => $state['vapidPublic'],
        'endpoint' => install_url() . 'push.php?key=' . $state['key'],
        'renewUrl' => install_url() . 'push.php?renew=' . $state['key'],
        'device' => $device,
        'devices' => count((array) ($a['devices'] ?? [])),
        'expiration' => (int) ($a['expiration'] ?? 0),
        'watchError' => (string) ($a['watchError'] ?? ''),
        'tokenError' => !empty($a['tokenError']),
        'crypto' => function_exists('openssl_pkey_derive'),
    ]);
}

if ($action === 'subscribe') {
    if ($cfg['pushTopic'] === '') {
        fail(409, 'no_topic');
    }
    if (!function_exists('openssl_pkey_derive')) {
        fail(500, 'no_crypto');
    }
    $sub = json_decode((string) ($_POST['subscription'] ?? ''), true);
    $endpoint = (string) ($sub['endpoint'] ?? '');
    $p256dh = (string) ($sub['keys']['p256dh'] ?? '');
    $auth = (string) ($sub['keys']['auth'] ?? '');
    if (!valid_endpoint($endpoint) || strlen(unb64u($p256dh)) !== 65 || strlen(unb64u($auth)) !== 16) {
        fail(400, 'bad_subscription');
    }
    $prefs = clean_prefs(json_decode((string) ($_POST['prefs'] ?? ''), true));
    push_state($dir);
    $a = with_account($dir, $email, function (array $a) use ($cfg, $token, $endpoint, $p256dh, $auth, $prefs) {
        $a['devices'] = array_values(array_filter($a['devices'], function ($d) use ($endpoint) {
            return $d['endpoint'] !== $endpoint;
        }));
        $a['devices'][] = ['endpoint' => $endpoint, 'p256dh' => $p256dh, 'auth' => $auth, 'prefs' => $prefs, 'added' => time()];
        $a['devices'] = array_slice($a['devices'], -MAX_DEVICES);
        start_watch($cfg, $token, $a);
        return $a;
    });
    if (!empty($a['watchError'])) {
        fail(424, 'watch_failed', ['detail' => $a['watchError']]);
    }
    out(200, ['ok' => true, 'expiration' => (int) ($a['expiration'] ?? 0)]);
}

if ($action === 'prefs' || $action === 'unsubscribe' || $action === 'test') {
    $endpoint = (string) ($_POST['endpoint'] ?? '');
    $prefs = clean_prefs(json_decode((string) ($_POST['prefs'] ?? ''), true));
    $state = push_state($dir);
    $found = null;
    with_account($dir, $email, function (array $a) use ($action, $endpoint, $prefs, &$found) {
        foreach ($a['devices'] as $k => $d) {
            if ($d['endpoint'] !== $endpoint) {
                continue;
            }
            $found = $d;
            if ($action === 'prefs') {
                $a['devices'][$k]['prefs'] = $prefs;
            }
            if ($action === 'unsubscribe') {
                unset($a['devices'][$k]);
            }
        }
        $a['devices'] = array_values($a['devices']);
        return $action === 'test' ? null : $a;
    });
    if ($action === 'test') {
        if (!$found) {
            fail(404, 'not_subscribed');
        }
        $p = clean_prefs($found['prefs'] ?? []);
        $code = send_push($state, $found, [
            'type' => 'mail',
            'title' => 'Maillo',
            'body' => $p['lang'] === 'fr' ? 'Les notifications arrivent même quand Maillo est fermé.' : 'Notifications arrive even when Maillo is closed.',
            'tag' => 'maillo-test',
            'threadId' => '',
            'silent' => !$p['sound'],
        ], vapid_subject());
        if ($code < 200 || $code >= 300) {
            fail(424, 'push_failed', ['status' => $code]);
        }
    }
    out(200, ['ok' => true]);
}

fail(400, 'unknown_action');
