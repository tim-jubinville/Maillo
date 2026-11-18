<?php
/*
 * Updates this install from a release zip uploaded in Settings > Updates.
 * Only accounts listed in config.js (allowedAccounts or allowedDomains) can use it,
 * and the request must carry a valid Google access token issued to this install's
 * OAuth client. config.js and .htaccess are never replaced.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const MAX_UPLOAD = 30 * 1024 * 1024;
const MAX_UNPACKED = 120 * 1024 * 1024;
const KEEP_BACKUPS = 3;
const PROTECTED_PATHS = ['config.js', '.htaccess', '.mailmax-backup', '.well-known'];
const ALLOWED_EXT = ['html', 'js', 'css', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'txt', 'webmanifest', 'map', 'htaccess'];

$root = __DIR__;
$backupRoot = $root . DIRECTORY_SEPARATOR . '.mailmax-backup';

function out(int $code, array $data): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $code, string $error, array $extra = []): void
{
    out($code, ['ok' => false, 'error' => $error] + $extra);
}

function read_config(string $root): array
{
    $js = @file_get_contents($root . '/config.js');
    if ($js === false) {
        fail(500, 'config_missing');
    }
    $js = preg_replace('#/\*.*?\*/#s', '', $js);
    $js = preg_replace('#^\s*//.*$#m', '', $js);
    $str = function (string $key) use ($js): string {
        return preg_match('/\b' . $key . '\s*:\s*["\']([^"\']*)["\']/', $js, $m) ? trim($m[1]) : '';
    };
    $list = function (string $key) use ($js): array {
        if (!preg_match('/\b' . $key . '\s*:\s*\[([^\]]*)\]/', $js, $m)) {
            return [];
        }
        preg_match_all('/["\']([^"\']+)["\']/', $m[1], $all);
        return array_values(array_filter(array_map(function ($s) {
            return strtolower(trim($s));
        }, $all[1])));
    };
    return [
        'clientId' => $str('googleClientId'),
        'accounts' => $list('allowedAccounts'),
        'domains' => array_map(function ($d) {
            return ltrim($d, '@');
        }, $list('allowedDomains')),
    ];
}

function http_get(string $url, array $headers = []): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'header' => implode("\r\n", $headers),
            'timeout' => 15,
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($url, false, $ctx);
        $code = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})(\s|$)/', $http_response_header[0], $m)) {
            $code = (int) $m[1];
        }
    }
    return [$code, is_string($body) ? json_decode($body, true) : null];
}

function authorize(array $cfg): string
{
    $token = (string) ($_POST['token'] ?? '');
    if ($token === '' || !preg_match('/^[A-Za-z0-9._\-~+\/]+=*$/', $token)) {
        fail(401, 'no_token');
    }
    if ($cfg['clientId'] === '') {
        fail(403, 'not_configured');
    }
    if (!$cfg['accounts'] && !$cfg['domains']) {
        fail(403, 'no_allowed_accounts');
    }
    [$code, $info] = http_get('https://oauth2.googleapis.com/tokeninfo?access_token=' . rawurlencode($token));
    $aud = is_array($info) ? (string) ($info['aud'] ?? $info['azp'] ?? '') : '';
    if ($code !== 200 || !hash_equals($cfg['clientId'], $aud)) {
        fail(401, 'invalid_token');
    }
    [$code, $profile] = http_get('https://gmail.googleapis.com/gmail/v1/users/me/profile', ['Authorization: Bearer ' . $token]);
    $email = strtolower(is_array($profile) ? (string) ($profile['emailAddress'] ?? '') : '');
    if ($code !== 200 || $email === '') {
        fail(401, 'invalid_token');
    }
    $domain = substr((string) strrchr($email, '@'), 1);
    if (!in_array($email, $cfg['accounts'], true) && !in_array($domain, $cfg['domains'], true)) {
        fail(403, 'not_allowed');
    }
    return $email;
}

function installed_version(string $dir): string
{
    $v = @json_decode((string) @file_get_contents($dir . '/version.json'), true);
    return is_array($v) ? (string) ($v['version'] ?? '') : '';
}

