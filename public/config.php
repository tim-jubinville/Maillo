<?php
/*
 * Gives the browser the settings it needs from maillo-config.php, as window.MAILLO_CONFIG:
 * the app name and logo, the OAuth client ID, language, theme, accent, features and links.
 * Allowed accounts and secrets never leave the server.
 *
 * While required settings are missing or the server isn't ready, it also sets
 * window.MAILLO_SETUP (yes/no answers only) so Maillo shows a setup checklist.
 * Installs that still use config.js get nothing here and keep working as before.
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
    if (($_POST['action'] ?? '') !== 'check_account') {
        fail(400, 'unknown_action');
    }
    out(200, ['ok' => true, 'email' => authorize($cfg)]);
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
        'htaccess' => htaccess_protects($root),
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

$src = config_source($root);
if ($src['source'] === 'js') {
    echo "/* Settings come from config.js. */\n";
    exit;
}
$c = $src['php'];
if ($c !== null && !isset($c['__error'])) {
    echo 'window.MAILLO_CONFIG = ' . js_value(public_config($c)) . ";\n";
}
$setup = setup_checks($root, $c);
if (!$setup['ready'] && empty($c['demo'])) {
    echo 'window.MAILLO_SETUP = ' . js_value($setup) . ";\n";
}
