#!/usr/bin/env node
// tests/lint-silent-catch.mjs —— 「静默 catch」门禁(工单:跨设备同事最强烈建议 / owner 已采纳)
//
// ── 为什么要有这道门禁 ───────────────────────────────────────────────
// 本项目最贵的一类事故不是崩溃,是**「看起来一切正常」**。
// 这一轮里三个同型缺陷,每一个当初都是被一个 catch 吞掉的:
//
//   ① `Cult.settle` 缺 import      → catch(e){ console.warn(...) }  ← 有日志,照样没人看见
//   ② `Profile.collect(mods)`       → catch(e){ console.warn(...) }  ← mods 是别的模块的局部 const
//   ③ 战败 `data-c` 写错           → 完全静默,静默走默认分支
//
// ⚠️ ①② 决定了本门禁的判据**不能只是「有没有 log」**:
//   warn 打在你自己的控制台里,而故障在玩家那边表现为「角色站着不动」。
//   没人看着控制台 ⇒ 写了日志的 catch 和没写日志的 catch,在事故现场是同一个东西。
//   所以「有 console.*」被降级成**豁免之一**,而不是通行证 —— 豁免还得叠加下面另外两条。
//
// ── 判据 ────────────────────────────────────────────────────────────
//   报红 =  没有 console.*  且  没有标记注释  且  不是「空块 + 短 try」
//   豁免 =  ① 块内任何 console.*
//           ② catch 前一行 / 块内首行的注释含 已知 / 忽略 / 预期 / by design
//           ③ 空块(块内零语句)且 try 体 ≤ SHORT_TRY_MAX 行
//
// ⚠️ 判据只把「空块」当成可自动豁免,「只有 return / continue / break」不豁免:
//   `catch { return null; }` 把「没有数据」和「这里崩了」变成同一个返回值,
//   调用方分辨不出来 —— 那正是「功能没生效但一切看着正常」的形状。
//   同理,块内有语句的静默回落(`catch { this.s = defaultState(); }`)一律报红,
//   它就是 ③ 号缺陷(战败 data-c)的原型。
//
// ── 为什么必须有基线 ─────────────────────────────────────────────────
// `js/` 下现存 80 处无日志无注释的 catch(见每次运行打印的量化块)。
// 不建基线,这条 lint 上线当天就是红的 ⇒ 没人看 ⇒ 第二次就没人维护了。
// 基线照 `lint-deadexport` / `lint-dead-effect-key` 的模式:已登记的不报,只报新增。
//
// ── 基线为什么不用行号 ───────────────────────────────────────────────
// 行号会被**任何**无关改动冲掉 —— 在这个仓库里 0 行改动都是家常便饭,
// 一行基线失效一次,人就得整体重录,重录就会顺手把没看过的也一起放行。
// 基线 key = 文件路径 + 所在函数名 + try 体摘要 + catch 体摘要 + 同形序号,
// 行号只作为**给人看的注释**存在(lineAtCapture),不参与身份判定。
//
// ── 退出码 ──────────────────────────────────────────────────────────
//   0 = 通过(或仅剩已登记基线)
//   1 = 有**新增**静默 catch
//   2 = **门禁自身失效**(量没取到 / 解析对不上 / 自检不过)—— 别信这次的结论
//
// 用法:node tests/lint-silent-catch.mjs [--list] [--write-baseline --force]
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const JS_DIR = join(ROOT, 'js');
const BASELINE = join(ROOT, 'tests/silent-catch-baseline.json');

// ── 阈值:短 try 的行数上限 ───────────────────────────────────────────
// 依据是**实测分布**(js/ 下 80 处无日志 catch 的 try 体行数):
//   ≤1 行 53 处 · ≤2 行 54 处 · ≤3 行 56 处 · ≤4 行 66 处(单次 +10 的断层)· 之后每档只多 1~3 处
// 断层落在 3→4,所以 N=3:
//   · ≤3 行 = 「一次原子调用 + 取返回值」,失败是局部的,没有多步事务可以留下半截状态,
//     日志只会变成噪音(localStorage 不可用、音频上下文被拒都属于这一档);
//   · ≥4 行 = 开始出现**步骤序列**,静默 catch 会同时吞掉「哪一步失败」和「前几步的副作用」,
//     这才是 ③ 号缺陷(战败 data-c 静默走默认分支)能藏身的形状。
// 换句话说:这条豁免放过的是「失败无害」,拦住的正是「失败会留下半截状态」。
const SHORT_TRY_MAX = 3;

