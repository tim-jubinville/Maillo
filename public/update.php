<?php
/*
 * Updates this install from a release zip uploaded in Settings > Updates,
 * and stores the custom logo set in Settings > Appearance.
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
const PROTECTED_PATHS = ['config.js', '.htaccess', '.mailmax-backup', '.well-known', 'branding', 'branding.json'];
const MAX_LOGO = 1024 * 1024;
// Server files shipped in the release; any other .php file in a package is refused.
const SERVER_FILES = ['update.php', 'mailmax-common.php', 'ai.php'];
const ALLOWED_EXT = ['html', 'js', 'css', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'txt', 'webmanifest', 'map', 'htaccess'];

$root = __DIR__;
$backupRoot = $root . DIRECTORY_SEPARATOR . '.mailmax-backup';

require __DIR__ . '/mailmax-common.php';

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
        if (in_array($rel, SERVER_FILES, true) || isset($keep[$rel])) {
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
        if (!in_array($rel, SERVER_FILES, true) && !in_array($ext, ALLOWED_EXT, true)) {
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

if ($action === 'branding') {
    $dir = $root . '/branding';
    $jsonPath = $root . '/branding.json';
    $existing = @json_decode((string) @file_get_contents($jsonPath), true);
    $existing = is_array($existing) ? $existing : [];
    $text = trim(preg_replace('/[<>"\\\\\x00-\x1F]/', '', (string) ($_POST['logoText'] ?? 'Mail')));
    if (function_exists('mb_substr')) {
        $text = mb_substr($text, 0, 40);
    } else {
        $text = substr($text, 0, 40);
    }
    $logoUrl = (string) ($existing['logoUrl'] ?? '');
    $file = $_FILES['logo'] ?? null;
    if (is_array($file) && ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        if ((int) $file['size'] > MAX_LOGO) {
            fail(400, 'logo_too_large');
        }
        $data = (string) file_get_contents($file['tmp_name']);
        $ext = '';
        if (preg_match('/<svg[\s>]/i', substr($data, 0, 4096))) {
            $bad = '/<script|<foreignObject|<!ENTITY|<!DOCTYPE|<iframe|<embed|<object|<link|<meta|\bon[a-z]+\s*=|javascript:|data:text\/html|@import|(?:xlink:)?href\s*=\s*["\']\s*(?!#)/i';
            if (preg_match($bad, $data)) {
                fail(400, 'logo_unsafe');
            }
            $ext = 'svg';
        } else {
            $info = @getimagesizefromstring($data);
            $map = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'];
            $ext = is_array($info) ? ($map[$info['mime'] ?? ''] ?? '') : '';
            if ($ext === '') {
                fail(400, 'logo_type');
            }
        }
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
            fail(500, 'not_writable');
        }
        foreach (glob($dir . '/logo.*') ?: [] as $old) {
            @unlink($old);
        }
        $headers = "<IfModule mod_headers.c>\n  Header set Content-Security-Policy \"default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox\"\n  Header set X-Content-Type-Options \"nosniff\"\n</IfModule>\n";
        put_file($dir . '/.htaccess', $headers);
        put_file($dir . '/logo.' . $ext, $data);
        $logoUrl = 'branding/logo.' . $ext . '?v=' . time();
    }
    $branding = [
        'logoUrl' => $logoUrl,
        'logoText' => $text,
        'logoInvertDark' => ($_POST['logoInvertDark'] ?? '1') === '1',
    ];
    put_file($jsonPath, json_encode($branding, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n");
    out(200, ['ok' => true, 'branding' => $branding]);
}

if ($action === 'branding_remove') {
    rrmdir($root . '/branding');
    @unlink($root . '/branding.json');
    out(200, ['ok' => true]);
}

fail(400, 'unknown_action');
