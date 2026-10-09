// 节点 ID 有效性 lint —— 大世界扩展前必须先加这道防线
//
// 为什么需要（实测发现）：
//   1. story.js 的 5 条叙事线，beats 里硬编码了 nodeId：
//      hongyi: n0→n0→n4→n5   laolao: n9→n7→n5→n5
//      tomb:   n8→n8→n8→sj   jiangu: n8→n8→n8→n8
//      auspicious: n2→n2→n4→n4
//   2. quest.js 的 8 条支线，QUEST_COND.where 里也引用：
//      n10, n1, n5, n7, n2, n8, n3, n4
//   3. build.js 的领地/矿脉/篝火 用 s.land[] / s.fires[].nodeId 存 nodeId
//
//   这些 nodeId 一旦在 world.js 里被删或改名，剧情线会**静默失效**：
//   节点不匹配 → _advance() 永远不推进 → 玩家卡在一条永远走不完的线上。
//   而 node --check 和所有逻辑测试都会全绿。
//
//   这正是 AGENTS.md 0A 节说的「定义了但玩家拿不到」的镜像版本。
//
// 用法：node tests/lint-nodes.mjs
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(ROOT + '/' + p, 'utf8');

let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fail++;
};

// ── 1) 收集 world.js 定义的节点 ID ──
console.log('\n[1] world.js 节点定义');
const world = R('js/xiuxian/world.js');
const defined = [...world.matchAll(/\{ id:'(n?\w+)',\s*x:(\d+),\s*y:(\d+),\s*type:'(\w+)'/g)]
  .map(m => ({ id: m[1], x: +m[2], y: +m[3], type: m[4] }));
const ids = new Set(defined.map(d => d.id));
ok(`${defined.length} 个节点被解析`, defined.length > 0, `(${defined.map(d=>d.id).join(' ')})`);

if (defined.length === 0) {
  console.log('\n❌ 无法从 world.js 解析节点 —— lint 本身失效，检查正则');
  process.exit(1);
}

// ── 2) ID 唯一性 ──
console.log('\n[2] ID 唯一性');
const dup = defined.map(d => d.id).filter((id, i, a) => a.indexOf(id) !== i);
ok('无重复 ID', dup.length === 0, dup.length ? '重复: ' + dup.join(', ') : '');

// ── 3) 剧情线引用的节点必须存在 ──
console.log('\n[3] 叙事线 beats 引用的 nodeId');
const story = R('js/xiuxian/story.js');
const storyRefs = [];
for (const m of story.matchAll(/(\w+):\s*\{\s*\n\s*name:'[^']*',\s*mob:'(\w+)'[\s\S]*?beats:\[([\s\S]*?)\n    \],/g)) {
  const arc = m[1];
  for (const b of m[3].matchAll(/at:(\d+),\s*(?:node|room):'(\w+)'/g)) {
    storyRefs.push({ arc, beat: +b[1], node: b[2] });
  }
}
ok(`解析出 ${storyRefs.length} 个剧情节点引用`, storyRefs.length > 0);
const badStory = storyRefs.filter(r => !ids.has(r.node));
// 墓内房间 room:'sj' 不是地图节点，单独放行
const rooms = storyRefs.filter(r => r.node === 'sj');
const realBad = badStory.filter(r => r.node !== 'sj');
ok('全部叙事节点存在于 world.js', realBad.length === 0,
   realBad.length ? '缺失: ' + realBad.map(r => `${r.arc}#${r.beat}→${r.node}`).join(', ') : '');
if (rooms.length) console.log(`    (注: ${rooms.map(r=>r.node).join(',')} 是墓内房间 ID，非地图节点，已放行)`);

// ── 4) 支线引用的节点必须存在 ──
console.log('\n[4] 支线 QUEST_COND.where 引用的 nodeId');
const quest = R('js/xiuxian/quest.js');
const condBlock = (quest.match(/QUEST_COND = \{([\s\S]*?)\n\};/) || [])[1] || '';
const questRefs = [...condBlock.matchAll(/where:\[([^\]]+)\]/g)]
  .flatMap(m => m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')))
  .filter(Boolean);
ok(`解析出 ${questRefs.length} 个支线节点引用`, true);
const badQuest = questRefs.filter(id => !ids.has(id));
ok('全部支线节点存在于 world.js', badQuest.length === 0,
   badQuest.length ? '缺失: ' + badQuest.join(', ') : '');

// ── 5) 固定节点 ID 不得被删（迁移红线）──
console.log('\n[5] 迁移红线：n0–n11 必须全部存在');
// n0-n10 是历史 ID（被剧情/支线硬编码）；n11 是我们自己加的解析样本
const REDLINE = ['n0','n1','n2','n3','n4','n5','n6','n7','n8','n9','n10'];
const missingRedline = REDLINE.filter(id => !ids.has(id));
ok('n0–n10 全部保留', missingRedline.length === 0,
   missingRedline.length ? '被删了: ' + missingRedline.join(', ') : '');

// ── 6) 已知地标节点的语义不能变 ──
console.log('\n[6] 地标节点类型（叙事/经济依赖，不可改）');
const LANDMARK = {
  n0:  { type:'village', why:'青石村 · home 起点，序章' },
  n4:  { type:'secret',  why:'青岚秘境 · 主产筑基丹' },
  n5:  { type:'elite',   why:'黑风岭 · 愿牌散落处' },
  n8:  { type:'boss',    why:'古战场遗迹 · 7/8 个剧情环在此' },
  n9:  { type:'village', why:'落云镇 · 坊市/茶摊/霜清' },
};
for (const [id, exp] of Object.entries(LANDMARK)) {
  const d = defined.find(x => x.id === id);
  ok(`${id} (${exp.why})`, d && d.type === exp.type,
     d ? `实际=${d.type} 期望=${exp.type}` : '节点不存在');
}

// ── 7) 网格坐标一致性 ──
console.log('\n[7] 网格坐标');
const xs = defined.map(d => d.x), ys = defined.map(d => d.y);
const maxX = Math.max(...xs), maxY = Math.max(...ys);
const gridDecl = (world.match(/grid:\s*(\d+)/) || [])[1];
ok('WORLD.grid 声明值与实际坐标一致', String(maxX) === gridDecl,
   `实际最大 x=${maxX}, y=${maxY}; WORLD.grid=${gridDecl}`);

// ── 8) 连通性 ──
console.log('\n[8] 连通性（玩家能否从家走到所有节点）');
const adj = new Map(defined.map(d => [d.id, []]));
for (let i = 0; i < defined.length; i++) for (let j = i + 1; j < defined.length; j++) {
  const a = defined[i], b = defined[j];
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) { adj.get(a.id).push(b.id); adj.get(b.id).push(a.id); }
}
const home = 'n0';
const seen = new Set([home]); const q = [home];
while (q.length) { const c = q.shift(); for (const n of adj.get(c) || []) if (!seen.has(n)) { seen.add(n); q.push(n); } }
const unreachable = defined.map(d => d.id).filter(id => !seen.has(id));
ok('所有节点从家可达（无孤岛）', unreachable.length === 0,
   unreachable.length ? '不可达: ' + unreachable.join(', ') : '');

const deadEnd = defined.filter(d => adj.get(d.id).length <= 1);
ok('无死胡同（度数 ≥ 2）', deadEnd.length === 0,
   deadEnd.length ? '死胡同: ' + deadEnd.map(d => d.id).join(', ') : '');

console.log(`\nlint-nodes: ${fail ? 'FAIL (' + fail + ')' : 'PASS (ok)'}`);
console.log(`节点总数 ${defined.length} · 边 ${[...adj.values()].reduce((s, a) => s + a.length, 0) / 2} · 地图尺寸 ${maxX}×${maxY}`);
process.exit(fail ? 1 : 0);
