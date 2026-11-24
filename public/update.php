<?php
/*
 * Updates this install from a release zip uploaded in Settings > Updates, or fetched
 * straight from the project's latest GitHub release, and stores the custom logo set in
 * Settings > Appearance. Checks for a newer release at most twice a day (updateCheck
 * in maillo-config.php turns that off; updateChannel 'beta' also offers pre-releases).
 * Only allowed accounts (allowedAccounts or allowedDomains) can use it, and the request
 * must carry a valid Google access token issued to this install's OAuth client.
 * maillo-config.php and .htaccess are never replaced.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const MAX_UPLOAD = 30 * 1024 * 1024;
const MAX_UNPACKED = 120 * 1024 * 1024;
const KEEP_BACKUPS = 3;
const PROTECTED_PATHS = ['maillo-config.php', '.htaccess', '.maillo-backup', '.mailmax-backup', '.well-known', 'branding', 'branding.json'];
const MAX_LOGO = 1024 * 1024;
// Where releases are published, and how often to ask (at most).
const RELEASE_REPO = 'tim-jubinville/Maillo';
const CHECK_EVERY = 12 * 3600;
const CHECK_MIN_GAP = 60;
// Server files shipped in the release; any other .php file in a package is refused.
// A newer release may add server files: they're accepted when that release's own update.php lists
// them here (no new risk, since the package's update.php replaces this one anyway).
// maillo-config.php is listed so updaters before 0.6.9 accept the package; it's protected, so this one never
// replaces it.
const SERVER_FILES = ['update.php', 'maillo-common.php', 'ai.php', 'session.php', 'config.php', 'maillo-config.php', 'push.php', 'setup.php'];

/** SERVER_FILES as declared by the update.php inside a package (top-level .php names only). */
function package_server_files(ZipArchive $zip, string $prefix): array
{
    $src = $zip->getFromName($prefix . 'update.php');
    if (!is_string($src) || !preg_match('/const\s+SERVER_FILES\s*=\s*\[([^\]]*)\]/', $src, $m)) {
        return [];
    }
    preg_match_all('/[\'"]([a-z0-9][a-z0-9.\-]*\.php)[\'"]/', $m[1], $all);
    return array_values(array_filter($all[1], function ($n) {
        return strpos($n, '/') === false && strpos($n, '..') === false;
    }));
}
const ALLOWED_EXT = ['html', 'js', 'css', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'txt', 'webmanifest', 'map', 'htaccess'];

$root = __DIR__;
$backupRoot = $root . DIRECTORY_SEPARATOR . '.maillo-backup';

require __DIR__ . '/maillo-common.php';

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
    return in_array($first, PROTECTED_PATHS, true) || strpos($first, '.maillo-') === 0 || strpos($first, '.mailmax-') === 0;
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

/**
 * GET over HTTPS (redirects stay on HTTPS). Returns [status, body], status 0 on failure;
 * bodies over $max bytes are cut off and reported as status 413.
 */
function https_get(string $url, int $max, array $headers = []): array
{
    $headers[] = 'User-Agent: Maillo-updater';
    if (function_exists('curl_init')) {
        $body = '';
        $tooBig = false;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$tooBig, $max): int {
                if (strlen($body) + strlen($chunk) > $max) {
                    $tooBig = true;
                    return 0;
                }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return $tooBig ? [413, ''] : [$status, $body];
    }
    if (!ini_get('allow_url_fopen') || strpos($url, 'https://') !== 0) {
        return [0, ''];
    }
    $ctx = stream_context_create(['http' => ['header' => implode("\r\n", $headers), 'timeout' => 60, 'follow_location' => 1, 'max_redirects' => 5, 'ignore_errors' => true]]);
    $fh = @fopen($url, 'rb', false, $ctx);
    if (!$fh) {
        return [0, ''];
    }
    $body = (string) stream_get_contents($fh, $max + 1);
    $meta = stream_get_meta_data($fh);
    fclose($fh);
    $status = 0;
    foreach ($meta['wrapper_data'] ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $h, $m)) {
            $status = (int) $m[1];
        }
    }
    return strlen($body) > $max ? [413, ''] : [$status, $body];
}

