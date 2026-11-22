<?php
/*
 * Shared helpers for Maillo's server files (update.php, ai.php).
 * authorize() accepts a request only if it carries a Google access token issued to
 * this install's OAuth client, for an account allowed in config.js.
 */
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

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
        'aiModel' => $str('aiModel'),
        'aiDailyLimit' => preg_match('/\baiDailyLimit\s*:\s*(\d+)/', $js, $m) ? (int) $m[1] : 0,
        'aiEnabled' => (bool) preg_match('/\bai\s*:\s*true\b/', $js),
        'staySignedIn' => (bool) preg_match('/\bstaySignedIn\s*:\s*true\b/', $js),
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

function http_post_json(string $url, array $payload, array $headers = []): array
{
    $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $headers[] = 'Content-Type: application/json';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $res = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'timeout' => 60,
            'ignore_errors' => true,
        ]]);
        $res = @file_get_contents($url, false, $ctx);
        $code = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})(\s|$)/', $http_response_header[0], $m)) {
            $code = (int) $m[1];
        }
    }
    return [$code, is_string($res) ? json_decode($res, true) : null];
}

function http_post_form(string $url, array $fields): array
{
    $body = http_build_query($fields);
    $headers = ['Content-Type: application/x-www-form-urlencoded'];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $res = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'timeout' => 20,
            'ignore_errors' => true,
        ]]);
        $res = @file_get_contents($url, false, $ctx);
        $code = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})(\s|$)/', $http_response_header[0], $m)) {
            $code = (int) $m[1];
        }
    }
    return [$code, is_string($res) ? json_decode($res, true) : null];
}

function authorize(array $cfg): string
{
    $token = (string) ($_POST['token'] ?? '');
    if ($token === '' || !preg_match('/^[A-Za-z0-9._\-~+\/]+=*$/', $token)) {
        fail(401, 'no_token');
    }
    return check_account($cfg, $token);
}

/** Checks that an access token was issued to this install's client, for an allowed account; returns the address. */
function check_account(array $cfg, string $token): string
{
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
