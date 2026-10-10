// lint-gear-table.mjs —— 工单 XX-EQUIP-001 的门禁
//
// 存在理由(JOINT-DEV-PLAN §0.2):
//   「8 张反派立绘」「6 张死资源」「8 只传说妖」三个说法在方案里混着用,
//   两批 key 完全不重叠。不先定权威对照表,8 件装备会挂在不存在的敌人上,
//   而**测试会全绿** —— 因为没有任何断言检查「这件装备的掉落妖存不存在」。
//
// 它查什么:
//   1. docs/GEAR-TABLE.md 里出现的每个 foeKey,在真实数据源里真的存在
//   2. 表里引用的每个立绘文件,磁盘上真的存在
//   3. 三批 key 没有互相误用(拿反派 key 当图鉴妖之类)
//
// 它不查(照 AGENTS.md §0A 三问,不越界):
//   · 数值平衡      → XX-EQUIP-002 的 gear-regression 管
//   · 战斗里生效    → XX-EQUIP-004 桌面侧管,且必须反向验证
//
// 退出码:0 = 通过;非 0 = 不通过(CI 靠这个)
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

let fail = 0;
const ok = (n, c, d = '') => {
  if (c) console.log(`  ✅ ${n}`);
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};

console.log('\n=== [1] 三批 key 的真实边界(从数据源取,不从文档抄) ===');

// 批次 A:图鉴妖 —— 只取 BESTIARY 那一个块。
// 注意:bestiary.js 里有 4 个顶层对象(BESTIARY / RICE / BUILDINGS / NPCS),
// 直接全文匹配 ^  two-space key 会把 RICE 的米、NPCS 的人物、喂食项一起吃进来
// (实测 14 个,而不是 8 个)。先按 `export const BESTIARY = {` 到匹配的 `};` 截断。
const bestiary = read('js/xiuxian/bestiary.js');
const aStart = bestiary.indexOf('export const BESTIARY = {');
const aEnd = bestiary.indexOf('\n};', aStart);
const bestiaryBlock = aStart >= 0 && aEnd > aStart ? bestiary.slice(aStart, aEnd) : '';
const A_KEYS = [...bestiaryBlock.matchAll(/^  ([a-z]+):\s*\{/gm)].map(m => m[1]);
ok('BESTIARY 块定位成功(没匹配到 4 个顶层对象里)',
   A_KEYS.length > 0 && !A_KEYS.includes('rice') && !A_KEYS.includes('well'),
   aStart < 0 ? 'bestiary.js 里找不到 BESTIARY 定义' : '');
// 批次 B:传说妖 —— 从 LEGEND 的 key:'xxx' 取(legend.js 每条都有 key 字段)
const legend = read('js/xiuxian/legend.js');
const B_KEYS = [...legend.matchAll(/key:'([a-z]+)'/g)].map(m => m[1]);
// 批次 C:反派立绘 —— 从 PORTRAIT 表里 villain-*.jpg 的键名反推
// 注意排除 `foe`:它是**旧轮换表的兜底键**(4 个敌人挤 3 张脸时的入口),
// 不是第 7 张反派专属立绘。XX-AUDIT-011 接的是 6 张专属脸,foe 仍在,
// 但它不属于「反派专属立绘」这一批 —— 算进去会得出「7 张」的错误结论。
const portrait = read('js/xiuxian/ui/portrait.js');
const C_KEYS = [...new Set(
  [...portrait.matchAll(/([a-z]+)\s*:\s*'assets\/portrait\/villain-([a-z]+)\.jpg'/g)]
    .map(m => m[1])
)].filter(k => k !== 'foe');

console.log(`  批次A 图鉴妖 ${A_KEYS.length} 只: ${A_KEYS.join(' ')}`);
console.log(`  批次B 传说妖 ${B_KEYS.length} 只: ${B_KEYS.join(' ')}`);
console.log(`  批次C 反派 ${C_KEYS.length} 张: ${C_KEYS.join(' ')}`);

ok('批次 A 恰好 8 只', A_KEYS.length === 8, `实测 ${A_KEYS.length}`);
ok('批次 B 恰好 8 只', B_KEYS.length === 8, `实测 ${B_KEYS.length}`);
ok('批次 C 恰好 6 张', C_KEYS.length === 6, `实测 ${C_KEYS.length}`);

console.log('\n=== [2] 三批 key 互不相交(GEAR-TABLE §0 的核心结论) ===');
const inter = (x, y) => x.filter(k => y.includes(k));
const AB = inter(A_KEYS, B_KEYS), AC = inter(A_KEYS, C_KEYS), BC = inter(B_KEYS, C_KEYS);
ok('A ∩ B = ∅', AB.length === 0, `重合: ${AB.join(',')}`);
ok('A ∩ C = ∅', AC.length === 0, `重合: ${AC.join(',')}`);
ok('B ∩ C = ∅', BC.length === 0, `重合: ${BC.join(',')}`);

console.log('\n=== [3] 对照表存在且引用了真实 key ===');
const TABLE = 'docs/GEAR-TABLE.md';
ok('GEAR-TABLE.md 存在', existsSync(join(ROOT, TABLE)), `缺 ${TABLE}`);
if (existsSync(join(ROOT, TABLE))) {
  const tbl = read(TABLE);
  const ALL = new Set([...A_KEYS, ...B_KEYS, ...C_KEYS]);

  // 白名单思路不可靠 —— 文档里会不断出现新的普通英文词(reward/foes/…),
  // 补一次漏一次。改成**只核对表里结构化列出的 key**(表格首列),
  // 那才是「作者声明这是某个 key」的位置;散文里的反引号只是行文,不必当真。
  // 真正的风险是「装备挂到不存在的妖上」—— 那必然表现为
  // 「表格里列了一个 key,但数据源里查不到」,下面这条正是查它。
  const declared = [...tbl.matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gm)].map(m => m[1]);
  const unknown = declared.filter(k => !ALL.has(k));
  ok('对照表逐行列出的 key 全部真实存在', unknown.length === 0,
     unknown.length ? '不存在的 key: ' + unknown.join(', ') : '');

  console.log(`\n  (表里结构化列出 ${declared.length} 个 key,已逐个回源核对)`);
}

