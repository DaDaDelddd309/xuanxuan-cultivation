#!/usr/bin/env node
// gear-icon-assets-regression.mjs —— 物品图标资产层的门禁
//
// 【为什么要有这条】
//   js/game/gear.js 的 SLOTS 里 4 个 `icon:'g_head'` 字段全仓零消费方(死键),
//   GEAR 的 8 件装备连 icon 字段都没有,assets/ 下也没有任何物品图。
//   「图不存在」这件事**不会让任何一条既有测试变红** —— 缺图的表现是
//   玩家看到一块空白,和测试全绿可以同时成立。本条就是那个能变红的东西。
//
// 它查什么:
//   G1  GEAR_IDS 每件 + SLOTS 每槽,都能解析出一条图标路径(且指向约定文件名)
//   G2  每个图标文件在磁盘上真实存在、非空、确是 SVG、单文件 < 2KB
//   G3  反向注入自检:不存在的 gear id 必须判 false;**并且**真实存在的必须判 true
//       —— 只测前者的话,一个「永远返回 false」的判定函数也能让 G3 通过,
//          那是拿坏尺子量东西(见 AUTONOMY.md §3 第 2 条)
//   G4  解析器防退化:解析出的图标数必须 == GEAR_IDS.length,
//       且 GEAR_ICON_IDS 必须与 GEAR_IDS 同集(防「有人手抄了一份过期副本」)
//
// 退出码:0 = 通过;1 = 产品代码/资产有问题;2 = **门禁自身失效**(结论不可用)
//
// ⚠️ 2 存在的理由:空结果和干净结论长得一模一样,而「没发现问题」比
//   「发现问题」更危险。拿不到该拿的量就 exit 2,不许拿 0 冒充通过。
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const { GEAR, GEAR_IDS, SLOTS } = await import('../js/game/gear.js?v=17');
const { GEAR_ICON, GEAR_ICON_IDS, SLOT_ICON } = await import('../js/game/gearIcons.js?v=17');

let fail = 0;
const ok = (n, c, d = '') => {
  if (c) console.log(`  ✅ ${n}`);
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};

/** 门禁自己坏掉时用:退出码 2,和「产品有问题」的 1 区分开。 */
const fatal = (msg) => {
  console.log(`\n❌ 门禁自身失效:${msg}`);
  console.log('   —— 这是**度量工具**坏了,不是产品代码坏了。本次结论不可用。');
  process.exit(2);
};

/** G2/G3 共用的判定:这条路径背后有没有一个非空的真文件。 */
const judge = p => {
  if (typeof p !== 'string' || !p) return false;
  const abs = join(ROOT, p);
  if (!existsSync(abs)) return false;
  try { return readFileSync(abs, 'utf8').trim().length > 0; }
  catch { return false; }
};

// ─────────────────────────────────────────────────────────────
// G4 放在最前:数据没拿到就别往下跑,免得后面全在「通过」空集合
// ─────────────────────────────────────────────────────────────
console.log('\n=== [G4] 解析器防退化(拿不到量就不许下结论) ===');

if (!Array.isArray(GEAR_IDS) || GEAR_IDS.length === 0)
  fatal(`GEAR_IDS 取不到或为空:Array=${Array.isArray(GEAR_IDS)} len=${GEAR_IDS && GEAR_IDS.length}`);
if (!Array.isArray(SLOTS) || SLOTS.length === 0)
  fatal(`SLOTS 取不到或为空:Array=${Array.isArray(SLOTS)} len=${SLOTS && SLOTS.length}`);
if (typeof GEAR_ICON !== 'function' || typeof SLOT_ICON !== 'function')
  fatal(`gearIcons.js 没导出可调用的 GEAR_ICON / SLOT_ICON(契约破了)`);
if (!Array.isArray(GEAR_ICON_IDS))
  fatal(`GEAR_ICON_IDS 不是数组:${typeof GEAR_ICON_IDS}`);

ok(`解析到 ${GEAR_IDS.length} 件装备(非空)`, GEAR_ICON_IDS.length > 0, `GEAR_ICON_IDS.length=${GEAR_ICON_IDS.length}`);
if (GEAR_ICON_IDS.length === 0)
  fatal('解析出的图标数 = 0 —— 门禁一把数据都没拿到,却可能一路报「通过」');

// 核心防退化:数量必须与数据源一致
ok(`图标数 ${GEAR_ICON_IDS.length} == GEAR_IDS.length ${GEAR_IDS.length}`,
   GEAR_ICON_IDS.length === GEAR_IDS.length,
   GEAR_ICON_IDS.length === 0
     ? '解析器空转 —— 门禁自身失效'
     : `实测 ${GEAR_ICON_IDS.length} vs 期望 ${GEAR_IDS.length}`);

// 防「手抄副本」:两个清单必须逐个同集
const a = [...GEAR_IDS].sort().join(',');
const b = [...GEAR_ICON_IDS].sort().join(',');
ok('GEAR_ICON_IDS 与 GEAR_IDS 逐项一致(没被手抄成过期副本)', a === b,
   a === b ? '' : `GEAR_IDS=${a} / GEAR_ICON_IDS=${b}`);

ok('GEAR_ICON_IDS 里每一项在 GEAR 表里都真实存在',
   GEAR_ICON_IDS.every(id => Object.prototype.hasOwnProperty.call(GEAR, id)),
   GEAR_ICON_IDS.filter(id => !Object.prototype.hasOwnProperty.call(GEAR, id)).join(','));

// ─────────────────────────────────────────────────────────────
console.log('\n=== [G1] 每件装备 / 每个槽位都能解析出图标路径 ===');