/** A release's x.y.z version, or '' for anything else (drafts, odd tags). */
function release_version($r): string
{
    if (!is_array($r) || !empty($r['draft'])) {
        return '';
    }
    $v = ltrim((string) ($r['tag_name'] ?? ''), 'v');
    return preg_match('/^\d+\.\d+\.\d+$/', $v) ? $v : '';
}

/**
 * The newest release for this install's channel, from a cache refreshed at most every CHECK_EVERY
 * seconds. 'stable' follows GitHub's latest release, which never includes pre-releases. 'beta'
 * takes the highest version among recent releases, pre-releases included.
 */
function latest_release(string $root, bool $force, string $channel = 'stable'): array
{
    $file = $root . '/.maillo-update.json';
    $cache = @json_decode((string) @file_get_contents($file), true);
    $sameChannel = is_array($cache) && ($cache['channel'] ?? 'stable') === $channel;
    $age = $sameChannel ? time() - (int) ($cache['checked'] ?? 0) : PHP_INT_MAX;
    if ($sameChannel && $age < ($force ? CHECK_MIN_GAP : CHECK_EVERY)) {
        return $cache;
    }
    $headers = ['Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28'];
    $r = null;
    if ($channel === 'beta') {
        [$status, $body] = https_get('https://api.github.com/repos/' . RELEASE_REPO . '/releases?per_page=20', 1024 * 1024, $headers);
        $list = $status === 200 ? json_decode($body, true) : null;
        foreach (is_array($list) ? $list : [] as $item) {
            $v = release_version($item);
            if ($v !== '' && ($r === null || version_compare($v, release_version($r), '>'))) {
                $r = $item;
            }
        }
    } else {
        [$status, $body] = https_get('https://api.github.com/repos/' . RELEASE_REPO . '/releases/latest', 512 * 1024, $headers);
        $r = $status === 200 ? json_decode($body, true) : null;
    }
    $version = release_version($r);
    if ($version === '') {
        // Keep the last good answer; retry after CHECK_MIN_GAP instead of on every request.
        $fallback = $sameChannel ? $cache : ['latest' => null];
        $fallback['channel'] = $channel;
        $fallback['checked'] = time() - CHECK_EVERY + CHECK_MIN_GAP;
        $fallback['error'] = 'check_failed';
        @file_put_contents($file, json_encode($fallback), LOCK_EX);
        return $fallback;
    }
    $prefix = 'https://github.com/' . RELEASE_REPO . '/releases/download/';
    $asset = null;
    foreach (['maillo-' . $version . '.zip', 'maillo.zip'] as $want) {
        foreach ((array) ($r['assets'] ?? []) as $a) {
            $url = (string) ($a['browser_download_url'] ?? '');
            if (($a['name'] ?? '') === $want && strpos($url, $prefix) === 0) {
                $digest = (string) ($a['digest'] ?? '');
                $asset = ['url' => $url, 'size' => (int) ($a['size'] ?? 0), 'sha256' => preg_match('/^sha256:([0-9a-f]{64})$/', $digest, $m) ? $m[1] : ''];
                break 2;
            }
        }
    }
    $page = (string) ($r['html_url'] ?? '');
    $data = [
        'channel' => $channel,
        'checked' => time(),
        'latest' => [
            'version' => $version,
            'url' => strpos($page, 'https://github.com/') === 0 ? $page : '',
            'published' => (string) ($r['published_at'] ?? ''),
            'prerelease' => !empty($r['prerelease']),
            'asset' => $asset,
        ],
    ];
    @file_put_contents($file, json_encode($data), LOCK_EX);
    return $data;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'method_not_allowed');
}

$cfg = read_config($root);
$email = authorize($cfg);
$action = (string) ($_POST['action'] ?? 'status');

// Each release ships setup.php for new installs; this one is set up already, so it has no use here.
if (is_file($root . '/setup.php')) {
    @unlink($root . '/setup.php');
}

