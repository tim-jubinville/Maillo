<?php
/*
 * Gives the browser the settings it needs from maillo-config.php, as window.MAILLO_CONFIG:
 * the app name and logo, the OAuth client ID, language, theme, accent, features and links.
 * Allowed accounts and secrets never leave the server.
 *
 * While required settings are missing or the server isn't ready, it also sets
 * window.MAILLO_SETUP (yes/no answers only) so Maillo shows a setup checklist.
 *
 * POST action=check_account (token): whether the signed-in account is allowed here.
 */
declare(strict_types=1);

require __DIR__ . '/maillo-common.php';

$root = __DIR__;

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    $cfg = read_config($root);
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'check_account') {
        out(200, ['ok' => true, 'email' => authorize($cfg)]);
    }
    if ($action === 'diagnostics') {
        // For bug reports: versions and yes/no answers only. No addresses, keys or settings' values.
        authorize($cfg);
        $soft = strtolower((string) ($_SERVER['SERVER_SOFTWARE'] ?? ''));
        $server = 'other';
        foreach (['litespeed', 'nginx', 'apache', 'caddy', 'iis'] as $name) {
            if (strpos($soft, $name) !== false) {
                $server = $name;
                break;
            }
        }
        $version = @json_decode((string) @file_get_contents($root . '/version.json'), true);
        $stored = @include $root . '/.maillo-oauth.php';
        $features = [];
        foreach (FEATURES as $f) {
            $features[$f] = !empty($cfg['raw']['features'][$f]);
        }
        out(200, [
            'ok' => true,
            'release' => is_array($version) ? (string) ($version['version'] ?? '') : '',
            'php' => PHP_VERSION,
            'server' => $server,
            'extensions' => [
                'curl' => function_exists('curl_init'),
                'openssl' => function_exists('openssl_encrypt'),
                'zip' => class_exists('ZipArchive'),
                'mbstring' => function_exists('mb_substr'),
            ],
            'checks' => setup_checks($root, load_php_config($root))['checks'],
            'features' => $features,
            'clientSecret' => pick_secret($cfg['clientSecret'], 'GOOGLE_CLIENT_SECRET', is_array($stored) ? (string) ($stored['secret'] ?? '') : '')[0] !== '',
            'pushTopic' => $cfg['pushTopic'] !== '',
            'updateCheck' => $cfg['updateCheck'],
            'updateChannel' => $cfg['updateChannel'],
        ]);
    }
    fail(400, 'unknown_action');
}

header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

function js_value($v): string
{
    return (string) json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
}

function text($v, int $max = 300): string
{
    return is_scalar($v) ? substr(trim((string) $v), 0, $max) : '';
}

/** Only what the browser needs, with each value checked for its type. */
function public_config(array $c): array
{
    $features = [];
    foreach (FEATURES as $f) {
        $features[$f] = !empty($c['features'][$f]);
    }
    $links = [];
    foreach ((is_array($c['links'] ?? null) ? $c['links'] : []) as $k => $v) {
        $v = text($v, 500);
        if (preg_match('/^[a-zA-Z]{1,40}$/', (string) $k) && preg_match('#^https?://#i', $v)) {
            $links[$k] = $v;
        }
    }
    $out = [
        'appName' => text($c['appName'] ?? '', 80),
        'logoUrl' => text($c['logoUrl'] ?? '', 500),
        'logoText' => text($c['logoText'] ?? '', 40),
        'logoInvertDark' => ($c['logoInvertDark'] ?? true) !== false,
        'googleClientId' => text($c['googleClientId'] ?? '', 200),
        'language' => in_array($c['language'] ?? '', ['en', 'fr'], true) ? $c['language'] : 'auto',
        'theme' => strtolower(text($c['theme'] ?? '', 20)),
        'accentColor' => preg_match('/^#[0-9a-fA-F]{3,8}$/', text($c['accentColor'] ?? '')) ? text($c['accentColor']) : '',
        'setAsideLabel' => text($c['setAsideLabel'] ?? '', 100),
        'actionLabel' => text($c['actionLabel'] ?? '', 100),
        'features' => $features,
        'links' => (object) $links,
        'demo' => !empty($c['demo']),
        // The browser can't see who is allowed, so it asks here after signing in.
        'accountCheck' => true,
    ];
    return array_filter($out, function ($v) {
        return $v !== '';
    });
}

