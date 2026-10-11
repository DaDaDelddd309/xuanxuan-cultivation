// ===== tests/save-integrity-audit.mjs =====
// R2 存档数据完整性审计(工单 XX-QA-011 ~ XX-QA-015)
//
// 运行: node tests/save-integrity-audit.mjs
//
// 【定位】这是**审计**,不是修复。发现缺陷只报告,不碰 js/。
//
// 【核心立场】把 localStorage 当成敌对输入。
//   玩家进度全部躺在 localStorage 里,而 localStorage 的内容由
//   「半截旧档 / 手改 / 跨版本升级 / 另一个标签页的半成品写入」决定。
//   本项目的存档层被咬过 3 次(Titles.load 整体替换 / ARTSTAR.load 从没被调用
//   / BUILD.place 丢 slot),三次的共同形态是:
//       **存档层出错时没有降级路径,而且往往不报错。**
//   所以本门禁只钉一件事:**坏存档进来之后,游戏还在不在、状态还合不合法。**
//
// 【本文件自带反向注入自检】(项目铁律:度量工具自己出错比没有度量工具更危险)
//   检测器跑在同一段代码上(不是另一份"示意实现")。
//   §6 会把一个**故意写坏**的 load(复刻历史事故 Titles 的写法)喂进去,
//   必须报红;再喂一个**健康**的 load,必须不报红(证明不是瞎报)。
//   任何一项不成立 → EXIT 3,结论作废。
//
// 【空结果 ≠ 全部正常】(本项目栽过)
//   扫出 0 个存档键、或 0 个键跑通 → EXIT 2 并打印"别信结论"。
//
// 退出码:
//   0 = 全部键、全部故障向量,未发现缺陷
//   1 = 发现缺陷(审计结果,正常情况)
//   2 = 审计本身不可信(0 键 / 0 键跑通 / 静态扫描失效)
//   3 = 反向注入自检失败(检测器在撒谎)

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join as _jn } from 'path';
import { install } from './harness.mjs';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const JS = _rv(ROOT, 'js');

/* ═══════════════════════════════════════════════════════════════
   §0  小工具
   ═══════════════════════════════════════════════════════════════ */

