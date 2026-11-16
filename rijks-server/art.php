<?php
// Rijksmuseum for TRMNL: picks random public-domain works from the static index next to this file.
// GET art.php?type=painting|drawing|print|photograph|all &period=all|pre1500|1500|1600|1700|1800|1900 &top=true|false
// Returns ~1 KB: one uniformly random work ("pick") plus up to 3 wide, 3 square-ish and 3 tall works ("fit"),
// so the markup can choose the one that fits the screen it is drawn on.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$TYPES = ['painting', 'drawing', 'print', 'photograph', 'all'];
$PERIODS = ['all', 'pre1500', '1500', '1600', '1700', '1800', '1900'];
$dir = __DIR__ . '/index/';

$type = in_array($_GET['type'] ?? '', $TYPES, true) ? $_GET['type'] : 'painting';
$period = in_array($_GET['period'] ?? '', $PERIODS, true) ? $_GET['period'] : 'all';
$top = in_array(strtolower($_GET['top'] ?? ''), ['true', '1', 'yes', 'on'], true);

// Big sets are split into parts (name.0.json ...); read one random part, which is a random sample of the set.
function load($dir, $name, $manifest = []) {
  $parts = $manifest["$name.parts"] ?? 0;
  if ($parts > 1) $name .= '.' . random_int(0, $parts - 1);
  $f = $dir . $name . '.json';
  if (!is_file($f)) return [];
  $j = json_decode(file_get_contents($f), true);
  return is_array($j) ? $j : [];
}

$manifest = load($dir, 'manifest');
$rows = [];
$set = '';

if ($top) {
  // top.json rows carry their type and period up front: [type, period, ...row]
  $all = load($dir, 'top');
  foreach ([[$type, $period], [$type, 'all'], ['all', $period], ['all', 'all']] as [$t, $p]) {
    $rows = array_values(array_filter($all, fn($r) => ($t === 'all' || $r[0] === $t) && ($p === 'all' || $r[1] === $p)));
    if ($rows) { $set = "top-$t-$p"; break; }
  }
  $rows = array_map(fn($r) => array_slice($r, 2), $rows);
} else {
  $t = $type;
  if ($t === 'all') {
    // Choose a type in proportion to how many works the index holds for it in this period.
    $w = [];
    foreach (['painting', 'drawing', 'print', 'photograph'] as $k) $w[$k] = $manifest["$k-$period"] ?? 0;
    $sum = array_sum($w);
    if ($sum > 0) {
      $x = random_int(1, $sum);
      foreach ($w as $k => $n) { if (($x -= $n) <= 0) { $t = $k; break; } }
    } else $t = 'painting';
  }
  foreach (["$t-$period", "$t-all", 'painting-all'] as $name) {
    $rows = load($dir, $name, $manifest);
    if ($rows) { $set = $name; break; }
  }
}

if (!$rows) { echo json_encode(['ok' => 0]); exit; }

// Row: [objectNumber, titleNL, titleEN, makerNL, makerEN, dateNL, dateEN, iiif, ratio, techNL, techEN]; empty EN means same as NL.
function item($r) {
  $k = $r[9] ?? '';
  $ke = ($r[10] ?? '') !== '' ? $r[10] : $k;
  return ['o' => $r[0], 't' => $r[1], 'te' => $r[2] !== '' ? $r[2] : $r[1], 'm' => $r[3], 'me' => $r[4] !== '' ? $r[4] : $r[3],
          'd' => $r[5], 'de' => $r[6] !== '' ? $r[6] : $r[5], 'k' => $k, 'ke' => $ke, 'i' => $r[7], 'r' => $r[8]];
}

$n = count($rows);
$pick = $rows[random_int(0, $n - 1)];

// Up to 3 per shape, sampled at random (at most 60 tries so a huge set stays cheap).
$shapes = ['wide' => [], 'mid' => [], 'tall' => []];
for ($i = 0; $i < 60; $i++) {
  $r = $rows[random_int(0, $n - 1)];
  $s = $r[8] >= 1.25 ? 'wide' : ($r[8] <= 0.8 ? 'tall' : 'mid');
  if (count($shapes[$s]) < 3 && !in_array($r, $shapes[$s], true)) $shapes[$s][] = $r;
  if (count($shapes['wide']) + count($shapes['mid']) + count($shapes['tall']) >= 9) break;
}
$fit = array_map('item', array_merge($shapes['wide'], $shapes['mid'], $shapes['tall']));

echo json_encode(['ok' => 1, 'set' => $set, 'n' => $manifest[preg_replace('/^top-.*/', 'top', $set)] ?? $n, 'pick' => item($pick), 'fit' => $fit],
  JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