/** Whether .htaccess has the rules that keep maillo-config.php and the .maillo-* files private. */
function htaccess_protects(string $root): bool
{
    $h = (string) @file_get_contents($root . '/.htaccess');
    return strpos($h, 'maillo-config') !== false && strpos($h, '.(maillo|mailmax)-') !== false;
}

/**
 * Whether the web actually serves .maillo-* files, which hold sign-ins and other private data: asks this
 * server for a throwaway one. Rules in .htaccess don't help where they're ignored (Nginx, AllowOverride
 * None). Checked at most once a day; null when the server couldn't be reached to tell.
 */
function private_files_exposed(string $root): ?bool
{
    $cache = $root . '/.maillo-probe.json';
    $last = @json_decode((string) @file_get_contents($cache), true);
    if (is_array($last) && (int) ($last['checked'] ?? 0) > time() - 86400) {
        return isset($last['exposed']) ? (bool) $last['exposed'] : null;
    }
    $token = bin2hex(random_bytes(16));
    $name = '.maillo-probe-' . bin2hex(random_bytes(6)) . '.txt';
    if (@file_put_contents($root . '/' . $name, $token) === false) {
        return null;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    $host = preg_replace('/[^A-Za-z0-9.\-]/', '', explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0]);
    $path = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
    $body = '';
    $code = 0;
    if ($host !== '' && function_exists('curl_init')) {
        $ch = curl_init(($https ? 'https://' : 'http://') . $host . $path . $name);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_FOLLOWLOCATION => false]);
        $body = (string) curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    }
    @unlink($root . '/' . $name);
    // A login wall (Cloudflare Access) answers with a redirect: private from the public, which is what counts.
    $exposed = $code === 0 ? null : ($code === 200 && trim($body) === $token);
    @file_put_contents($cache, json_encode(['checked' => time(), 'exposed' => $exposed]));
    return $exposed;
}

/** The setup checklist: yes/no answers only, nothing about the settings themselves. */
function setup_checks(string $root, ?array $c): array
{
    $c = $c ?? [];
    $features = is_array($c['features'] ?? null) ? $c['features'] : [];
    $checks = [
        'configFile' => $c !== [],
        'configValid' => !isset($c['__error']),
        'clientId' => (bool) preg_match('/^[0-9A-Za-z\-]+\.apps\.googleusercontent\.com$/', text($c['googleClientId'] ?? '', 200)),
        'allowed' => (bool) (clean_list($c['allowedAccounts'] ?? []) || clean_list($c['allowedDomains'] ?? [])),
        'php' => PHP_VERSION_ID >= 70400,
        // The rules must be in .htaccess (the checklist's hint), and the server must really refuse the files.
        'htaccess' => htaccess_protects($root) && ($c === [] || isset($c['__error']) || private_files_exposed($root) !== true),
        'writable' => is_writable($root),
        'openssl' => function_exists('openssl_encrypt'),
        'curl' => function_exists('curl_init'),
    ];
    $required = ['configFile', 'configValid', 'clientId', 'allowed', 'php', 'htaccess'];
    // Staying signed in and push can't work without encryption.
    if (!empty($features['staySignedIn']) || !empty($features['push'])) {
        $required[] = 'openssl';
    }
    $ready = true;
    foreach ($required as $k) {
        $ready = $ready && $checks[$k];
    }
    $out = ['ready' => $ready, 'required' => $required, 'checks' => $checks];
    if (isset($c['__error']) && $c['__error'] > 0) {
        $out['line'] = (int) $c['__error'];
    }
    return $out;
}

$c = load_php_config($root);
if ($c !== null && !isset($c['__error'])) {
    echo 'window.MAILLO_CONFIG = ' . js_value(public_config($c)) . ";\n";
}
$setup = setup_checks($root, $c);
if (!$setup['ready'] && empty($c['demo'])) {
    echo 'window.MAILLO_SETUP = ' . js_value($setup) . ";\n";
}