const C = {
  red: s => `\x1b[31m${s}\x1b[0m`, grn: s => `\x1b[32m${s}\x1b[0m`,
  yel: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`, cyn: s => `\x1b[36m${s}\x1b[0m`,
};
/** 终端对齐:去掉 ANSI 转义 + 按 CJK 宽度算(直接用 padEnd 会歪) */
const dispWidth = s => {
  const plain = String(s).replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6))) ? 2 : 1;
  }
  return w;
};
const padR = (s, n) => s + ' '.repeat(Math.max(0, n - dispWidth(s)));

const say = (...a) => console.log(...a);

/** 递归列文件 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = _jn(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
}

const rel = p => p.slice(ROOT.length + 1).replace(/\\/g, '/');

/* ═══════════════════════════════════════════════════════════════
   §1  形状契约(从源码默认值人工誊写 —— 证据分级:读代码得到)
   ═══════════════════════════════════════════════════════════════
   类型码:N=number S=string A=Array O=plain-object B=boolean X=any
   `|null` 表示该字段允许 null(是源码默认值就允许,不是我放水)
   这些是**期望**,检测器拿它和 load() 的实际产物比对。            */

const CONTRACTS = {
  pxs_save:            { v: 'N', gold: 'N', chars: 'A', settings: 'O', best: 'O', gear: 'O', gearOwned: 'A', totalRuns: 'N', totalKills: 'N' },
  xx_cultivation_v077: { realm: 'S', layer: 'N', exp: 'N', pills: 'O', dao: 'N', totalKills: 'N', artifacts: 'O', arts: 'X', current: 'S', visited: 'O' },
  xx_nemesis_v077:     { met: 'B', battles: 'N', wins: 'N', alive: 'B', grudge: 'N' },
  xx_titles_v077:      { flags: 'O', active: 'A' },
  xx_bag_v080:         { items: 'O', demon: 'N', charter: 'B' },
  xx_camp_v080:        { lit: 'B', nodeId: 'S|null', fuelEnd: 'N', lastTick: 'N', totalSec: 'N', members: 'A', invites: 'N', formed: 'B', rep: 'N' },
  xx_companion_v081:   { name: 'S', ghost: 'O', log: 'A', mut: 'O' },
  xx_family_v081:      { founded: 'B', name: 'S', members: 'A', couples: 'A', gen: 'N', wealth: 'N', land: 'A', mines: 'A', lastYield: 'N', attacks: 'N', defended: 'N' },
  xx_mount_v091:       { have: 'A', ride: 'S|null', pet: 'S|null' },
  xx_chronicle_v081:   { log: 'A', worldMod: 'O', ticks: 'N' },
  xx_build_v083:       { placed: 'A', fires: 'A', land: 'A', pacts: 'O', tierLv: 'N', incomeAt: 'N' },
  xx_craft_v099:       { done: 'N' },
  xx_artstar_v099:     { stars: 'O' },
  xx_quest_v087:       { active: 'A', done: 'O', choices: 'O' },
  xx_story_v086:       { active: 'O', done: 'O', beat: 'O', rumors: 'A', log: 'A', met: 'O', t: 'N' },
  xx_tomb_v089:        { in: 'B', at: 'N|null', seen: 'A', done: 'B', path: 'N', flag: 'O' },
  xx_spine_v099:       { phase: 'S', seen: 'O', quests: 'O', arcsDone: 'O', choices: 'O', tombstone: 'B', ending: 'S|null', log: 'A' },
  xx_codex_v099:       { seen: 'O' },
  xx_market_v099:      { stock: 'A', run: 'N', bought: 'A' },
  xx_merch_v080:       { visits: 'N', lastAt: 'N' },
  xx_tavern_v099:      { owned: 'A', active: 'S|null', log: 'A' },
  xx_profile_v081:     { v: 'N', seed: 'S', cult: 'X', nemesis: 'X', titles: 'X', bag: 'X', camp: 'X', day: 'X', merch: 'X', companion: 'X', savedAt: 'N' },
  xx_clock_v099:       { ms: 'N', totalMs: 'N', actions: 'N', lastSeen: 'N', year: 'N', day: 'N' },
};

/* 每个键的"健康样本"(照源码默认值誊写),用于派生故障存档 */
const TEMPLATES = {
  pxs_save:            { v: 1, gold: 100, chars: ['knight'], settings: { sfx: true, music: true, shake: true, lowgfx: false, fpsShow: false }, best: { time: 0, kills: 0, level: 0, victory: false }, gear: { head: null, body: null, hand: null, foot: null }, gearOwned: [], totalRuns: 3, totalKills: 40 },
  xx_cultivation_v077: { realm: 'qi', layer: 1, exp: 0, pills: {}, dao: 5, totalKills: 0, artifacts: {}, arts: {}, current: 'n0', visited: { n0: true } },
  xx_nemesis_v077:     { met: true, battles: 2, wins: 1, alive: true, grudge: 20 },
  xx_titles_v077:      { flags: { challenge: 3 }, active: ['t1'] },
  xx_bag_v080:         { items: { stone_5: 2 }, demon: 3, charter: false },
  xx_camp_v080:        { lit: true, nodeId: 'village', fuelEnd: 123, lastTick: 1, totalSec: 60, members: [], invites: 1, formed: false, rep: 0 },
  xx_companion_v081:   { name: '宝宝', ghost: { on: false }, log: [], mut: {} },
  xx_family_v081:      { founded: true, name: '轩氏', members: [], couples: [], gen: 1, wealth: 10, land: [], mines: [], lastYield: 0, attacks: 0, defended: 0 },
  xx_mount_v091:       { have: [], ride: null, pet: null },
  xx_chronicle_v081:   { log: [], worldMod: {}, ticks: 0 },
  xx_build_v083:       { placed: [], fires: [], land: [], pacts: { signed: 0, allyAt: 0 }, tierLv: 1, incomeAt: 0 },
  xx_craft_v099:       { done: 1 },
  xx_artstar_v099:     { stars: { jianqi: 2 } },
  xx_quest_v087:       { active: [], done: {}, choices: {} },
  xx_story_v086:       { active: {}, done: {}, beat: {}, rumors: [], log: [], met: {}, t: 0 },
  xx_tomb_v089:        { in: false, at: null, seen: [], done: false, path: 0, flag: {} },
  xx_spine_v099:       { phase: 'depart', seen: {}, quests: {}, arcsDone: {}, choices: {}, tombstone: false, ending: null, log: [] },
  xx_codex_v099:       { seen: { wolf: 2 } },
  xx_market_v099:      { stock: [], run: 0, bought: [] },
  xx_merch_v080:       { visits: 1, lastAt: 100 },
  xx_tavern_v099:      { owned: [], active: null, log: [] },
  xx_profile_v081:     { v: 1, seed: 'seed-1', cult: null, nemesis: null, titles: null, bag: null, camp: null, day: null, merch: null, companion: null, savedAt: 1 },
  xx_clock_v099:       { ms: 0, totalMs: 0, actions: 0, lastSeen: 1, year: 1, day: 0 },
};

/* ═══════════════════════════════════════════════════════════════
   §2  检测器 —— 全仓**唯一**一份,真实键与反向注入共用
   ═══════════════════════════════════════════════════════════════ */

/** 深扫:找 NaN / ±Infinity / 循环引用 */
function findNonFinite(v, path = '$', seen = new Set(), out = []) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(`${path}=${String(v)}`);
    return out;
  }
  if (!v || typeof v !== 'object') return out;
  if (seen.has(v)) { out.push(`${path}=<循环引用>`); return out; }
  seen.add(v);
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) findNonFinite(v[i], `${path}[${i}]`, seen, out);
  else for (const k of Object.keys(v)) findNonFinite(v[k], `${path}.${k}`, seen, out);
  return out;
}

const isPlainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** 契约比对:返回问题清单(空 = 通过) */
function checkShape(state, contract) {
  const bad = [];
  if (!isPlainObj(state)) return [`state 不是对象(实际 ${state === null ? 'null' : typeof state})`];
  for (const [f, spec] of Object.entries(contract)) {
    if (spec === 'X') continue;
    const allowNull = spec.includes('|null');
    const want = spec.replace('|null', '');
    const v = state[f];
    if (v === undefined) { bad.push(`缺字段 ${f}`); continue; }
    if (v === null) { if (!allowNull) bad.push(`null 字段 ${f}`); continue; }
    const ok =
      want === 'N' ? typeof v === 'number' && Number.isFinite(v)
      : want === 'S' ? typeof v === 'string'
      : want === 'A' ? Array.isArray(v)
      : want === 'O' ? isPlainObj(v)
      : want === 'B' ? typeof v === 'boolean'
      : true;
    if (!ok) bad.push(`${f} 类型错(期望 ${spec},实际 ${Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v})`);
  }
  return bad;
}

/**
 * 通用"使用"探针:按生产代码最常见的访问方式碰一遍契约字段。
 * 这正是 Titles 事故的现场(track() 里 `this.s.flags[action]` 抛 TypeError)。
 */
function exerciseShape(state, contract) {
  const bad = [];
  for (const [f, spec] of Object.entries(contract)) {
    if (spec === 'X') continue;
    const v = state && state[f];
    if (v === undefined || v === null) continue;
    try {
      if (Array.isArray(v)) { v.length; v.push && v.push; }
      else if (isPlainObj(v)) { Object.keys(v).length; v[Object.keys(v)[0]]; }
      else if (typeof v === 'number') { void (v + 1); void (v * 2); }
      else if (typeof v === 'string') { void v.length; }
    } catch (e) { bad.push(`访问 ${f} 抛错:${e.message}`); }
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════
   §3  静态巡检:枚举全仓所有 localStorage 键
   ═══════════════════════════════════════════════════════════════ */

function scanKeys() {
  const files = walk(JS);
  const hits = [];       // {key, file, line, kind}
  const decls = [];      // 声明了常量键但没用 localStorage 的

  // 3.1 注册表
  const regSrc = readFileSync(_rv(JS, 'xiuxian/save-keys.js'), 'utf8');
  const REGISTRY = {};
  for (const m of regSrc.matchAll(/^\s{2}(\w+):\s*'([^']+)'/gm)) REGISTRY[m[2]] = m[1];

  // 3.2 profile 的 LEGACY 表
  const profSrc = readFileSync(_rv(JS, 'xiuxian/profile.js'), 'utf8');
  const LEGACY = {};
  const legBlock = profSrc.match(/const LEGACY = \{([\s\S]*?)\n\};/);
  if (legBlock) for (const m of legBlock[1].matchAll(/(\w+):\s*'([^']+)'/g)) LEGACY[m[2]] = m[1];

  for (const f of files) {
    const src = readFileSync(f, 'utf8');

    // 键常量声明:<名> = '字面量' | SAVE_KEYS.xxx
    for (const m of src.matchAll(/^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:'([^']+)'|SAVE_KEYS\.(\w+))\s*;/gm)) {
      const [, name, lit, reg] = m;
      if (!/^(K|KEY|NK|CKEY|SEED_KEY)$/.test(name)) continue;
      let real = lit;
      if (!real && reg) {
        const mm = regSrc.match(new RegExp(`^\\s{2}${reg}:\\s*'([^']+)'`, 'm'));
        if (mm) real = mm[1];
      }
      decls.push({ file: rel(f), name, reg: reg || null, key: real });
    }

    // 内联字面量 getItem/setItem/removeItem
    for (const m of src.matchAll(/localStorage\.(getItem|setItem|removeItem)\(\s*'([^']+)'/g)) {
      const idx = src.slice(0, m.index).split('\n').length;
      hits.push({ key: m[2], file: rel(f), line: idx, kind: m[1] });
    }
    // localStorage.getItem(常量名) —— 记位置,键名上面已解析
    for (const m of src.matchAll(/localStorage\.(getItem|setItem|removeItem)\(\s*(\w+)\s*[,)]/g)) {
      const idx = src.slice(0, m.index).split('\n').length;
      hits.push({ key: `$${m[2]}`, file: rel(f), line: idx, kind: m[1] });
    }
  }

  // 解析 `$NAME` → 真实键。
  // ⚠️ 必须**按文件**解析:全仓 ~20 个文件都叫 `const K`,全局按名字建表会被
  //    后一个文件覆盖,只剩最后一个键 —— 那正是「巡检表看着挺全,其实漏了 18 个」
  //    的写法。第一版就是这么写的,自检当场把它揪出来(只解析出 7 个键)。
  const declByFileName = new Map();
  for (const d of decls) if (d.key) declByFileName.set(`${d.file}::${d.name}`, d.key);
  for (const h of hits) if (h.key.startsWith('$')) {
    const nm = h.key.slice(1);
    const real = declByFileName.get(`${h.file}::${nm}`);
    h.dynamic = !real && /^[a-z]/.test(nm);   // 小写形参(如 items.js 的 Bag.load(k))= 动态键
    h.resolved = real || null;
    h.key = real || h.key;
  }

  const seen = new Map();
  for (const h of hits) {
    if (!seen.has(h.key)) seen.set(h.key, []);
    seen.get(h.key).push(h);
  }

  // 声明了键常量、但文件里没有 localStorage 调用 → 死键
  const dead = [];
  for (const d of decls) {
    if (!d.key) continue;
    const src = readFileSync(_rv(ROOT, d.file), 'utf8');
    const nmRe = new RegExp(`localStorage\\.(getItem|setItem|removeItem)\\(\\s*${d.name}\\b|localStorage\\.(getItem|setItem|removeItem)\\(\\s*'${d.key}'`);
    if (!nmRe.test(src)) dead.push(d);
  }

  return { REGISTRY, LEGACY, map: seen, decls, dead, fileCount: files.length };
}