// 注释豁免的关键词(owner 定的四个,不多不少)
const MARKERS = /已知|忽略|预期|by\s*design/i;

// 取量的下限。**故意写死**,不跟扫描配置联动。
// 理由见 lint-deadexport 的 C1:断言跟着配置走,它只会验证配置自己的自洽,
// 永远抓不到「扫描器其实什么都没扫到」。现在实测 106 文件 / 102 个 catch,
// 下限压到 50 —— 只有解析器整体坏掉才会触发,不会在正常重构时误炸。
const SANITY = { files: 50, catches: 50 };

const C = { red: s => `\x1b[31m${s}\x1b[0m`, grn: s => `\x1b[32m${s}\x1b[0m`, yel: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` };

/** 门禁自身失效。结论不可信,所以退出码和「有新增」分开。 */
function die(msg, detail) {
  console.error(`\n${C.red('❌ 门禁自身失效(退出码 2)—— 这次的结论别信,连同下面的原因一起看:')}`);
  console.error(`   ${msg}`);
  if (detail) for (const d of detail) console.error(`   ${d}`);
  process.exit(2);
}

// ── 收集 js/ 源文件 ──────────────────────────────────────────────────
const files = [];
(function walk(d) {
  for (const f of readdirSync(d).sort()) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(JS_DIR);

if (files.length < SANITY.files) {
  die(`只扫到 ${files.length} 个 js 文件,低于下限 ${SANITY.files} —— 扫描范围出了问题。`,
    ['量没取够就不要给结论。确认 tests/lint-silent-catch.mjs 的 JS_DIR 指向仍存在。']);
}

/**
 * 把注释与字符串字面量挖成空格(长度与换行完全保留,偏移量一一对应)。
 * 不挖的话,文案里的 catch{}、正则里的 }、注释里的 `//` 都会污染括号配对。
 */
function mask(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c; out += ' '; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += ' '; i++;
    } else { out += c; i++; }
  }
  return out;
}