console.log('\n=== [4] 表里引用的立绘文件真实存在 ===');
if (existsSync(join(ROOT, TABLE))) {
  const tbl = read(TABLE);
  const imgs = [...new Set([...tbl.matchAll(/`(assets\/[a-z_\/]+\.jpg)`/g)].map(m => m[1]))];
  const bad = imgs.filter(p => !existsSync(join(ROOT, p)));
  ok(`${imgs.length} 个立绘路径全部存在`, bad.length === 0, '缺: ' + bad.join(', '));
}

console.log('\n=== [5] 批次 B 立绘 8 张齐全(已真咬过一次路径笔误) ===');
{
  const missing = B_KEYS.filter(k => !existsSync(join(ROOT, `assets/legend/${k}.jpg`)));
  ok('8 张传说妖立绘都在 assets/legend/', missing.length === 0, '缺: ' + missing.join(', '));
  // 提案代码曾把路径写成 assets/portrait/legend/ —— 明确不许再犯
  const proposal = 'docs/proposals/world-map-20261010/code/equipment.js';
  if (existsSync(join(ROOT, proposal))) {
    ok('提案里不再有 assets/portrait/legend/ 笔误',
       !read(proposal).includes('assets/portrait/legend/'),
       '这个路径拼错过一次(13 处),lint 必须盯住');
  }
}

console.log('\n=== [6] 装备挂载位尚未偷跑 ===');
{
  // XX-EQUIP-002 才填表。现在就填 = 跳阶段,必须报出来。
  const tbl = existsSync(join(ROOT, TABLE)) ? read(TABLE) : '';
  const section = tbl.slice(tbl.indexOf('## 二、'), tbl.indexOf('## 三、'));
  const filled = (section.match(/\| — \| — \| — \| — \| — \|/g) || []).length === 0
    && /\| [^-|][^|]* \| [^-|][^|]* \| [^-|][^|]* \| [^-|][^|]* \| ✅/.test(section);
  ok('装备挂载位仍为空(留给 XX-EQUIP-002)', !filled,
     '检测到已填写 —— 若确实做完了 XX-EQUIP-002,请连同 gear-regression 一起更新本条');
}

console.log('\n=== [7] 装备显示名不得混入拉丁字母 ===');
{
  // 2026-10-10 外部审计报出:8 件传说装备里有 2 件写成 `dang kang 环` / `jian gu 刃`,
  // 另外 6 件是纯中文(红嫁衣/姥姥的簪/白泽之爪…)。玩家在装备栏会看到拼音。
  // 全站扫过只有这 2 处,但 `lint-gear-table` 原来只查 key 边界与挂载位,不查名字。
  //
  // ⚠️ 只拦**显示名 name**,绝不拦 id / from / slot:
  //   `from:'dangkang'` 是 gearFromSource 的反查键、必须保持拉丁,
  //   一并拦掉等于把 XX-EQUIP-005 的整条掉落链打断。
  const src = read('js/game/gear.js');
  const names = [...src.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
  ok('gear.js 里取得到装备名', names.length > 0, `取到 ${names.length} 个`);
  const latin = names.filter(n => /[A-Za-z]/.test(n));
  ok('没有混入拉丁字母的装备名', latin.length === 0,
     `混拉丁: ${latin.join(', ')} —— 显示名必须是纯中文`);

  // 顺带钉住:`from` 必须还是拉丁的(id 语义),防止有人「顺手汉化」把掉落链打断
  const froms = [...src.matchAll(/from:\s*'([^']+)'/g)].map(m => m[1]);
  const badFrom = froms.filter(f => !/^[a-z_]+$/.test(f));
  ok('from 保持拉丁 id(gearFromSource 的反查键,不可汉化)', badFrom.length === 0,
     `异常: ${badFrom.join(', ')}`);
}

if (fail === 0) {
  console.log('\n✅ 装备对照表门禁通过:三批 key 边界清晰,引用全部对得上真实文件');
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 装备可能挂在不存在的敌人上`);
  process.exit(1);
}
