<?php
/*
 * First-run setup from the browser: fills in maillo-config.php from Maillo's setup screen, then
 * deletes itself. It only works while maillo-config.php has no Client ID or allowed accounts yet.
 *
 * To prove the server is yours (so nobody else can claim a fresh install), saving needs the code
 * this file writes into maillo-setup-code.php, which you open in your hosting file manager. That
 * file only returns "not found" if requested from the web. Five wrong codes lock setup for 15 minutes.
 *
 * Actions (POST):
 *   status   whether setup can run here, and the address to give Google as the JavaScript origin
 *   save     code, clientId, clientSecret, accounts, domains, language, features (JSON)
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require __DIR__ . '/maillo-common.php';

const CODE_FILE = 'maillo-setup-code.php';
const TRIES_FILE = '.maillo-setup-tries.json';
const MAX_TRIES = 5;
const LOCK_SECONDS = 900;
// What the setup screen can switch on. Others (AI, push) need more than a form: see INSTALL.md.
const SETUP_FEATURES = ['calendar', 'tasks', 'contactPhotos', 'stickies', 'syncSettings', 'staySignedIn'];

$root = __DIR__;

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'method_not_allowed');
}

/** True once maillo-config.php has a Client ID and someone allowed to sign in. */
function configured(?array $c): bool
{
    if (!$c || isset($c['__error'])) {
        return false;
    }
    $id = trim((string) ($c['googleClientId'] ?? ''));
    return preg_match('/^[0-9A-Za-z\-]+\.apps\.googleusercontent\.com$/', $id) === 1
        && (clean_list($c['allowedAccounts'] ?? []) || clean_list($c['allowedDomains'] ?? []));
}

/** Setup is done: this file and the code have no further use. */
function retire(string $root): void
{
    @unlink($root . '/' . CODE_FILE);
    @unlink($root . '/' . TRIES_FILE);
    @unlink(__FILE__);
}

function setup_code(string $root): string
{
    $file = $root . '/' . CODE_FILE;
    if (is_file($file) && preg_match('/Code: ([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/', (string) file_get_contents($file), $m)) {
        return $m[1];
    }
    // No 0/O or 1/I/L: easy to copy by hand.
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $code = '';
    for ($i = 0; $i < 12; $i++) {
        $code .= $alphabet[random_int(0, strlen($alphabet) - 1)] . ($i === 3 || $i === 7 ? '-' : '');
    }
    $php = "<?php\n// Maillo setup code. Type it on Maillo's setup screen to show this server is yours.\n"
        . "// Maillo deletes this file once setup is done; if it's still here afterwards, delete it.\n"
        . "// Code: {$code}\nhttp_response_code(404);\n";
    if (@file_put_contents($file, $php, LOCK_EX) === false) {
        return '';
    }
    @chmod($file, 0600);
    return $code;
}

function norm_code(string $c): string
{
    return preg_replace('/[^A-Z0-9]/', '', strtoupper($c));
}

function install_origin(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https'
        || strpos((string) ($_SERVER['HTTP_CF_VISITOR'] ?? ''), 'https') !== false;
    $host = preg_replace('/[^A-Za-z0-9.\-:\[\]]/', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));
    return ($https ? 'https://' : 'http://') . $host;
}

/** A PHP literal for maillo-config.php. */
function php_literal($v): string
{
    if (is_bool($v)) {
        return $v ? 'true' : 'false';
    }
    if (is_array($v)) {
        return '[' . implode(', ', array_map('php_literal', $v)) . ']';
    }
    return var_export((string) $v, true);
}

/** Replaces the value of 'key' => … (first match only) in a config file's source. */
function set_value(string $src, string $key, $value, &$found): string
{
    $re = '/^(\s*\'' . preg_quote($key, '/') . '\'\s*=>\s*)(?:\'(?:[^\'\\\\]|\\\\.)*\'|\[[^\]\n]*\]|true|false|-?\d+)(\s*,)/m';
    $found = preg_match($re, $src) === 1;
    return $found ? preg_replace_callback($re, function ($m) use ($value) {
        return $m[1] . php_literal($value) . $m[2];
    }, $src, 1) : $src;
}

/** maillo-config.php's source with the setup answers in it: the shipped template when present, else a short new file. */
function build_config(string $root, array $v): string
{
    $file = $root . '/' . CONFIG_FILE;
    $src = is_file($file) ? (string) file_get_contents($file) : '';
    if ($src !== '' && strpos($src, "'features' => [") !== false) {
        $ok = true;
        foreach (['googleClientId', 'googleClientSecret', 'allowedAccounts', 'allowedDomains', 'language'] as $k) {
            $src = set_value($src, $k, $v[$k], $found);
            $ok = $ok && $found;
        }
        // Feature switches only inside the features list ('calendar' is also a link name further down).
        $start = strpos($src, "'features' => [");
        $end = strpos($src, "\n    ],", $start);
        if ($ok && $end !== false) {
            $block = substr($src, $start, $end - $start);
            foreach ($v['features'] as $f => $on) {
                $block = set_value($block, $f, $on, $found);
                $ok = $ok && $found;
            }
            $src = substr($src, 0, $start) . $block . substr($src, $end);
        }
        if ($ok) {
            return $src;
        }
    }
    $features = '';
    foreach ($v['features'] as $f => $on) {
        $features .= "        '{$f}' => " . php_literal($on) . ",\n";
    }
    return "<?php\n// Maillo settings, written by the setup screen. INSTALL.md explains every option.\n"
        . "if (realpath(\$_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }\n\nreturn [\n"
        . "    'googleClientId' => " . php_literal($v['googleClientId']) . ",\n"
        . "    'googleClientSecret' => " . php_literal($v['googleClientSecret']) . ",\n"
        . "    'allowedAccounts' => " . php_literal($v['allowedAccounts']) . ",\n"
        . "    'allowedDomains' => " . php_literal($v['allowedDomains']) . ",\n"
        . "    'language' => " . php_literal($v['language']) . ",\n"
        . "    'features' => [\n{$features}    ],\n];\n";
}