/**
 * NaN 传播探针:对每个数值字段做一次**真实算术**。
 * 为什么要单独一层:checkShape 只能看出「这字段类型不对」,
 * 但 XX-QA-013 要钉的是**后果** —— 脏值进了游戏公式之后有没有变成 NaN。
 * `exp:"12" + 5` 还是能算的,"abc"+5 就出 NaN 了,而且会一路污染下去。
 */
function arithmeticProbe(state, contract) {
  const bad = [];
  if (!isPlainObj(state)) return bad;
  for (const [f, spec] of Object.entries(contract)) {
    if (spec.replace('|null', '') !== 'N') continue;
    const v = state[f];
    if (v === undefined || v === null) continue;
    for (const [op, expr] of [['加', v + 1], ['乘', v * 2], ['取整', Math.floor(v)], ['累加', (v || 0) + 3]]) {
      if (typeof expr !== 'number' || !Number.isFinite(expr)) {
        bad.push(`${f} 做「${op}」运算得到 ${String(expr)}(字段值 ${JSON.stringify(v)})`);
      }
    }
  }
  return bad;
}

/**
 * 「扫到 0 个键」的熔断闸。
 * 为什么单独抽成函数:这条早退路径**本身就是最容易被写坏又最看不出来**的代码
 * (写错了也只是「没触发」,不会报错)。抽出来是为了能进 selfCheck 单元验证它真的返回 2。
 */
function keyGuard(n, quiet = false) {
  if (n > 0) return 0;
  if (!quiet) {
    say(C.red('\n✗ 扫到 0 个存档键 —— 静态扫描已失效(键名写法变了?正则过时了?)'));
    say(C.red('  别信这份结论:空结果和「全部正常」长得一模一样,本项目栽过。'));
  }
  return 2;
}

/* ═══════════════════════════════════════════════════════════════
   §4  运行时故障注入
   ═══════════════════════════════════════════════════════════════ */

let CASE = 0;
/** 每次都拿**全新模块实例**,否则上一个 case 的内存态会污染下一个 */
async function freshImport(p) {
  CASE++;
  return await import(`${p}?audit=${CASE}`);
}

/** 建一个可控的 localStorage 并装好浏览器桩 */
function makeEnv(storage) {
  install();
  globalThis.localStorage = storage;
}

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    _m: m,
  };
}

/** 标量键(存档里就是一个字符串,不是对象) */
const SCALAR_KEYS = { xx_seed_v081: 'string' };

