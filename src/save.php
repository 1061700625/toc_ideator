<?php
// share_save.php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['ok' => false, 'msg' => 'Method Not Allowed'], JSON_UNESCAPED_UNICODE);
  exit;
}

// 1) 读取原始 body
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'msg' => 'Empty body'], JSON_UNESCAPED_UNICODE);
  exit;
}

// 2) 限制大小（防止被刷爆）
$maxBytes = 512 * 1024; // 512KB，可按需调整
if (strlen($raw) > $maxBytes) {
  http_response_code(413);
  echo json_encode(['ok' => false, 'msg' => 'Payload too large'], JSON_UNESCAPED_UNICODE);
  exit;
}

// 3) 校验 JSON
$data = json_decode($raw, true);
if (!is_array($data)) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'msg' => 'Invalid JSON'], JSON_UNESCAPED_UNICODE);
  exit;
}

// 4) 轻度结构检查：必须有 tree（你导出包里就有 tree）:contentReference[oaicite:2]{index=2}
$tree = null;
if (isset($data['tree']) && is_array($data['tree'])) $tree = $data['tree'];
if ($tree === null && array_is_list($data)) $tree = $data; // 兼容“直接传数组”
if ($tree === null) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'msg' => 'Missing tree'], JSON_UNESCAPED_UNICODE);
  exit;
}

// 5) 生成不可猜测的 id（128-bit）
$id = bin2hex(random_bytes(16)); // 32 hex chars

$storeDir = __DIR__ . '/store';
if (!is_dir($storeDir)) {
  // 0755 一般够用；如果写入失败，再考虑权限
  mkdir($storeDir, 0755, true);
}

$path = $storeDir . '/' . $id . '.json';

// 6) 写文件（建议重新 encode 一次，避免奇怪内容）
$toSave = $data;
$toSave['savedAt'] = gmdate('c');

$json = json_encode($toSave, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'msg' => 'JSON encode failed'], JSON_UNESCAPED_UNICODE);
  exit;
}

$ok = file_put_contents($path, $json, LOCK_EX);
if ($ok === false) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'msg' => 'Write failed'], JSON_UNESCAPED_UNICODE);
  exit;
}

echo json_encode([
  'ok' => true,
  'id' => $id,
  'url' => 'share.php?id=' . $id
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