$existing = load_php_config($root);
if (configured($existing)) {
    retire($root);
    fail(404, 'already_set_up');
}
$action = (string) ($_POST['action'] ?? '');

if ($action === 'status') {
    $writable = is_writable($root) && (!is_file($root . '/' . CONFIG_FILE) || is_writable($root . '/' . CONFIG_FILE));
    out(200, [
        'ok' => true,
        'writable' => $writable,
        'codeReady' => $writable && setup_code($root) !== '',
        'codeFile' => CODE_FILE,
        'origin' => install_origin(),
    ]);
}

if ($action === 'save') {
    $tries = @json_decode((string) @file_get_contents($root . '/' . TRIES_FILE), true);
    $tries = is_array($tries) ? $tries : ['count' => 0, 'until' => 0];
    if ((int) $tries['until'] > time()) {
        fail(429, 'locked', ['retryAfter' => (int) $tries['until'] - time()]);
    }
    $code = setup_code($root);
    if ($code === '' || !hash_equals(norm_code($code), norm_code((string) ($_POST['code'] ?? '')))) {
        $tries['count'] = (int) $tries['count'] + 1;
        if ($tries['count'] >= MAX_TRIES) {
            $tries = ['count' => 0, 'until' => time() + LOCK_SECONDS];
        }
        @file_put_contents($root . '/' . TRIES_FILE, json_encode($tries), LOCK_EX);
        fail(403, 'bad_code');
    }

    $clientId = trim((string) ($_POST['clientId'] ?? ''));
    if (!preg_match('/^[0-9A-Za-z\-]+\.apps\.googleusercontent\.com$/', $clientId)) {
        fail(400, 'bad_client_id');
    }
    $secret = trim((string) ($_POST['clientSecret'] ?? ''));
    if ($secret !== '' && !preg_match('/^[A-Za-z0-9_\-]{10,128}$/', $secret)) {
        fail(400, 'bad_secret');
    }
    $split = function (string $s): array {
        return array_values(array_unique(array_filter(array_map('trim', preg_split('/[\s,;]+/', strtolower($s)) ?: []))));
    };
    $accounts = $split((string) ($_POST['accounts'] ?? ''));
    $domains = array_map(function ($d) {
        return ltrim($d, '@');
    }, $split((string) ($_POST['domains'] ?? '')));
    foreach ($accounts as $a) {
        if (!filter_var($a, FILTER_VALIDATE_EMAIL)) {
            fail(400, 'bad_account', ['value' => $a]);
        }
    }
    foreach ($domains as $d) {
        if (!preg_match('/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/', $d)) {
            fail(400, 'bad_domain', ['value' => $d]);
        }
    }
    if (!$accounts && !$domains) {
        fail(400, 'no_accounts');
    }
    $asked = json_decode((string) ($_POST['features'] ?? '{}'), true);
    $features = [];
    foreach (SETUP_FEATURES as $f) {
        $features[$f] = is_array($asked) && !empty($asked[$f]);
    }
    // Staying signed in needs the client secret.
    $features['staySignedIn'] = $features['staySignedIn'] && $secret !== '';
    $language = in_array($_POST['language'] ?? '', ['en', 'fr'], true) ? $_POST['language'] : 'auto';

    $src = build_config($root, [
        'googleClientId' => $clientId,
        'googleClientSecret' => $secret,
        'allowedAccounts' => $accounts,
        'allowedDomains' => $domains,
        'language' => $language,
        'features' => $features,
    ]);
    // Write next to it, check that it reads back as it should, then swap it in.
    $tmp = $root . '/.maillo-config-new.php';
    if (@file_put_contents($tmp, $src, LOCK_EX) === false) {
        fail(500, 'not_writable');
    }
    try {
        $check = (static function (string $f) {
            return include $f;
        })($tmp);
    } catch (Throwable $e) {
        $check = null;
    }
    if (!is_array($check) || !configured($check) || ($check['googleClientId'] ?? '') !== $clientId) {
        @unlink($tmp);
        fail(500, 'write_check_failed');
    }
    if (!@rename($tmp, $root . '/' . CONFIG_FILE)) {
        @unlink($tmp);
        fail(500, 'not_writable');
    }
    @chmod($root . '/' . CONFIG_FILE, 0640);
    if (function_exists('opcache_invalidate')) {
        @opcache_invalidate($root . '/' . CONFIG_FILE, true);
    }
    retire($root);
    out(200, ['ok' => true]);
}

fail(400, 'unknown_action');