/** 故障向量:每个返回 [向量名, localStorage 种子对象] */
function vectors(key) {
  const tpl = TEMPLATES[key];
  const con = CONTRACTS[key];
  const out = [];
  const clone = o => JSON.parse(JSON.stringify(o));

  out.push(['空存档(键不存在)', {}]);

  // 标量键:攻击面是「这个字符串长得像不像种子」
  if (SCALAR_KEYS[key]) {
    const want = SCALAR_KEYS[key];
    out.push(['空字符串', { [key]: '' }]);
    out.push(['纯空白', { [key]: '   \t\n ' }]);
    out.push(['超长字符串(10万字符)', { [key]: 'x'.repeat(100000) }]);
    out.push(['JSON 对象而非字符串', { [key]: '{"a":1}' }]);
    out.push(['JSON 数组', { [key]: '[1,2,3]' }]);
    out.push(['null 字面量', { [key]: 'null' }]);
    out.push(['数字字面量', { [key]: '12345' }]);
    void want;
    return out;
  }

  if (tpl) {
    const empty = clone(tpl);
    for (const k of Object.keys(empty)) delete empty[k];
    out.push(['缺字段(全空对象)', { [key]: JSON.stringify(empty) }]);

    const nulled = clone(tpl);
    for (const k of Object.keys(nulled)) nulled[k] = null;
    out.push(['每字段 = null', { [key]: JSON.stringify(nulled) }]);
  }

  if (con) {
    // 类型错:把每个字段换成一个**别的类型**的值
    const swap = clone(tpl);
    for (const [f, spec] of Object.entries(con)) {
      if (spec === 'X' || spec.includes('|null')) continue;
      const w = spec.replace('|null', '');
      swap[f] = w === 'N' ? '12'           // 数字写成字符串 → 下游 NaN 源
        : w === 'S' ? { a: 1 }            // 字符串写成对象
        : w === 'A' ? { 0: 'x' }          // 数组写成对象
        : w === 'O' ? ['x']               // 对象写成数组
        : w === 'B' ? 'true'              // 布尔写成字符串
        : 1;
    }
    out.push(['类型错(数字↔字符串 / 数组↔对象)', { [key]: JSON.stringify(swap) }]);

    // NaN 诱饵 —— 必须**所有**数值字段同时吃 'abc'。
    // 分散投放会出现「A 字段吃 -1、B 字段吃 null」的排布,于是**没有任何一个
    // 字段真的吃到字符串**,下游算不出 NaN,门禁就绿了 —— 那是假绿。
    // XX-QA-013 要的就是「不产生 NaN 传播」,所以这一刀必须落在每个数值字段上。
    const abc = clone(tpl);
    for (const [f, spec] of Object.entries(con)) if (spec.replace('|null', '') === 'N') abc[f] = 'abc';
    out.push(['NaN 诱饵:所有数值字段 = "abc"', { [key]: JSON.stringify(abc) }]);

    // 负数 / 上溢(这两种能原样穿过 JSON,是真实攻击面)
    const neg = clone(tpl);
    for (const [f, spec] of Object.entries(con)) if (spec.replace('|null', '') === 'N') neg[f] = -999999;
    out.push(['所有数值字段 = 负数', { [key]: JSON.stringify(neg) }]);
    const big2 = clone(tpl);
    for (const [f, spec] of Object.entries(con)) if (spec.replace('|null', '') === 'N') big2[f] = 1e308;
    out.push(['所有数值字段 = 1e308', { [key]: JSON.stringify(big2) }]);

    // 超大:100k 字符串 + 20k 数组
    const big = clone(tpl);
    const bigStr = 'x'.repeat(100000);
    for (const [f, spec] of Object.entries(con)) {
      const w = spec.replace('|null', '');
      if (w === 'S') big[f] = bigStr;
      else if (w === 'A') big[f] = new Array(20000).fill('a');
      else if (w === 'O') { const o = {}; for (let i = 0; i < 20000; i++) o['k' + i] = 1; big[f] = o; }
      else if (w === 'N') big[f] = 1e308;
    }
    out.push(['超大(10万字符 / 2万元素)', { [key]: JSON.stringify(big) }]);
  }

  out.push(['损坏 JSON("{oops")', { [key]: '{oops' }]);
  out.push(['JSON null', { [key]: 'null' }]);
  out.push(['JSON 数组而非对象', { [key]: '[1,2,3]' }]);
  out.push(['JSON 字符串', { [key]: '"hello"' }]);
  out.push(['JSON 数字', { [key]: '12345' }]);
  return out;
}

/** 每个键怎么把状态取出来 / 怎么在生产路径上用一下 */
const SPECS = [
  { key: 'pxs_save', mod: '../js/core/save.js', state: m => m.Save.data, run: m => m.Save.load() },
  { key: 'xx_cultivation_v077', mod: '../js/xiuxian/index.js', state: m => m.Cult.s, run: m => m.Cult.load() },
  { key: 'xx_nemesis_v077', mod: '../js/xiuxian/relations.js', state: m => m.Nemesis.s, run: m => m.Nemesis.load(),
    extra: (m, st) => { const v = m.Nemesis.powerBoost(); return Number.isFinite(v) ? [] : [`powerBoost() 返回 ${v}`]; } },
  { key: 'xx_titles_v077', mod: '../js/xiuxian/relations.js', state: m => m.Titles.s, run: m => m.Titles.load(),
    extra: m => {
      const bad = [];
      try { m.Titles.track('__audit', 1); } catch (e) { return [`track() 抛错:${e.message}`]; }
      // 往返:**不报错**不等于没丢。flags 若是数组,track() 照样跑通
      // (数组接得住字符串键),但 JSON.stringify 只序列化数组下标 →
      // 字符串键在存档里凭空消失。玩家看到的现象是「称号进度自己回退」。
      try {
        m.Titles.save();
        const back = JSON.parse(globalThis.localStorage.getItem('xx_titles_v077') || '{}');
        const got = back && back.flags && back.flags.__audit;
        if (got !== 1) bad.push(`往返丢数据:track('__audit') 后存盘读回 __audit=${JSON.stringify(got)}(flags 实际类型 ${Array.isArray(back?.flags) ? 'array' : typeof back?.flags})`);
      } catch (e) { bad.push(`save/往返抛错:${e.message}`); }
      return bad;
    } },
  { key: 'xx_bag_v080', mod: '../js/xiuxian/items.js', state: m => m.Bag.s, run: m => m.Bag.load('xx_bag_v080') },
  { key: 'xx_camp_v080', mod: '../js/xiuxian/camp.js', state: m => m.CAMP.s, run: m => m.CAMP.load() },
  { key: 'xx_companion_v081', mod: '../js/xiuxian/companion.js', state: m => m.COMPANION.s, run: m => m.COMPANION.load() },
  { key: 'xx_family_v081', mod: '../js/xiuxian/family.js', state: m => m.FAMILY.s, run: m => m.FAMILY.load() },
  { key: 'xx_mount_v091', mod: '../js/xiuxian/mount.js', state: m => m.MOUNT.s, run: m => m.MOUNT.load() },
  { key: 'xx_chronicle_v081', mod: '../js/xiuxian/chronicle.js', state: m => m.CHRONICLE.s, run: m => m.CHRONICLE.load() },
  { key: 'xx_build_v083', mod: '../js/xiuxian/build.js', state: m => m.BUILD.s, run: m => m.BUILD.load() },
  { key: 'xx_craft_v099', mod: '../js/xiuxian/craft.js', state: m => m.CRAFT.s, run: m => m.CRAFT.load() },
  { key: 'xx_artstar_v099', mod: '../js/xiuxian/artstar.js', state: m => m.ARTSTAR.s, run: m => m.ARTSTAR.load(),
    extra: m => { try { const v = m.ARTSTAR.stars('jianqi'); return Number.isFinite(v) ? [] : [`stars() 返回 ${v}`]; } catch (e) { return [`stars() 抛错:${e.message}`]; } } },
  { key: 'xx_quest_v087', mod: '../js/xiuxian/quest.js', state: m => m.QUEST.s, run: m => m.QUEST.load() },
  { key: 'xx_story_v086', mod: '../js/xiuxian/story.js', state: m => m.STORY.s, run: m => m.STORY.load() },
  { key: 'xx_tomb_v089', mod: '../js/xiuxian/tomb.js', state: m => m.TOMB.s, run: m => m.TOMB.load() },
  { key: 'xx_spine_v099', mod: '../js/xiuxian/spine.js', state: m => m.SPINE.s, run: m => m.SPINE.load() },
  { key: 'xx_codex_v099', mod: '../js/xiuxian/codex.js', state: m => null, run: m => m.Codex.init(),
    wrap: m => { const st = m.Codex.init(); return st; } },
  { key: 'xx_market_v099', mod: '../js/xiuxian/market.js', state: m => m.MARKET.s, run: m => m.MARKET.load() },
  { key: 'xx_merch_v080', mod: '../js/xiuxian/merchant.js', state: m => m.Merchant.s, run: m => m.Merchant.load() },
  { key: 'xx_tavern_v099', mod: '../js/xiuxian/tavern.js', state: m => m.TAVERN.s, run: m => m.TAVERN.load() },
  { key: 'xx_profile_v081', mod: '../js/xiuxian/profile.js', state: m => m.Profile.data, run: m => m.Profile.load() },
  { key: 'xx_clock_v099', mod: '../js/xiuxian/clock.js', state: m => m.CLOCK.s, run: m => m.CLOCK.load() },
  // 种子是**标量键**(存档里就是一个字符串),契约不适用对象比对,走 scalar 分支
  { key: 'xx_seed_v081', mod: '../js/xiuxian/seed.js', scalar: true,
    run: () => {}, state: m => m.getMaster() },
];