const gearRows = GEAR_ICON_IDS.map(id => ({ id, path: GEAR_ICON(id) }));
const slotRows = SLOTS.map(s => ({ id: s.key, path: SLOT_ICON(s.key) }));

ok(`解析出 ${gearRows.length} 条装备图标路径(与 GEAR_IDS 同量)`,
   gearRows.length === GEAR_IDS.length && gearRows.every(r => typeof r.path === 'string'),
   `实测 ${gearRows.length} 条`);

for (const { id, path } of gearRows) {
  ok(`${id} → ${path}`, path === `assets/gear/${id}.svg`,
     path === null ? 'GEAR_ICON 返回 null' : `解析到 ${path},约定应为 assets/gear/${id}.svg`);
}
for (const { id, path } of slotRows) {
  ok(`槽位 ${id} → ${path}`, path === `assets/gear/slot-${id}.svg`,
     path === null ? 'SLOT_ICON 返回 null' : `解析到 ${path},约定应为 assets/gear/slot-${id}.svg`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n=== [G2] 图标文件真实存在且非空 ===');

const MAX_BYTES = 2048;   // 单文件 2KB 上限(交付要求)
const allRows = [...gearRows.map(r => ({ ...r, kind: '装备' })),
                 ...slotRows.map(r => ({ ...r, kind: '槽位' }))];

for (const { id, path, kind } of allRows) {
  const abs = join(ROOT, path);
  const exists = existsSync(abs);
  if (!exists) { ok(`${kind} ${id} 文件存在(${path})`, false, '磁盘上找不到'); continue; }
  const buf = readFileSync(abs);
  const src = buf.toString('utf8');
  ok(`${kind} ${id} 文件存在且非空(${path})`, buf.length > 0 && src.trim().length > 0,
     `size=${buf.length}B`);
  ok(`${kind} ${id} 是合法 SVG(有 viewBox 且继承 currentColor)`,
     /<svg[^>]*viewBox=/.test(src) && /currentColor/.test(src),
     '缺 viewBox 或缺 currentColor —— 不是本套图标该有的写法');
  ok(`${kind} ${id} 单文件 < ${MAX_BYTES}B`, buf.length < MAX_BYTES, `实测 ${buf.length}B`);
}

// 孤儿文件只报告、不判红:以后加图是正常事,判红会逼人改门禁
{
  const dir = join(ROOT, 'assets/gear');
  const onDisk = existsSync(dir)
    ? readdirSync(dir).filter(f => f.endsWith('.svg')).map(f => 'assets/gear/' + f)
    : [];
  const want = allRows.map(r => r.path);
  const orphan = onDisk.filter(p => !want.includes(p));
  const lost = want.filter(p => !onDisk.includes(p));
  console.log(`  ℹ 磁盘 ${onDisk.length} 个 svg / 引用 ${want.length} 个;孤儿 ${orphan.length} 个`);
  if (orphan.length) orphan.forEach(p => console.log(`     孤儿(无人引用):${p}`));
  if (lost.length) { fail++; console.log(`  ❌ 引用了但磁盘没有:${lost.join(', ')}`); }
}

// ─────────────────────────────────────────────────────────────
console.log('\n=== [G3] 反向注入自检(判定必须真的会变 false) ===');

const BOGUS = '__no_such_gear_id__';
ok(`不存在的装备 id '${BOGUS}' 解析为 null`, GEAR_ICON(BOGUS) === null, `实得 ${GEAR_ICON(BOGUS)}`);
ok(`不存在的装备 id '${BOGUS}' 判定为 false`, judge(GEAR_ICON(BOGUS)) === false);
ok(`不存在的槽位 'no_such_slot' 解析为 null`, SLOT_ICON('no_such_slot') === null);
ok(`不存在的槽位 'no_such_slot' 判定为 false`, judge(SLOT_ICON('no_such_slot')) === false);

// 原型链上的键必须同样判 false:普通对象 `GEAR['constructor']` 是真值,
// 一旦 GEAR_ICON 用 `if (GEAR[id])` 判定,存档里一件叫 constructor 的装备
// 就能凭空变出一条「看起来正常」的路径 —— 空白图,没人报错。
//
// ⚠️ 这三条**必须查 GEAR_ICON 的返回值本身**,不能只查 judge():
//   judge() 对任何不存在的文件都返回 false,所以哪怕 GEAR_ICON 编出了一条
//   'assets/gear/constructor.svg',judge() 照样是 false,断言照样绿。
//   —— 那样这条断言就只在检查「文件在不在」,而缺陷在「解析器乱编路径」这一层,
//   根本不在它管的范围内。反向注入实测踩过:去掉 own-property 守卫后,
//   只查 judge 的版本 EXIT=0,查返回值的版本才红。
for (const k of ['constructor', '__proto__', 'toString']) {
  ok(`原型链键 '${k}' 解析为 null(没编出路径)`, GEAR_ICON(k) === null, `实得 ${GEAR_ICON(k)}`);
  ok(`原型链键 '${k}' 判定为 false`, judge(GEAR_ICON(k)) === false);
}

// ★ 对照组:G3 的另一半。没有它,一个恒返回 false 的 judge 也能让上面全绿。
const CTRL = GEAR_ICON_IDS[0];
ok(`对照组:真实装备 '${CTRL}' 判定为 true(证明 judge 不是恒 false)`,
   judge(GEAR_ICON(CTRL)) === true, `实得 ${GEAR_ICON(CTRL)}`);

if (fail === 0) {
  console.log(`\n✅ 图标资产门禁通过:${gearRows.length} 件装备 + ${slotRows.length} 个槽位 = ${allRows.length} 个图标全部存在且非空`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 装备页会显示空白图`);
  process.exit(1);
}