if ($action === 'status') {
    out(200, [
        'ok' => true,
        'account' => $email,
        'version' => installed_version($root),
        'php' => PHP_VERSION,
        'zip' => class_exists('ZipArchive'),
        'writable' => is_writable($root),
        'maxUpload' => min(MAX_UPLOAD, bytes_from_ini((string) ini_get('upload_max_filesize')), bytes_from_ini((string) ini_get('post_max_size'))),
        'updateCheck' => $cfg['updateCheck'],
        'updateChannel' => $cfg['updateChannel'],
        'backups' => array_map(function ($d) {
            $parts = explode('_', $d, 2);
            return ['id' => $d, 'version' => $parts[1] ?? ''];
        }, backups($backupRoot)),
    ]);
}

if ($action === 'check') {
    if (!$cfg['updateCheck']) {
        out(200, ['ok' => true, 'enabled' => false]);
    }
    $rel = latest_release($root, ($_POST['force'] ?? '') === '1', $cfg['updateChannel']);
    $current = installed_version($root);
    $latest = $rel['latest'] ?? null;
    out(200, [
        'ok' => true,
        'enabled' => true,
        'current' => $current,
        'latest' => $latest['version'] ?? '',
        'url' => $latest['url'] ?? '',
        'published' => $latest['published'] ?? '',
        'prerelease' => !empty($latest['prerelease']),
        'channel' => $cfg['updateChannel'],
        'available' => $latest !== null && $current !== '' && version_compare($latest['version'], $current, '>'),
        'canInstall' => !empty($latest['asset']) && class_exists('ZipArchive') && is_writable($root),
        'checked' => (int) ($rel['checked'] ?? 0),
        'error' => $rel['error'] ?? null,
    ]);
}

if ($action === 'update') {
    if (!class_exists('ZipArchive')) {
        fail(500, 'zip_unavailable');
    }
    if (!is_writable($root)) {
        fail(500, 'not_writable');
    }
    $expected = '';
    if (($_POST['source'] ?? '') === 'latest') {
        // The latest GitHub release: downloaded here, then checked exactly like an upload.
        if (!$cfg['updateCheck']) {
            fail(403, 'check_disabled');
        }
        $asset = latest_release($root, false, $cfg['updateChannel'])['latest']['asset'] ?? null;
        if (!is_array($asset)) {
            fail(502, 'download_failed');
        }
        [$status, $data] = https_get($asset['url'], MAX_UPLOAD);
        if ($status === 413) {
            fail(400, 'too_large');
        }
        if ($status !== 200 || $data === '') {
            fail(502, 'download_failed');
        }
        if ($asset['sha256'] !== '' && !hash_equals($asset['sha256'], hash('sha256', $data))) {
            fail(502, 'download_corrupt');
        }
        $zipPath = (string) tempnam(sys_get_temp_dir(), 'maillo');
        if ($zipPath === '' || @file_put_contents($zipPath, $data) === false) {
            fail(500, 'write_failed', ['path' => 'temp']);
        }
        unset($data);
        register_shutdown_function(function () use ($zipPath) {
            @unlink($zipPath);
        });
        $expected = (string) (latest_release($root, false, $cfg['updateChannel'])['latest']['version'] ?? '');
    } else {
        $file = $_FILES['package'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $err = is_array($file) ? (int) $file['error'] : UPLOAD_ERR_NO_FILE;
            fail(400, in_array($err, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 'too_large' : 'no_file');
        }
        if ((int) $file['size'] > MAX_UPLOAD) {
            fail(400, 'too_large');
        }
        $zipPath = (string) $file['tmp_name'];
    }
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
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

    $serverFiles = array_unique(array_merge(SERVER_FILES, package_server_files($zip, $prefix)));
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
        if (!in_array($rel, $serverFiles, true) && !in_array($ext, ALLOWED_EXT, true)) {
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
    if (!is_array($meta) || !in_array($meta['name'] ?? '', ['maillo', 'mailmax'], true) || $newVersion === '' || ($expected !== '' && $newVersion !== $expected)) {
        fail(400, 'not_a_release');
    }
    $current = installed_version($root);
    if ($current !== '' && version_compare($newVersion, $current, '<') && ($_POST['force'] ?? '') !== '1') {
        fail(409, 'downgrade', ['current' => $current, 'version' => $newVersion]);
    }

    $tmp = $root . '/.maillo-tmp-' . bin2hex(random_bytes(6));
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
