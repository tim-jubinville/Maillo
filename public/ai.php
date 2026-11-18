<?php
/*
 * Relay between Mailmax and the Gemini API, so the API key never reaches the browser.
 * Same sign-in check as update.php: a Google access token for this install's OAuth
 * client, from an account allowed in config.js.
 *
 * Actions (POST, with token):
 *   status       whether a key is stored, the model, and today's usage
 *   set_key      store a Gemini API key (key)
 *   remove_key   delete the stored key
 *   generate     run instructions on input text (instructions, input, json=1 for JSON output)
 *
 * The key is kept in .mailmax-ai.php, which the updater never replaces, backs up or serves.
 * A GEMINI_API_KEY environment variable takes priority if the host sets one.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require __DIR__ . '/mailmax-common.php';

const DEFAULT_MODEL = 'gemini-flash-latest';
const DEFAULT_DAILY_LIMIT = 300;
const MAX_INSTRUCTIONS = 8000;
const MAX_INPUT = 300000;

$root = __DIR__;
$secretFile = $root . '/.mailmax-ai.php';
$usageFile = $root . '/.mailmax-ai-usage.json';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'method_not_allowed');
}

$cfg = read_config($root);
if (!$cfg['aiEnabled']) {
    fail(403, 'ai_disabled');
}
$email = authorize($cfg);
$model = preg_match('/^[a-z0-9.\-]{1,64}$/', $cfg['aiModel']) ? $cfg['aiModel'] : DEFAULT_MODEL;
$limit = $cfg['aiDailyLimit'] > 0 ? $cfg['aiDailyLimit'] : DEFAULT_DAILY_LIMIT;

function stored_key(string $file): string
{
    $env = getenv('GEMINI_API_KEY');
    if (is_string($env) && $env !== '') {
        return $env;
    }
    if (!is_file($file)) {
        return '';
    }
    $data = include $file;
    return is_array($data) ? (string) ($data['key'] ?? '') : '';
}

function key_source(): string
{
    $env = getenv('GEMINI_API_KEY');
    return is_string($env) && $env !== '' ? 'environment' : 'stored';
}

function usage_today(string $file, string $email): int
{
    $data = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
    if (!is_array($data) || ($data['date'] ?? '') !== gmdate('Y-m-d')) {
        return 0;
    }
    return (int) ($data['counts'][$email] ?? 0);
}

function count_use(string $file, string $email): void
{
    $fh = @fopen($file, 'c+');
    if (!$fh) {
        return;
    }
    flock($fh, LOCK_EX);
    $data = json_decode((string) stream_get_contents($fh), true);
    if (!is_array($data) || ($data['date'] ?? '') !== gmdate('Y-m-d')) {
        $data = ['date' => gmdate('Y-m-d'), 'counts' => []];
    }
    $data['counts'][$email] = (int) ($data['counts'][$email] ?? 0) + 1;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data));
    flock($fh, LOCK_UN);
    fclose($fh);
}

$action = (string) ($_POST['action'] ?? '');

if ($action === 'status') {
    $key = stored_key($secretFile);
    out(200, [
        'ok' => true,
        'configured' => $key !== '',
        'source' => $key !== '' ? key_source() : null,
        'model' => $model,
        'used' => usage_today($usageFile, $email),
        'limit' => $limit,
        'writable' => is_writable($root),
    ]);
}

if ($action === 'set_key') {
    $key = trim((string) ($_POST['key'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_\-]{20,200}$/', $key)) {
        fail(400, 'invalid_key');
    }
    [$code] = http_get('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model), ['x-goog-api-key: ' . $key]);
    if ($code === 400 || $code === 401 || $code === 403) {
        fail(400, 'key_rejected');
    }
    if ($code === 404) {
        fail(400, 'model_not_found', ['model' => $model]);
    }
    if ($code !== 200) {
        fail(502, 'gemini_unreachable');
    }
    $php = "<?php\n// Gemini API key for Mailmax's AI relay. Do not share this file.\nreturn " . var_export(['key' => $key, 'saved' => gmdate('c'), 'by' => $email], true) . ";\n";
    if (@file_put_contents($secretFile, $php, LOCK_EX) === false) {
        fail(500, 'not_writable');
    }
    @chmod($secretFile, 0600);
    out(200, ['ok' => true, 'configured' => true, 'source' => 'stored', 'model' => $model]);
}

if ($action === 'remove_key') {
    if (is_file($secretFile) && !@unlink($secretFile)) {
        fail(500, 'not_writable');
    }
    out(200, ['ok' => true, 'configured' => stored_key($secretFile) !== '']);
}

if ($action === 'generate') {
    $key = stored_key($secretFile);
    if ($key === '') {
        fail(409, 'no_key');
    }
    $instructions = (string) ($_POST['instructions'] ?? '');
    $input = (string) ($_POST['input'] ?? '');
    if ($input === '' || strlen($input) > MAX_INPUT || strlen($instructions) > MAX_INSTRUCTIONS) {
        fail(400, 'bad_input');
    }
    if (usage_today($usageFile, $email) >= $limit) {
        fail(429, 'daily_limit', ['limit' => $limit]);
    }
    $payload = [
        'contents' => [['role' => 'user', 'parts' => [['text' => $input]]]],
        'generationConfig' => ['temperature' => 0.3],
    ];
    if ($instructions !== '') {
        $payload['systemInstruction'] = ['parts' => [['text' => $instructions]]];
    }
    if (($_POST['json'] ?? '') === '1') {
        $payload['generationConfig']['responseMimeType'] = 'application/json';
    }
    count_use($usageFile, $email);
    [$code, $res] = http_post_json(
        'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent',
        $payload,
        ['x-goog-api-key: ' . $key]
    );
    if ($code === 429) {
        fail(429, 'gemini_quota');
    }
    if ($code === 400 || $code === 401 || $code === 403) {
        fail(502, 'gemini_rejected', ['detail' => is_array($res) ? (string) ($res['error']['status'] ?? '') : '']);
    }
    if ($code !== 200 || !is_array($res)) {
        fail(502, 'gemini_unreachable');
    }
    $cand = $res['candidates'][0] ?? null;
    $text = '';
    foreach ((array) ($cand['content']['parts'] ?? []) as $part) {
        if (empty($part['thought'])) {
            $text .= (string) ($part['text'] ?? '');
        }
    }
    if ($text === '') {
        fail(502, 'empty_response', ['reason' => (string) ($cand['finishReason'] ?? $res['promptFeedback']['blockReason'] ?? '')]);
    }
    out(200, [
        'ok' => true,
        'text' => $text,
        'model' => (string) ($res['modelVersion'] ?? $model),
        'usage' => [
            'input' => (int) ($res['usageMetadata']['promptTokenCount'] ?? 0),
            'output' => (int) ($res['usageMetadata']['candidatesTokenCount'] ?? 0),
        ],
    ]);
}

fail(400, 'unknown_action');
