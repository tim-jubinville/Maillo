<?php
/*
 * Relay between Maillo and the Gemini API, so the API key never reaches the browser.
 * Same sign-in check as update.php: a Google access token for this install's OAuth
 * client, from an account allowed in maillo-config.php.
 *
 * Actions (POST, with token):
 *   status       whether a key is stored, the model, and today's usage
 *   set_key      store a Gemini API key (key)
 *   remove_key   delete the stored key
 *   generate     run instructions on input text (instructions, input, enc=b64 when both are base64,
 *                json=1 for JSON output, temperature 0–1)
 *
 * The key comes from maillo-config.php (geminiApiKey) if it's set there, else a GEMINI_API_KEY
 * environment variable, else the one saved from Settings in .maillo-ai.php (.mailmax-ai.php before
 * the rename), which the updater never replaces, backs up or serves.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require __DIR__ . '/maillo-common.php';

const DEFAULT_MODEL = 'gemini-flash-latest';
const DEFAULT_DAILY_LIMIT = 300;
const MAX_INSTRUCTIONS = 8000;
const MAX_INPUT = 300000;

$root = __DIR__;
$secretFile = $root . '/.maillo-ai.php';
$legacySecretFile = $root . '/.mailmax-ai.php';
$usageFile = $root . '/.maillo-ai-usage.json';

// Files saved before the rename to Maillo move to their new names. If the move fails,
// the old key file is still used.
foreach ([[$legacySecretFile, $secretFile], [$root . '/.mailmax-ai-usage.json', $usageFile]] as [$old, $new]) {
    if (!is_file($new) && is_file($old)) {
        @rename($old, $new);
    }
}
if (!is_file($secretFile) && is_file($legacySecretFile)) {
    $secretFile = $legacySecretFile;
}

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

/** The Gemini key and where it came from: maillo-config.php, the environment, or Settings. */
function key_info(array $cfg, string $file): array
{
    $data = is_file($file) ? include $file : null;
    return pick_secret($cfg['geminiKey'], 'GEMINI_API_KEY', is_array($data) ? (string) ($data['key'] ?? '') : '');
}

function stored_key(array $cfg, string $file): string
{
    return key_info($cfg, $file)[0];
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
    $key = stored_key($cfg, $secretFile);
    out(200, [
        'ok' => true,
        'configured' => $key !== '',
        'source' => $key !== '' ? key_info($cfg, $secretFile)[1] : null,
        'model' => $model,
        'used' => usage_today($usageFile, $email),
        'limit' => $limit,
        'writable' => is_writable($root),
    ]);
}

if (($action === 'set_key' || $action === 'remove_key') && in_array(key_info($cfg, $secretFile)[1], ['config', 'environment'], true)) {
    // Set in maillo-config.php or by the host: change it there.
    fail(409, 'key_fixed');
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
    $php = "<?php\n// Gemini API key for Maillo's AI relay. Do not share this file.\nreturn " . var_export(['key' => $key, 'saved' => gmdate('c'), 'by' => $email], true) . ";\n";
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
    out(200, ['ok' => true, 'configured' => stored_key($cfg, $secretFile) !== '']);
}

if ($action === 'generate') {
    $key = stored_key($cfg, $secretFile);
    if ($key === '') {
        fail(409, 'no_key');
    }
    $instructions = (string) ($_POST['instructions'] ?? '');
    $input = (string) ($_POST['input'] ?? '');
    // Maillo sends both base64-encoded: email text and prompts often trip hosts' firewalls
    // (ModSecurity rules), which then answer with an error page instead of reaching this file.
    if (($_POST['enc'] ?? '') === 'b64') {
        $instructions = base64_decode($instructions, true);
        $input = base64_decode($input, true);
        if ($instructions === false || $input === false) {
            fail(400, 'bad_input');
        }
    }
    if ($input === '' || strlen($input) > MAX_INPUT || strlen($instructions) > MAX_INSTRUCTIONS) {
        fail(400, 'bad_input');
    }
    if (usage_today($usageFile, $email) >= $limit) {
        fail(429, 'daily_limit', ['limit' => $limit]);
    }
    // Each task picks its own: 0 for proofreading, higher for drafts.
    $temperature = is_numeric($_POST['temperature'] ?? null) ? max(0.0, min(1.0, (float) $_POST['temperature'])) : 0.3;
    $payload = [
        'contents' => [['role' => 'user', 'parts' => [['text' => $input]]]],
        'generationConfig' => ['temperature' => $temperature],
    ];
    if ($instructions !== '') {
        $payload['systemInstruction'] = ['parts' => [['text' => $instructions]]];
    }
    if (($_POST['json'] ?? '') === '1') {
        $payload['generationConfig']['responseMimeType'] = 'application/json';
    }
    count_use($usageFile, $email);
    @set_time_limit(120);
    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';
    // Low thinking keeps answers quick enough for shared hosts' request time limits. Models that
    // don't take a thinking level (older ones) refuse it, so ask once more without it.
    $fast = $payload;
    $fast['generationConfig']['thinkingConfig'] = ['thinkingLevel' => 'low'];
    [$code, $res] = http_post_json($url, $fast, ['x-goog-api-key: ' . $key]);
    if ($code === 400 && stripos(is_array($res) ? (string) ($res['error']['message'] ?? '') : '', 'think') !== false) {
        [$code, $res] = http_post_json($url, $payload, ['x-goog-api-key: ' . $key]);
    }
    if ($code === 429) {
        fail(429, 'gemini_quota');
    }
    if ($code === 400 || $code === 401 || $code === 403 || $code === 404) {
        $why = is_array($res) ? (string) ($res['error']['message'] ?? $res['error']['status'] ?? '') : '';
        fail(502, 'gemini_rejected', ['detail' => function_exists('mb_substr') ? mb_substr($why, 0, 240) : substr($why, 0, 240)]);
    }
    if ($code === 0) {
        fail(504, 'gemini_timeout');
    }
    if ($code !== 200 || !is_array($res)) {
        fail(502, 'gemini_unreachable', ['detail' => 'HTTP ' . $code]);
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