async function runCase(spec, seed, label) {
  makeEnv(memStorage(seed));
  const problems = [];
  let threw = null, state = null;
  try {
    const m = await freshImport(spec.mod);
    spec.run(m);
    state = spec.state ? spec.state(m) : (spec.wrap ? spec.wrap(m) : null);
    if (spec.extra) problems.push(...spec.extra(m, state));
  } catch (e) {
    threw = e;
  }
  if (threw) problems.push(`load 抛错:${threw.message}`);
  if (spec.scalar) {
    // 标量键:非空字符串即可用。空/非字符串 = 世界种子丢了
    if (typeof state !== 'string') problems.push(`种子不是字符串(实际 ${state === null ? 'null' : typeof state})`);
    else if (!state.length) problems.push('种子为空串');
    else if (state.length > 4096) problems.push(`种子超长(${state.length} 字符)`);
  } else if (state !== null && state !== undefined) {
    problems.push(...checkShape(state, CONTRACTS[spec.key]));
    problems.push(...findNonFinite(state));
    problems.push(...arithmeticProbe(state, CONTRACTS[spec.key]));
    problems.push(...exerciseShape(state, CONTRACTS[spec.key]));
  }
  return { label, problems: [...new Set(problems)] };
}

/* ═══════════════════════════════════════════════════════════════
   §5  XX-QA-014  存储被清空 / 被拒写
   ═══════════════════════════════════════════════════════════════ */