function bytes_from_ini(string $v): int
{
    $v = trim($v);
    $n = (int) $v;
    switch (strtolower(substr($v, -1))) {
        case 'g': $n *= 1024;
        case 'm': $n *= 1024;
        case 'k': $n *= 1024;
    }
    return $n;
}

function is_protected(string $rel): bool
{
    $first = explode('/', $rel)[0];
    return in_array($first, PROTECTED_PATHS, true) || strpos($first, '.mailmax-') === 0;
}

function list_files(string $dir, string $base = ''): array
{
    $out = [];
    foreach (scandir($dir) ?: [] as $f) {
        if ($f === '.' || $f === '..') {
            continue;
        }
        $rel = $base === '' ? $f : $base . '/' . $f;
        $path = $dir . DIRECTORY_SEPARATOR . $f;
        if (is_link($path)) {
            continue;
        }
        if (is_dir($path)) {
            $out = array_merge($out, list_files($path, $rel));
        } else {
            $out[] = $rel;
        }
    }
    return $out;
}

function rrmdir(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) ?: [] as $f) {
        if ($f === '.' || $f === '..') {
            continue;
        }
        $p = $dir . DIRECTORY_SEPARATOR . $f;
        is_dir($p) && !is_link($p) ? rrmdir($p) : @unlink($p);
    }
    @rmdir($dir);
}

function put_file(string $path, string $data): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
        fail(500, 'write_failed', ['path' => $path]);
    }
    if (@file_put_contents($path, $data, LOCK_EX) === false) {
        fail(500, 'write_failed', ['path' => $path]);
    }
}

function copy_tree(string $from, string $to, array $files): void
{
    foreach ($files as $rel) {
        $data = @file_get_contents($from . '/' . $rel);
        if ($data === false) {
            fail(500, 'read_failed', ['path' => $rel]);
        }
        put_file($to . '/' . $rel, $data);
    }
}

function managed_files(string $root): array
{
    return array_values(array_filter(list_files($root), function ($rel) {
        return !is_protected($rel);
    }));
}

function ensure_backup_root(string $backupRoot): void
{
    if (!is_dir($backupRoot) && !@mkdir($backupRoot, 0755, true)) {
        fail(500, 'backup_failed');
    }
    $deny = "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n";
    @file_put_contents($backupRoot . '/.htaccess', $deny);
    @file_put_contents($backupRoot . '/index.html', '');
}

function backups(string $backupRoot): array
{
    if (!is_dir($backupRoot)) {
        return [];
    }
    $dirs = array_values(array_filter(scandir($backupRoot) ?: [], function ($d) use ($backupRoot) {
        return $d[0] !== '.' && is_dir($backupRoot . '/' . $d);
    }));
    rsort($dirs);
    return $dirs;
}

function remove_stale(string $root, array $keepFiles): void
{
    $keep = array_flip($keepFiles);
    foreach (managed_files($root) as $rel) {
        if ($rel === 'update.php' || isset($keep[$rel])) {
            continue;
        }
        if (strpos($rel, 'assets/') === 0) {
            @unlink($root . '/' . $rel);
        }
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'method_not_allowed');
}

$cfg = read_config($root);
$email = authorize($cfg);
$action = (string) ($_POST['action'] ?? 'status');

if ($action === 'status') {
    out(200, [
        'ok' => true,
        'account' => $email,
        'version' => installed_version($root),
        'php' => PHP_VERSION,
        'zip' => class_exists('ZipArchive'),
        'writable' => is_writable($root),
        'maxUpload' => min(MAX_UPLOAD, bytes_from_ini((string) ini_get('upload_max_filesize')), bytes_from_ini((string) ini_get('post_max_size'))),
        'backups' => array_map(function ($d) {
            $parts = explode('_', $d, 2);
            return ['id' => $d, 'version' => $parts[1] ?? ''];
        }, backups($backupRoot)),
    ]);
}

