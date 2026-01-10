<?php
// share.php（只读预览版）
$id = $_GET['id'] ?? '';
if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
  http_response_code(400);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Invalid id";
  exit;
}

$path = __DIR__ . '/store/' . $id . '.json';
if (!is_file($path)) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Not found";
  exit;
}

$raw = file_get_contents($path);
$data = json_decode($raw, true);
if (!is_array($data)) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Corrupted data";
  exit;
}

// 兼容：完整包 {tree:[...]} 或 直接数组
$tree = null;
if (isset($data['tree']) && is_array($data['tree'])) $tree = $data['tree'];
if ($tree === null && array_is_list($data)) $tree = $data;
if ($tree === null) $tree = [];

function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function clamp_lvl($n) { $n = (int)$n; return max(1, min(3, $n)); }

function node_title($n) {
  $opts = $n['options'] ?? [];
  $sel = $n['selected'] ?? 0;
  $t = '';
  if (is_array($opts) && isset($opts[(int)$sel])) $t = trim((string)$opts[(int)$sel]);
  return $t !== '' ? $t : '未命名';
}

function build_preview_html($nodes) {
  $html = '';
  $counters = [0,0,0];

  $walk = function($arr) use (&$walk, &$html, &$counters) {
    foreach ($arr as $n) {
      if (!is_array($n)) continue;
      $lvl = clamp_lvl($n['level'] ?? 1);

      // 本级 +1；更深层级清零
      $counters[$lvl - 1] += 1;
      for ($i = $lvl; $i < 3; $i++) $counters[$i] = 0;

      $num = implode('.', array_slice($counters, 0, $lvl));
      $indent = ($lvl - 1) * 16;

      $title = h(node_title($n));
      $html .= '<div class="pv-row pv-l'.$lvl.'" style="margin-left:'.$indent.'px">'
            .  '<span class="pv-num">'.h($num).'</span> '
            .  '<span class="pv-title">'.$title.'</span>'
            .  '</div>';

      if (!empty($n['children']) && is_array($n['children'])) $walk($n['children']);
    }
  };

  if (empty($nodes)) return '<div class="pv-empty">（暂无内容）</div>';
  $walk($nodes);
  return $html;
}

$pv = build_preview_html($tree);
$title = '目录构思助手 · 在线分享';
$exportedAt = $data['exportedAt'] ?? ($data['savedAt'] ?? '');
?>
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><?= h($title) ?></title>
  <link rel="stylesheet" href="./styles.css" />
  <style>
  .wrap.wrap-share{
    grid-template-columns: 1fr !important;
    width: min(1440px, calc(100% - 40px));  /* 两侧留 20px 边距 */
    margin: 0 auto;
  }
</style>
</head>
<body>
  <div class="wrap wrap-share">
    <section class="card">
      <div class="head">
        <div>
          <div class="title">在线分享（只读预览）</div>
          <div class="subtitle">
            分享 ID：<?= h($id) ?><br/>
            时间：<?= h($exportedAt) ?>
          </div>
        </div>
        <div class="btns">
          <button class="btn-primary" id="btnCopyLink" type="button">复制链接</button>
        </div>
      </div>

      <div class="title" style="margin-bottom:8px;">目录预览</div>
      <div class="preview" id="preview"><?= $pv ?></div>
    </section>
  </div>

  <div class="toast" id="toast">已复制</div>

  <script>
    const toast = (msg) => {
      const t = document.getElementById("toast");
      t.textContent = msg;
      t.classList.add("show");
      setTimeout(()=>t.classList.remove("show"), 1200);
    };

    document.getElementById("btnCopyLink").onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast("已复制链接");
      } catch(e) {
        toast("复制受限");
        window.prompt("分享链接：", location.href);
      }
    };
  </script>
</body>
</html>