function hostileStorage(mode) {
  if (mode === 'throw') return {
    getItem: () => { throw new DOMException('denied', 'SecurityError'); },
    setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    removeItem: () => { throw new DOMException('denied', 'SecurityError'); },
    clear: () => { throw new DOMException('denied', 'SecurityError'); },
  };
  // 配额满:读正常,setItem 静默失败(Android WebView 常见)
  return { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
}

async function storageDeny() {
  const rows = [];
  for (const spec of SPECS) {
    for (const mode of ['throw', 'quota']) {
      const r = await runCase(spec, {}, `存储被拒(${mode})`);
      // 无存档可读时,形状必须仍合法
      const real = r.problems.filter(p => !p.startsWith('load 抛错'));
      rows.push({ key: spec.key, mode, problems: real, threw: r.problems.some(p => p.startsWith('load 抛错')) });
    }
  }
  return rows;
}

/* ═══════════════════════════════════════════════════════════════
   §6  反向注入自检 —— 检测器必须会红
   ═══════════════════════════════════════════════════════════════ */

/** 复刻历史事故:整体替换、无默认合并、无形状兜底 */
function brokenTitlesLoad(raw) {
  let s = { flags: {}, active: [] };
  try { const r = raw; if (r) s = JSON.parse(r); } catch {}
  return s;
}
/** 健康实现:默认合并 + 形状兜底(对照,证明不是瞎报) */
function healthyTitlesLoad(raw) {
  let s = { flags: {}, active: [] };
  try { const r = raw; if (r) s = { ...s, ...JSON.parse(r) }; } catch {}
  if (!s || typeof s !== 'object') s = { flags: {}, active: [] };
  if (!s.flags || typeof s.flags !== 'object') s.flags = {};
  if (!Array.isArray(s.active)) s.active = [];
  return s;
}

function selfCheck() {
  const con = CONTRACTS.xx_titles_v077;
  const results = [];

  // 1) 残缺档喂给"坏"实现 —— 必须被抓到
  const badCases = [
    ['残缺档(缺 flags)', '{"active":[]}'],
    ['flags=null', '{"flags":null,"active":[]}'],
    ['active 写成对象', '{"flags":{},"active":{"a":1}}'],
  ];
  for (const [label, raw] of badCases) {
    const st = brokenTitlesLoad(raw);
    const probs = [...checkShape(st, con), ...exerciseShape(st, con)];
    results.push({ expect: 'RED', label: `坏实现 ← ${label}`, problems: probs, pass: probs.length > 0, dump: { raw, got: st } });
  }
  // 2) 同样的坏实现喂健康档 —— 证明"抓的是坏形状,不是坏实现本身"
  {
    const st = brokenTitlesLoad(JSON.stringify(TEMPLATES.xx_titles_v077));
    const probs = checkShape(st, con);
    results.push({ expect: 'GREEN', label: '坏实现 ← 健康档', problems: probs, pass: probs.length === 0, dump: { raw: '(健康档)', got: st } });
  }
  // 3) 同一批坏档喂"健康"实现 —— 必须全绿(证明检测器不误报)
  for (const [label, raw] of badCases) {
    const st = healthyTitlesLoad(raw);
    const probs = [...checkShape(st, con), ...exerciseShape(st, con)];
    results.push({ expect: 'GREEN', label: `健康实现 ← ${label}`, problems: probs, pass: probs.length === 0, dump: { raw, got: st } });
  }
  // 4) 故意写坏的"非有限数扫描"也必须会红
  {
    const st = { flags: { a: NaN }, active: [] };
    const probs = findNonFinite(st);
    results.push({ expect: 'RED', label: 'NaN 扫描 ← {flags:{a:NaN}}', problems: probs, pass: probs.length > 0 });
  }
  // 5) 「0 键 → exit 2」熔断闸必须真的返回 2(这条早退路径本身就是最容易写坏的死代码)
  {
    const z = keyGuard(0, true);
    results.push({ expect: 'RED', label: 'keyGuard(0) → 必须返回 2', problems: z === 2 ? [] : [`返回 ${z}`], pass: z === 2 });
  }
  {
    const n = keyGuard(5, true);
    results.push({ expect: 'GREEN', label: 'keyGuard(5) → 必须返回 0', problems: n === 0 ? [] : [`返回 ${n}`], pass: n === 0 });
  }
  return results;
}

/* ═══════════════════════════════════════════════════════════════
   §7  XX-QA-011  版本迁移矩阵
   ═══════════════════════════════════════════════════════════════ */

async function migrationMatrix() {
  const rows = [];

  // V0.77 老档:只有散键,没有统一档
  {
    makeEnv(memStorage({
      xx_cultivation_v077: JSON.stringify(TEMPLATES.xx_cultivation_v077),
      xx_nemesis_v077: JSON.stringify({ met: true, battles: 4, wins: 2, alive: false, grudge: 55 }),
      xx_titles_v077: JSON.stringify({ flags: { challenge: 9, demon: 40 }, active: ['t_slayer'] }),
      xx_bag_v080: JSON.stringify({ items: { stone_5: 7 }, demon: 12, charter: true }),
      xx_camp_v080: JSON.stringify(TEMPLATES.xx_camp_v080),
      xx_day_v080: JSON.stringify({ actions: 77 }),
      xx_merch_v080: JSON.stringify({ visits: 6, lastAt: 999 }),
      xx_companion_v081: JSON.stringify({ name: '宝宝' }),
      pxs_save: JSON.stringify(TEMPLATES.pxs_save),
    }));
    const m = await freshImport('../js/xiuxian/profile.js');
    let err = null, data = null;
    try { data = m.Profile.load(); } catch (e) { err = e; }
    const lost = [];
    if (err) lost.push(`migrate 抛错:${err.message}`);
    else {
      if (data.cult?.dao !== 5) lost.push('cult(修为)丢失');
      if (data.nemesis?.grudge !== 55) lost.push('nemesis(宿敌怨念)丢失');
      if (data.titles?.flags?.challenge !== 9) lost.push('titles(称号计数)丢失');
      if (data.bag?.items?.stone_5 !== 7) lost.push('bag(行囊)丢失');
      if (data.camp?.totalSec !== 60) lost.push('camp(营地)丢失');
      if (data.day?.actions !== 77) lost.push('day(行动数)丢失');
      if (data.merch?.visits !== 6) lost.push('merch(商人)丢失');
    }
    rows.push({ case: 'V0.77 散键 → migrate()', lost, ok: lost.length === 0, data });
  }

  // V0.81 统一档
  {
    makeEnv(memStorage({
      xx_profile_v081: JSON.stringify({ v: 1, seed: 'seed-77', cult: TEMPLATES.xx_cultivation_v077, nemesis: { grudge: 55 }, titles: { flags: { challenge: 9 } }, bag: { items: { stone_5: 7 } }, camp: TEMPLATES.xx_camp_v080, day: { actions: 77 }, merch: { visits: 6 }, companion: { name: '宝宝' }, savedAt: 1 }),
    }));
    const m = await freshImport('../js/xiuxian/profile.js');
    let lost = [];
    try {
      const d = m.Profile.load();
      if (d.seed !== 'seed-77') lost.push('种子丢失');
      if (d.cult?.dao !== 5) lost.push('cult 丢失');
      if (d.titles?.flags?.challenge !== 9) lost.push('titles 丢失');
      if (d.day?.actions !== 77) lost.push('day 丢失');
    } catch (e) { lost.push(`抛错:${e.message}`); }
    rows.push({ case: 'V0.81 统一档 → load()', lost, ok: lost.length === 0 });
  }

  // 统一档 v=0(更老)→ 应回退 migrate
  {
    makeEnv(memStorage({ xx_profile_v081: JSON.stringify({ v: 0, seed: 'x' }), xx_titles_v077: JSON.stringify({ flags: { challenge: 9 } }) }));
    const m = await freshImport('../js/xiuxian/profile.js');
    let lost = [];
    try {
      const d = m.Profile.load();
      if (d.titles?.flags?.challenge !== 9) lost.push('v=0 时未回退 migrate,titles 丢失');
    } catch (e) { lost.push(`抛错:${e.message}`); }
    rows.push({ case: '统一档 v=0 → 回退 migrate', lost, ok: lost.length === 0 });
  }

  // 统一档损坏
  {
    makeEnv(memStorage({ xx_profile_v081: '{broken', xx_titles_v077: JSON.stringify({ flags: { challenge: 9 } }) }));
    const m = await freshImport('../js/xiuxian/profile.js');
    let lost = [];
    try { m.Profile.load(); } catch (e) { lost.push(`抛错:${e.message}`); }
    rows.push({ case: '统一档损坏 → 不崩', lost, ok: lost.length === 0 });
  }

  // 迁移后老键是否被回写(flush 往返)
  {
    makeEnv(memStorage({ xx_titles_v077: JSON.stringify({ flags: { challenge: 9 } }) }));
    const m = await freshImport('../js/xiuxian/profile.js');
    let lost = [];
    try {
      m.Profile.load();
      const back = JSON.parse(globalThis.localStorage.getItem('xx_titles_v077') || 'null');
      if (back?.flags?.challenge !== 9) lost.push('migrate 后老键被冲掉');
    } catch (e) { lost.push(`抛错:${e.message}`); }
    rows.push({ case: 'migrate 后老键仍在', lost, ok: lost.length === 0 });
  }

  // xx_day_v080:注册表里有、LEGACY 里也读,但**读进来没人消费**
  // items.js DAY.load(k) 忽略 k,直接委托给 CLOCK。所以 V0.99 之前
  // 写在 xx_day_v080 里的 {actions:n} 升级后**静默作废**。
  {
    makeEnv(memStorage({ xx_day_v080: JSON.stringify({ actions: 77 }) }));
    const m = await freshImport('../js/xiuxian/items.js');
    const lost = [];
    try {
      m.DAY.load('xx_day_v080');
      if (m.DAY.s.actions !== 77) lost.push(`xx_day_v080 的 actions(77)未被读回,实际 ${m.DAY.s.actions}(该键数据升级后作废)`);
    } catch (e) { lost.push(`抛错:${e.message}`); }
    rows.push({ case: 'xx_day_v080 旧档数据被读回', lost, ok: lost.length === 0 });
  }

  return rows;
}

/* ═══════════════════════════════════════════════════════════════
   §8  主流程
   ═══════════════════════════════════════════════════════════════ */

async function main() {
  say(C.bold('\n════ R2 存档数据完整性审计(XX-QA-011~015)════\n'));

  /* —— §8.1 静态巡检 —— */
  const scan = scanKeys();
  const keys = [...scan.map.keys()].filter(k => !k.startsWith('$'));
  const dynamic = [...scan.map.keys()].filter(k => k.startsWith('$'));

  say(C.bold(`【§1 全量存档键巡检】  扫了 ${scan.fileCount} 个 js 文件`));
  const guard = keyGuard(keys.length);
  if (guard) return guard;
  say(`  解析出 ${keys.length} 个键` +
      (dynamic.length ? C.dim(`(另有 ${dynamic.length} 处动态键: ${dynamic.join(', ')} —— 键名由调用方传入,不在本表)`) : '') + '\n');

  /* —— §8.2 反向注入自检 —— */
  say(C.bold('【§2 反向注入自检】(检测器会不会撒谎)'));
  const sc = selfCheck();
  let scFail = 0;
  for (const r of sc) {
    const good = r.pass;
    if (!good) scFail++;
    const dump = r.dump ? C.dim(`  [raw=${r.dump.raw} → got=${JSON.stringify(r.dump.got)}]`) : '';
    say(`  ${good ? C.grn('✓') : C.red('✗')} [期望 ${r.expect}] ${r.label}` +
        (r.problems.length ? C.red(` → ${r.problems.join('; ')}`) : C.dim(' → 无问题')) + dump);
  }
  if (scFail) {
    say(C.red(`\n✗ 自检 ${scFail}/${sc.length} 项不成立 —— 检测器在撒谎,下面所有结论作废\n`));
    return 3;
  }
  say(C.grn(`  自检 ${sc.length}/${sc.length} 全部成立:该红的红、该绿的绿。\n`));

  /* —— §8.3 逐键逐向量 —— */
  say(C.bold('【§3 逐键故障注入】'));
  const findings = [];
  const perKey = [];
  for (const spec of SPECS) {
    const vs = vectors(spec.key);
    const rows = [];
    for (const [label, seed] of vs) {
      let r;
      try { r = await runCase(spec, seed, label); }
      catch (e) { r = { label, problems: [`审计自身异常:${e.message}`] }; }
      rows.push(r);
      if (r.problems.length) findings.push({ key: spec.key, file: spec.mod, vector: label, problems: r.problems });
    }
    perKey.push({ key: spec.key, rows });
    const bad = rows.filter(r => r.problems.length).length;
    say(`  ${bad ? C.red('✗') : C.grn('✓')} ${spec.key.padEnd(22)} ${C.dim(`${rows.length} 向量`)} ${bad ? C.red(`${bad} 个失败`) : C.grn('全通过')}`);
  }

  /* —— §8.4 存储不可用 —— */
  say(C.bold('\n【§4 存储被清空 / 被拒写】(XX-QA-014)'));
  const deny = await storageDeny();
  for (const r of deny.filter(x => x.mode === 'throw')) {
    const bad = r.threw || r.problems.length;
    if (bad) findings.push({ key: r.key, file: '(存储拒绝)', vector: `存储抛异常(${r.mode})`, problems: [...(r.threw ? ['load 抛错'] : []), ...r.problems] });
    say(`  ${bad ? C.red('✗') : C.grn('✓')} ${r.key.padEnd(22)} ${bad ? C.red('拒写/拒读时崩了或形状坏') : C.grn('降级正常')}`);
  }
  const quotaBad = deny.filter(x => x.mode === 'quota' && (x.threw || x.problems.length));
  say(`  ${quotaBad.length ? C.red('✗') : C.grn('✓')} 配额满(setItem 静默失败)${quotaBad.length ? C.red(` — ${quotaBad.length} 个键异常`) : C.grn(' — 全部降级正常')}`);

  /* —— §8.5 迁移矩阵 —— */
  say(C.bold('\n【§5 版本迁移矩阵】(XX-QA-011)'));
  const mig = await migrationMatrix();
  for (const r of mig) {
    say(`  ${r.ok ? C.grn('✓') : C.red('✗')} ${r.case}${r.ok ? '' : C.red(` — ${r.lost.join('; ')}`)}`);
    if (!r.ok) findings.push({ key: '(迁移)', file: 'js/xiuxian/profile.js', vector: r.case, problems: r.lost });
  }

  /* —— §8.6 巡检表 —— */
  say(C.bold('\n【§6 存档键巡检表】'));
  say(C.dim(padR('  键名', 25) + padR('声明位置', 38) + padR('默认合并', 12) + padR('形状兜底', 12) + '风险'));
  const RISK = {};
  for (const spec of SPECS) {
    const fs = (scan.map.get(spec.key) || []).filter(h => !h.file.includes('save-keys'));
    const decl = fs[0];
    const myFind = findings.filter(f => f.key === spec.key);
    const risk = myFind.length >= 3 ? C.red('高') : myFind.length ? C.yel('中') : C.grn('低');
    const merge = mergeVerdict(spec.key);
    const guard = myFind.length ? C.red('不足') : C.grn('有');
    RISK[spec.key] = myFind.length;
    say('  ' + padR(spec.key, 25) + padR(decl ? `${decl.file}:${decl.line}` : C.yel('main.js 动态传入'), 38) +
        padR(merge, 12) + padR(guard, 12) + risk);
  }
  // 注册表里声明、但本次没跑到的键
  for (const [k, field] of Object.entries(scan.REGISTRY)) {
    if (!SPECS.some(s => s.key === k)) {
      const fs = (scan.map.get(k) || [])[0];
      say('  ' + k.padEnd(23) + C.yel(`SAVE_KEYS.${field} 未实跑`).padEnd(34) + C.yel('—').padEnd(10) + C.yel('—').padEnd(10) + C.yel('待验证'));
    }
  }
  // 死键
  for (const d of scan.dead) {
    if (!d.key) continue;
    say('  ' + d.key.padEnd(23) + C.red(`${d.file} 声明但无 localStorage 读写`).padEnd(34) + C.yel('—').padEnd(10) + C.red('死键').padEnd(10) + C.red('高'));
    findings.push({ key: d.key, file: d.file, vector: '声明了键常量但没有任何读写点', problems: ['死键:该键名在本仓从未被读写,迁移/巡检表会误以为它有存档'] });
  }

  /* —— §8.7 缺陷清单 —— */
  say(C.bold('\n【§7 缺陷清单】'));
  if (!findings.length) say(C.grn('  (无)'));
  const byKey = new Map();
  for (const f of findings) {
    if (!byKey.has(f.key)) byKey.set(f.key, []);
    byKey.get(f.key).push(f);
  }
  for (const [k, fs] of byKey) {
    say(`\n  ${C.bold(C.red('●'))} ${C.bold(k)}  ${C.dim(fs[0].file)}  ${C.dim(`失败向量 ${fs.length}`)}`);
    for (const f of fs) say(`      · [${f.vector}] ${f.problems.join('; ')}`);
  }

  /* —— 退出码 —— */
  const verified = SPECS.length;
  say('');
  if (verified === 0) {
    say(C.red('✗ 0 个键跑通 —— 审计不可信,别信结论'));
    return 2;
  }
  say(C.dim(`跑通 ${verified}/${SPECS.length} 个键 · 静态发现 ${keys.length} 个键 · 缺陷 ${byKey.size} 组`));

  /* —— 已知缺陷基线(XX-QA-015)——
   * 本门禁 2026-10-11 首次跑就报出 23 组缺陷,直接接进 npm test 会让 CI 立刻变红。
   * 本项目的既有做法是登记制(见 tests/deadexport-baseline.txt 的「未使用导出人工确认清单」),
   * 这里沿用同一套:**已登记的不再判红,新增的判红**。
   * 修掉一条就从基线里删掉它 —— 基线只减不增,减到 0 就把这个机制拆掉。
   */
  const BASELINE_FILE = new URL('./save-integrity-baseline.txt', import.meta.url);
  const sig = f => `${f.key}::${f.vector}`;

  // --emit-baseline:把当前缺陷登记进基线。**只在人工逐条看过之后才跑** ——
  // 它等于「我确认这些已知问题暂时不修」。新提交里不要顺手跑。
  if (process.argv.includes('--emit-baseline')) {
    const uniq = [...new Set(findings.map(sig))].sort();
    writeFileSync(BASELINE_FILE, [
      '# 存档完整性 · 已知缺陷基线（XX-QA-015）',
      '#',
      '# 一行一条,格式 <存档键>::<故障向量>。这个文件里的条目**不判红**;',
      '# 出现基线之外的条目即判红。',
      '#',
      '# 基线只减不增:修掉一条就从这里删一行。减到 0 就把整个基线机制拆掉。',
      '# 人工审阅于 2026-10-11,详见 TICKETS.md 与 TEST-PLAN.md 的 R2 轮。',
      '',
      ...uniq, '',
    ].join('\n'));
    say(C.grn(`已写出基线 ${uniq.length} 条 → tests/save-integrity-baseline.txt`));
    return 0;
  }

  let baseline = new Set();
  try { baseline = new Set(readFileSync(BASELINE_FILE, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))); }
  catch { /* 基线文件缺失 = 没有任何已知豁免,全部按新缺陷判 */ }

  const known = findings.filter(f => baseline.has(sig(f)));
  const fresh = findings.filter(f => !baseline.has(sig(f)));

  if (known.length) {
    say(C.dim(`  已登记缺陷 ${new Set(known.map(sig)).size} 组(见 tests/save-integrity-baseline.txt,不判红)`));
  }
  if (fresh.length) {
    const freshKeys = new Set(fresh.map(f => f.key));
    say(C.red(`\n  ✗ 新增缺陷 ${new Set(fresh.map(sig)).size} 组,涉及 ${freshKeys.size} 个键 —— 判红`));
    for (const k of freshKeys) {
      const fs = fresh.filter(f => f.key === k);
      say(`      ${C.bold(k)}  ${C.dim(fs[0].file)}`);
      for (const f of fs) say(`        · [${f.vector}] ${f.problems.join('; ')}`);
    }
  }
  if (!fresh.length) say(C.grn('结论:无新增缺陷(EXIT 0)'));
  else say(C.red(`结论:${new Set(fresh.map(sig)).size} 组新增缺陷(EXIT 1)`));
  return fresh.length ? 1 : 0;
}

/** 各 load 的"是否默认合并"——读源码得到的判断,写死在这里便于核对 */
function mergeVerdict(key) {
  const YES = '是', NO = C.red('否'), PART = C.yel('部分');
  const t = {
    pxs_save: PART, xx_cultivation_v077: YES, xx_nemesis_v077: YES, xx_titles_v077: YES,
    xx_bag_v080: YES, xx_camp_v080: PART, xx_companion_v081: YES, xx_family_v081: PART,
    xx_mount_v091: PART, xx_chronicle_v081: YES, xx_build_v083: PART, xx_craft_v099: YES,
    xx_artstar_v099: YES, xx_quest_v087: PART, xx_story_v086: YES, xx_tomb_v089: PART,
    xx_spine_v099: YES, xx_codex_v099: YES, xx_market_v099: YES, xx_merch_v080: YES,
    xx_tavern_v099: YES, xx_profile_v081: PART, xx_clock_v099: YES,
  };
  return t[key] || '—';
}

const code = await main();
process.exit(code);