/** 从 m[from]==='{' 起做括号配对,返回配对 '}' 的下标;配不上返回 -1 */
function matchBrace(m, from) {
  let depth = 0;
  for (let i = from; i < m.length; i++) {
    if (m[i] === '{') depth++;
    else if (m[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * 从 catch 子句**精确**回溯它所属的 try 体。
 * 做法:往回跳过 catch 的参数括号 → 必须撞上 try 体的收尾 `}` → 反向括号配对找到 `{`
 *       → 再确认 `{` 前面紧挨着 `try` 关键字。
 * 比「往前找最近的 try{」准得多:后者在 `catch(e){ try{...}catch(e2){} }` 这种嵌套里会串台。
 * 串台的后果是 try 行数算错 ⇒ 短 try 豁免用错 ⇒ 静默漏报,所以这里不做近似。
 */
function findTryBody(m, catchIdx) {
  let i = catchIdx - 1;
  while (i >= 0 && /\s/.test(m[i])) i--;
  // ① 有绑定参数时先跨过 `)` … `)`(`catch (e)`)
  if (i >= 0 && m[i] === ')') {
    let depth = 0;
    while (i >= 0) { if (m[i] === ')') depth++; else if (m[i] === '(') { depth--; if (depth === 0) { i--; break; } } i--; }
    while (i >= 0 && /\s/.test(m[i])) i--;
  }
  // ② catch 子句前面必然是 try 体的收尾 `}` —— 往回配对到 try 体的 `{`
  if (i < 0 || m[i] !== '}') return null;
  let depth = 0, open = -1;
  while (i >= 0) {
    if (m[i] === '}') depth++;
    else if (m[i] === '{') { depth--; if (depth === 0) { open = i; break; } }
    i--;
  }
  if (open < 0) return null;
  // ③ `try` 关键字必须紧挨在这个 `{` 前面 —— 有这一条才敢说「这个 try 归它」
  let k = open - 1;
  while (k >= 0 && /\s/.test(m[k])) k--;
  if (k < 2 || m.slice(k - 2, k + 1) !== 'try') return null;
  const end = matchBrace(m, open);
  return end < 0 ? null : { start: open, end };
}

/**
 * 最近的**函数/方法**名,只用于给基线 key 提供稳定上下文。
 *
 * ⚠️ 踩过的坑:第一版直接取「往前最后一个 `xxx(...) {`」,结果把 `if (x) {` 也认成了函数名
 *   —— 基线里那一条的上下文被标成 `if`。更糟的是稳定性:只要有人在同一个 catch 前面
 *   补一个 `if (...) {`,上下文就变了,基线当场失效。
 *   所以这里从最近的候选**倒着找第一个真函数名**,控制流关键字一律跳过。
 */
const NOT_A_NAME = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'with', 'return',
  'typeof', 'function', 'new', 'in', 'of', 'case', 'delete', 'void', 'yield',
  'await', 'constructor', 'default',
]);
function enclosingName(m, upto) {
  const head = m.slice(0, upto);
  const cand = [];
  const pats = [
    /(?:^|[\s;{}]?)function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /(?:^|[\s;{}])([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g,       // 方法简写 / 普通函数
    /(?:^|[\s;{}])([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  ];
  for (const re of pats) {
    let m2;
    while ((m2 = re.exec(head)) !== null) cand.push({ i: m2.index, name: m2[1] });
  }
  cand.sort((a, b) => b.i - a.i);
  for (const c of cand) if (!NOT_A_NAME.has(c.name)) return c.name;
  return '<module>';
}

const norm = s => s.replace(/\s+/g, ' ').trim();
const sha8 = s => createHash('sha1').update(norm(s)).digest('hex').slice(0, 8);

/**
 * 抽出一个文件里的全部 catch 子句。
 * 返回的每个元素都带齐了判定所需的一切,judge() 是纯函数 —— 自检可以脱离磁盘喂它。
 */
function extract(rel, src) {
  const m = mask(src);
  const lines = src.split('\n');
  const out = [];
  const spans = [];
  const CATCH_RE = /\bcatch\s*(?:\((?:[^()]|\([^()]*\))*\))?\s*\{/g;
  let mm;
  while ((mm = CATCH_RE.exec(m)) !== null) {
    spans.push([mm.index, CATCH_RE.lastIndex]);
    const braceAt = m.indexOf('{', mm.index);
    const end = matchBrace(m, braceAt);
    if (end < 0) out.push({ rel, unclosed: mm.index });      // 交给上层报「门禁失效」
    else out.push({
      rel,
      kindOf: 'clause',
      line: src.slice(0, mm.index).split('\n').length,
      ctx: enclosingName(m, mm.index),
      bodyMasked: m.slice(braceAt + 1, end),
      bodyRaw: src.slice(braceAt + 1, end),
      hasConsole: /\bconsole\s*\./.test(m.slice(braceAt + 1, end)),
      // 标记注释:catch 前一行,或块内首行
      markerComment: (() => {
        const ln = src.slice(0, mm.index).split('\n').length;
        const above = (lines[ln - 2] || '').trim();
        const inside = lines[ln] || '';
        if (above.startsWith('//') && MARKERS.test(above)) return norm(above);
        if (/^\s*(\/\/|\/\*|\*)/.test(inside) && MARKERS.test(inside)) return norm(inside);
        return null;
      })(),
      tryBody: (() => { const t = findTryBody(m, mm.index); return t ? m.slice(t.start + 1, t.end) : null; })(),
    });
  }
  // 第二个、**独立**的计数口径:masked 文本里每个 `catch` 词都必须能落到一个 catch 子句上,
  // 否则它八成是 promise 的 `.catch(...)` —— 本 lint 不管那类,得让人看见它没管。
  const notClause = [...m.matchAll(/\bcatch\b/g)].filter(x => !spans.some(([a, b]) => x.index >= a && x.index < b));
  return { items: out, notClause: notClause.length };
}

/** try 体行数(物理行)。try 体找不到时返回 null —— 上层据此判「门禁失效」。 */
function tryLinesOf(item) {
  if (item.tryBody == null) return null;
  const nl = s => s.split('\n').length;
  return nl(item.tryBody);
}

/**
 * 判定函数(纯函数,自检与实跑共用同一份 —— 不复制第二套判定逻辑,
 * 复制的那一套必然和真正的漂移,漂移了就等于自检在验自己)。
 */
function judge(item) {
  if (item.hasConsole) return { exempt: true, why: ['块内有 console.*'] };
  if (item.markerComment) return { exempt: true, why: [`标记注释: ${item.markerComment.slice(0, 60)}`] };
  const isEmpty = item.bodyMasked.trim() === '';
  const flowOnly = !isEmpty && /^\s*(?:return\b[^;]*;?|continue\s*;?|break\s*;?)\s*$/.test(item.bodyMasked);
  const tl = tryLinesOf(item);
  if (isEmpty && tl !== null && tl <= SHORT_TRY_MAX) return { exempt: true, why: [`空块 + 短 try(${tl} 行 ≤ ${SHORT_TRY_MAX})`], tryLines: tl };
  const shape = isEmpty ? '空 catch' : flowOnly ? '只有 return/continue/break' : '静默回落(有语句无日志)';
  return { exempt: false, shape, tryLines: tl };
}

/** 基线 key:路径 :: 上下文 :: try 体摘要 :: catch 体摘要 :: 同形序号(全都不含行号) */
function keyOf(item, tl) {
  const base = `${item.rel}::${item.ctx}::${sha8(item.tryBody ?? '')}::${sha8(item.bodyRaw)}`;
  return { base, dup: 0 };
}

/** 唯一化:同文件里形状完全相同的 catch 靠出现次序区分 */
function withOrdinals(items) {
  const seen = new Map();
  return items.map(it => {
    const n = (seen.get(it.base) ?? -1) + 1;
    seen.set(it.base, n);
    return { ...it, baseKey: it.base, key: n === 0 ? it.base : `${it.base}#${n}` };
  });
}

// ── 基线读取 / 校验 ──────────────────────────────────────────────────
function loadBaseline() {
  if (!existsSync(BASELINE)) return { entries: new Map(), missing: true, shortTryMax: null };
  let raw;
  try { raw = JSON.parse(readFileSync(BASELINE, 'utf8')); }
  catch (e) { die(`${BASELINE} 不是合法 JSON,读不出来。`, [`解析错误: ${e.message}`]); }
  if (!raw || typeof raw.entries !== 'object' || raw.entries === null) {
    die(`${BASELINE} 缺少 entries 对象 —— 基线读不出来就等于「什么都不豁免」,那会让整条 lint 变成噪声。`);
  }
  const entries = new Map();
  for (const [k, v] of Object.entries(raw.entries)) {
    if (!v || typeof v.file !== 'string') die(`基线条目 ${k} 缺少 file 字段。`);
    entries.set(k, v);
  }
  if (raw.shortTryMax !== undefined && raw.shortTryMax !== SHORT_TRY_MAX) {
    die(`基线记录的 shortTryMax=${raw.shortTryMax},代码里是 ${SHORT_TRY_MAX}。`,
      ['阈值变了 ⇒ 基线 key 全变 ⇒ 会一次性冒出几百条「新增」。这是有意的:逼你显式重录,而不是默默接受。',
        '确认要改阈值:`node tests/lint-silent-catch.mjs --write-baseline --force`']);
  }
  return { entries, missing: false, shortTryMax: raw.shortTryMax };
}

/**
 * 基线过滤(真实数据与自检**共用**这一个函数)。
 * @param hits 已判红项(带 key)
 * @param entries 基线 Map
 */
function partition(hits, entries) {
  return {
    known: hits.filter(h => entries.has(h.key)),
    fresh: hits.filter(h => !entries.has(h.key)),
  };
}

// ── 门禁自检:合成样本,零磁盘写入、零 js/ 读取 ────────────────────────
// §3「自检不能与被测状态耦合」:这里喂进去的全是**写死在这个文件里的字符串**,
// 不读 js/、不读真实基线,所以无论仓库现在是什么状态,自检结果都恒定。
const SELFCHECK = [
  { name: '空 catch + 1 行 try → 短 try 豁免', src: `try { localStorage.setItem(k,v); } catch {}`, exempt: true },
  { name: '空 catch + 4 行 try → 报红', src: `try {\n a();\n b();\n c();\n d();\n} catch {}`, exempt: false },
  { name: '空 catch + 有 console → 豁免', src: `try { a(); b(); c(); d(); } catch (e) { console.warn(e); }`, exempt: true },
  { name: 'return null + 1 行 try → 仍报红(返回值被伪装)', src: `try { a(); } catch (e) { return null; }`, exempt: false },
  { name: '标记注释在 catch 前一行 → 豁免', src: `try { a(); b(); c(); d(); } // 预期:老存档没这个字段\ncatch (e) {}`, exempt: true },
  { name: '静默回落 → 报红(战败 data-c 的原型)', src: `try { a(); b(); c(); d(); } catch (e) { this.s = def(); }`, exempt: false },
  { name: '带 console.warn 的 catch → 豁免但要在量化里记一笔', src: `try { a(); } catch (e) { console.warn('x'); }`, exempt: true },
  { name: '块内注释不含关键词 + 4 行 try → 报红', src: `try {\n a();\n b();\n c();\n d();\n} catch (e) { /* 精灵缺失时留空 */ }`, exempt: false },
  { name: '块内只有注释 + 1 行 try → 算空块,按短 try 豁免(注释不执行,失败仍被吞)', src: `try { a(); } catch { /* 已知:精灵缺失 */ }`, exempt: true },
  { name: '块内只有注释 + 4 行 try → 报红(注释不是日志,不是通行证)', src: `try {\n a();\n b();\n c();\n d();\n} catch { /* 留空 */ }`, exempt: false },
];

function runSelfcheck() {
  const fails = [];
  for (const c of SELFCHECK) {
    const { items } = extract('__selfcheck__.js', c.src);
    if (items.length !== 1) { fails.push(`${c.name}:期望抽出 1 个 catch,实际 ${items.length}`); continue; }
    const it = items[0];
    if (it.unclosed !== undefined) { fails.push(`${c.name}:catch 块没配到 '}'`); continue; }
    if (tryLinesOf(it) === null) { fails.push(`${c.name}:回溯不到所属 try 体`); continue; }
    const v = judge(it);
    if (v.exempt !== c.exempt) fails.push(`${c.name}:期望 exempt=${c.exempt},实际 ${v.exempt}(${v.why ?? v.shape})`);
  }
  // 基线过滤也自检一遍 —— 「判据对」不等于「基线机制有效」,
  // 而基线机制的假绿恰恰是这类 lint 最常见的失效方式。
  const probeA = 'js/x.js::fn::aaaaaaaa::bbbbbbbb';
  const probeB = 'js/x.js::fn::cccccccc::dddddddd';
  const e = new Map([[probeA, { file: 'js/x.js', reason: '自检探针' }]]);
  const p = partition([{ key: probeA }, { key: probeB }], e);
  if (p.known.length !== 1 || p.known[0].key !== probeA) fails.push('基线过滤:已登记项没被认出来');
  if (p.fresh.length !== 1 || p.fresh[0].key !== probeB) fails.push('基线过滤:未登记项被基线吞掉了(这正是假绿)');

  return fails;
}

// ── 主流程 ──────────────────────────────────────────────────────────
console.log(`\n${C.dim('══ 静默 catch 门禁 ══')}`);

const selfFails = runSelfcheck();
if (selfFails.length) {
  die('内置自检没过 —— 判定函数或基线过滤在撒谎,下面这份扫描结果不作数。', selfFails);
}

const items = [];
let notClause = 0;
const unclosed = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
  const r = extract(rel, src);
  notClause += r.notClause;
  for (const it of r.items) (it.unclosed !== undefined ? unclosed : items).push(it);
}

if (unclosed.length) die(`${unclosed.length} 处 catch 的 '{' 配不到 '}' —— 括号解析不可信。`,
  unclosed.slice(0, 5).map(u => `${u.rel} 偏移 ${u.unclosed}`));

if (items.length < SANITY.catches) {
  die(`只抽出 ${items.length} 个 catch 子句,低于下限 ${SANITY.catches} —— 提取器整体坏了。`,
    ['量没取够就不给结论。这条 lint 一旦「扫不到东西」就会变成一片绿的假象。']);
}

// 量化块:每次运行都打印,谁都能自己核对口径有没有漂
const stat = { total: items.length, noConsole: items.filter(i => !i.hasConsole).length, empty: 0, flow: 0, fallback: 0, console: 0, comment: 0, shortTry: 0 };
const judged = items.map(it => {
  const v = judge(it);
  if (v.exempt) {
    if (v.why[0].startsWith('块内')) stat.console++;
    else if (v.why[0].startsWith('标记注释')) stat.comment++;
    else stat.shortTry++;
    return { ...it, v, red: false };
  }
  if (v.shape === '空 catch') stat.empty++;
  else if (v.shape.startsWith('只有')) stat.flow++;
  else stat.fallback++;
  const k = keyOf(it, v.tryLines);
  return { ...it, ...k, tryLines: v.tryLines, v, red: true };
});
const red = withOrdinals(judged.filter(j => j.red));

const noTry = red.filter(r => r.tryLines === null);
if (noTry.length) {
  die(`${noTry.length} 处报红项回溯不到所属 try 体 —— try 行数判据失效,报红结果不作数。`,
    noTry.slice(0, 5).map(r => `${r.rel}:${r.line}`));
}

const exemptTotal = stat.console + stat.comment + stat.shortTry;
console.log(`  扫描 ${C.grn(files.length + ' 个文件')} · catch 子句 ${C.yel(stat.total)} 处`);
console.log(`    带 console.* ${C.grn(stat.console)} 处 · 完全无 console ${C.yel(stat.noConsole)} 处 ${C.dim('(同事口径的「静默」= 这一列)')}`);
console.log(`  豁免 ${C.grn(exemptTotal)} 处 = console ${stat.console} + 标记注释 ${stat.comment} + 空块&短try(≤${SHORT_TRY_MAX}行) ${stat.shortTry}`);
console.log(`  需判定 ${C.yel(red.length)} 处 = 空块&长try ${stat.empty} + 吞返回值 ${stat.flow} + 静默回落 ${stat.fallback}`);

const { entries, missing } = loadBaseline();
const wantWrite = process.argv.includes('--write-baseline');
// ⚠️ 顺序:写基线的分支必须在「基线缺失就退出」之前 ——
//   否则第一次生成基线时会被自己的守卫挡住,永远生成不出来。
if (missing && !wantWrite) {
  console.error(`\n${C.red('❌ 找不到基线文件')} ${BASELINE}`);
  console.error('   没有基线 = 这条 lint 第一次跑必然全红 = 没人看 = 白写。');
  console.error(`   生成:node tests/lint-silent-catch.mjs --write-baseline --force`);
  process.exit(2);
}

const { known, fresh } = partition(red, entries);
const liveKeys = new Set(red.map(r => r.key));
const stale = [...entries.keys()].filter(k => !liveKeys.has(k));

if (process.argv.includes('--list')) {
  console.log(`\n${C.dim('── 全部需判定项 ──')}`);
  for (const r of red) console.log(`  ${entries.has(r.key) ? C.dim('[基线]') : C.red('[新增]')} ${r.rel}:${r.line}  ${C.dim(`${r.ctx} · try ${r.tryLines} 行 · ${r.v.shape}`)}`);
}

if (wantWrite) {
  if (entries.size && !process.argv.includes('--force')) {
    console.error(`\n❌ 基线已有 ${entries.size} 条人工条目,本次未写入。加 --force 才会覆盖。`);
    console.error('   理由(`reason` 字段)是人工写的,重新生成会冲掉 —— 所以按 key 合并保留。');
    process.exit(2);
  }
  const out = {};
  for (const r of red) {
    out[r.key] = {
      file: r.rel, ctx: r.ctx, lineAtCapture: r.line, tryLines: r.tryLines, shape: r.v.shape,
      body: norm(r.bodyRaw).slice(0, 80),
      reason: entries.get(r.key)?.reason ?? 'TODO: 人工判读 —— 这处 catch 到底该不该被吞',
    };
  }
  writeFileSync(BASELINE, JSON.stringify({
    note: '静默 catch 基线。key = 路径::上下文::try体摘要::catch体摘要[#序号],不含行号。',
    rule: '只减不增:已登记的不报红,新增的报红。清理一批就该 --write-baseline --force 摘掉一批。',
    shortTryMax: SHORT_TRY_MAX,
    entries: out,
  }, null, 2) + '\n');
  console.log(`\n✅ 基线已写:${BASELINE}(${red.length} 条,其中 ${entries.size} 条沿用原 reason)`);
  process.exit(0);
}

console.log(`  基线 ${C.grn(entries.size + ' 条')} · 已登记 ${known.length} · ${fresh.length ? C.red('新增 ' + fresh.length) : C.grn('新增 0')}`);
if (stale.length) {
  console.log(`  ${C.yel('⚠️')} 基线里已不再是需判定项 ${stale.length} 条(那段代码已被修掉/改了形状) —— 可以用 --write-baseline --force 摘掉`);
  for (const k of stale.slice(0, 8)) console.log(`     ${C.dim(k)}`);
}
// notClause 数的是 **`catch` 这个词**出现了几次却没落成 catch 子句。
// 现状这 5 次里只有 4 处是真正的 promise 拒绝处理器,剩下 1 处是 `if (p && p.catch)`
// 这种判断属性存不存在(js/core/audio.js:104) —— 所以这个数字不等于「4 个静默 promise」。
// 写清楚是为了别让人拿它当「有 5 个漏网之鱼」去数。
if (notClause) console.log(`  ${C.dim(`ℹ️  另有 ${notClause} 次 \`catch\` 词没落成 catch 子句(promise 的 .catch(...) 等)—— 不在本 lint 口径内,未审`)}`);

console.log(`\n${C.dim(`── 判定函数自检 ${SELFCHECK.length} 例 + 基线过滤 2 例:全过 ──`)}`);

if (fresh.length) {
  console.log(`\n${C.red(`❌ ${fresh.length} 处新增静默 catch`)}`);
  for (const r of fresh) {
    console.log(`  ${C.red('❌')} ${r.rel}:${r.line}  ${C.dim(`${r.ctx} · try ${r.tryLines} 行 · ${r.v.shape}`)}`);
    if (norm(r.bodyRaw)) console.log(`      ${C.dim(norm(r.bodyRaw).slice(0, 90))}`);
  }
  console.log(C.dim('  修法:① 块里加 console.warn(失败会怎样)  ② 确认无害就写标记注释(`已知`/`忽略`/`预期`/`by design`)'));
  console.log(C.dim('  ③ 确实是「失败无害的单次调用」→ 把 try 体收进 3 行以内,本 lint 自动放行'));
  console.log(C.dim('  ⚠️ 注意 ①:`console.warn` 只是豁免之一,不是通行证 —— 它排在控制台里,玩家看不到。'));
  process.exit(1);
}
console.log(`\n${C.grn('✅ 无新增静默 catch')}${known.length ? C.dim(`(基线 ${known.length} 条待清理)`) : ''}`);
process.exit(0);