if ($action === 'update') {
    if (!class_exists('ZipArchive')) {
        fail(500, 'zip_unavailable');
    }
    if (!is_writable($root)) {
        fail(500, 'not_writable');
    }
    $file = $_FILES['package'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $err = is_array($file) ? (int) $file['error'] : UPLOAD_ERR_NO_FILE;
        fail(400, in_array($err, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 'too_large' : 'no_file');
    }
    if ((int) $file['size'] > MAX_UPLOAD) {
        fail(400, 'too_large');
    }
    $zip = new ZipArchive();
    if ($zip->open($file['tmp_name']) !== true) {
        fail(400, 'not_a_zip');
    }

    $names = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $names[$i] = (string) $zip->getNameIndex($i);
    }
    $prefix = '';
    $first = reset($names);
    if ($first !== false && preg_match('#^([^/]+/)#', $first, $m)) {
        $candidate = $m[1];
        $all = true;
        foreach ($names as $n) {
            if (strpos($n, $candidate) !== 0) {
                $all = false;
                break;
            }
        }
        if ($all) {
            $prefix = $candidate;
        }
    }

    $entries = [];
    $total = 0;
    foreach ($names as $i => $name) {
        $rel = substr($name, strlen($prefix));
        if ($rel === '' || substr($rel, -1) === '/') {
            continue;
        }
        $rel = str_replace('\\', '/', $rel);
        if ($rel[0] === '/' || strpos($rel, ':') !== false || preg_match('#(^|/)\.\.?(/|$)#', $rel)) {
            fail(400, 'unsafe_path', ['path' => $rel]);
        }
        if (is_protected($rel) || preg_match('/\.md$/i', $rel)) {
            continue;
        }
        $base = basename($rel);
        $ext = $base === '.htaccess' ? 'htaccess' : strtolower(pathinfo($base, PATHINFO_EXTENSION));
        if ($rel !== 'update.php' && !in_array($ext, ALLOWED_EXT, true)) {
            fail(400, 'unexpected_file', ['path' => $rel]);
        }
        $stat = $zip->statIndex($i);
        $total += (int) ($stat['size'] ?? 0);
        if ($total > MAX_UNPACKED) {
            fail(400, 'too_large');
        }
        $entries[$rel] = $i;
    }
    if (!isset($entries['index.html'], $entries['version.json'])) {
        fail(400, 'not_a_release');
    }
    $meta = json_decode((string) $zip->getFromIndex($entries['version.json']), true);
    $newVersion = is_array($meta) ? (string) ($meta['version'] ?? '') : '';
    if (!is_array($meta) || ($meta['name'] ?? '') !== 'mailmax' || $newVersion === '') {
        fail(400, 'not_a_release');
    }
    $current = installed_version($root);
    if ($current !== '' && version_compare($newVersion, $current, '<') && ($_POST['force'] ?? '') !== '1') {
        fail(409, 'downgrade', ['current' => $current, 'version' => $newVersion]);
    }

    $tmp = $root . '/.mailmax-tmp-' . bin2hex(random_bytes(6));
    foreach ($entries as $rel => $i) {
        $data = $zip->getFromIndex($i);
        if ($data === false) {
            rrmdir($tmp);
            fail(400, 'corrupt_zip', ['path' => $rel]);
        }
        put_file($tmp . '/' . $rel, $data);
    }
    $zip->close();

    ensure_backup_root($backupRoot);
    $backup = $backupRoot . '/' . gmdate('Ymd-His') . '_' . preg_replace('/[^0-9A-Za-z.\-]/', '', $current ?: 'unknown');
    copy_tree($root, $backup, managed_files($root));

    $newFiles = list_files($tmp);
    copy_tree($tmp, $root, $newFiles);
    remove_stale($root, $newFiles);
    rrmdir($tmp);

    foreach (array_slice(backups($backupRoot), KEEP_BACKUPS) as $old) {
        rrmdir($backupRoot . '/' . $old);
    }
    out(200, ['ok' => true, 'version' => $newVersion, 'previous' => $current]);
}

if ($action === 'rollback') {
    $list = backups($backupRoot);
    if (!$list) {
        fail(404, 'no_backup');
    }
    $dir = $backupRoot . '/' . $list[0];
    $files = list_files($dir);
    if (!in_array('index.html', $files, true)) {
        fail(500, 'backup_incomplete');
    }
    copy_tree($dir, $root, $files);
    remove_stale($root, $files);
    rrmdir($dir);
    out(200, ['ok' => true, 'version' => installed_version($root)]);
}

fail(400, 'unknown_action');
