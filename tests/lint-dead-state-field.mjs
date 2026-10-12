#!/usr/bin/env node
// 死状态字段检测 —— 「写进去但再也不读」
//
// 【为什么要有这条】
//   真实事故 XX-AUDIT-006:profile.js 的 migrate() 把 pxs_save 读进 d.base,
//   此后**从未被消费**,却经由 { ...d } 原样写回 ⇒ 玩家金币 8888 回滚成 30、局数 12 回滚成 1。
//   同事的原话:「这类 bug 不会自己暴露,只会在玩家发现『我金币少了』时暴露。」
//   根因不是某一行的笔误,是**一个字段进了存档却没有任何一条代码读它**——
//   静态上完全看不出来,注释写一百遍也挡不住下一个人手滑。
//
// 【判据是怎么定出来的 —— 先普查,后定线】
//   这条门禁的判据**不是拍脑袋定的**,是先把 js/ 下所有持久化状态普查一遍之后才定的。
//   普查结论(细节见文件末尾 census 段与交付报告):
//     · 按**名字**在全仓搜读写 → 完全不可用。'ready'/'x'/'y'/'at'/'slot' 在 particles/weapons/
//       tests 里满天飞,但没有一处读的是 placed[] 的元素;只看名字会把活字段全判成死的,
//       反过来也永远抓不到 placed[].ready 这种真死字段。**必须解析接收者。**
//     · 接收者一解析,结论就分成了两堆:
//         能稳定判的 → 持久化数组**元素**的字段(元素绑定可静态枚举,且 escape 可检测)
//         判不准的   → 根对象经由解构/展开/传参/动态下标读走的字段(读点不可枚举)
//       后者一律降级成**人工清单**,绝不编成断言。
//   宁可这条 lint 窄而准,也不要宽而假绿。
//
// 【刻意不做的事】
//   · 不修现存死字段(那要动 js/,不属于本工单)
//   · 不对「判不准」的候选报红 —— 假红的代价是让人学会忽略门禁
//   · 基线**不用行号**定位(行号会被任何一次无关改动冲掉),用 文件+容器+字段名 三元组
//
// 用法:
//   node tests/lint-dead-state-field.mjs              门禁(退出码 0/1/2)
//   node tests/lint-dead-state-field.mjs --list       附:人工确认清单(含「判不准」的候选)
//   node tests/lint-dead-state-field.mjs --write-baseline [--force]
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const BASELINE = join(ROOT, 'tests/dead-state-field-baseline.json');
const SCAN_ROOTS = ['js', 'tests', 'tools'];

/**
 * 【已知动态读取器 —— 人工维护的常量,不是自动推出来的】
 *   这些文件把**整个状态对象**收进函数参数,再用变量下标读字段
 *   (`for (const [f, spec] of Object.entries(CONTRACT)) state[f]`)。
 *   静态看不见「哪个名字被读」,所以它们读到的字段一律降级成「判不准」。
 *   ⚠️ 加了新的动态读取器,必须把文件加进来 —— 反过来,这里列的文件如果不再动态读了,
 *      自检会报门禁自身失效(见 SELF_CHECK 段),提醒你把它删掉。
 */
const DYNAMIC_READERS = ['tests/save-integrity-audit.mjs'];

// ═══════════════════════ 词法:去注释/字符串,但保留模板串里的 ${} ═══════════════════════
// 为什么不能简单地把模板串整段抹掉:
//   js/xiuxian/ui/build.js:40 的 `${fld && fld.ready ? … : …}` 是**真实的读**。
//   整段抹掉 ⇒ 这个读点看不见 ⇒ 真活字段被判成只写不读 ⇒ 假红。
//   所以模板串只抹字面量部分,${} 里的表达式原样保留(递归处理)。

function isRegexStart(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  if ('(,=:[!&|?{};+-*%~^<>'.includes(c)) return true;
  // return /re/ 、typeof /re/ 、case /re/ …
  let k = j;
  while (k >= 0 && /[A-Za-z_$]/.test(src[k])) k--;
  const word = src.slice(k + 1, j + 1);
  return ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'delete', 'void'].includes(word);
}

function stripTemplate(src, out, i) {
  out[i++] = ' ';                                   // 抹掉反引号本身
  while (i < src.length) {
    if (src[i] === '\\') { out[i] = ' '; if (src[i + 1] !== '\n') out[i + 1] = ' '; i += 2; continue; }
    if (src[i] === '`') { out[i] = ' '; return i + 1; }
    if (src[i] === '$' && src[i + 1] === '{') {
      out[i] = '$'; out[i + 1] = '{';                // 保留 ${ 骨架
      i += 2;
      const start = i;
      let depth = 1;
      while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
        else if (src[i] === '`') { i = stripTemplate(src, out, i); continue; }
        else if (src[i] === '"' || src[i] === "'") {
          const q = src[i]; out[i++] = ' ';
          while (i < src.length) {
            if (src[i] === '\\') { out[i] = ' '; i += 2; continue; }
            if (src[i] === q) { out[i] = ' '; i++; break; }
            if (src[i] === '\n') { i++; break; }
            out[i++] = ' ';
          }
          continue;
        }
        i++;
      }
      const expr = src.slice(start, i);
      const sub = stripSource(expr);
      for (let k = 0; k < expr.length; k++) if (expr[k] !== '\n') out[start + k] = sub[k];
      if (i < src.length && src[i] === '}') { out[i] = ' '; i++; }
      continue;
    }
    if (src[i] !== '\n') out[i] = ' ';
    i++;
  }
  return i;
}

function stripSource(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') out[i++] = ' '; continue; }
    if (c === '/' && d === '*') {
      out[i++] = ' '; out[i++] = ' ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i++] = ' '; out[i++] = ' '; }
      continue;
    }
    if (c === '/' && isRegexStart(src, i)) {
      let j = i + 1, inClass = false, ok = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { j++; ok = true; break; }
        j++;
      }
      if (ok) { for (let k = i; k < j; k++) if (src[k] !== '\n') out[k] = ' '; i = j; continue; }
    }
    if (c === '`') { i = stripTemplate(src, out, i); continue; }
    if (c === '"' || c === "'") {
      const q = c; out[i++] = ' ';
      while (i < n) {
        if (src[i] === '\\') { out[i] = ' '; if (src[i + 1] !== '\n') out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === q) { out[i] = ' '; i++; break; }
        if (src[i] === '\n') { i++; break; }
        out[i++] = ' ';
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

// ═══════════════════════ 括号配对 / 字面量顶层键 ═══════════════════════

function matchPair(t, open, o, c) {
  let d = 0;
  for (let i = open; i < t.length; i++) {
    if (t[i] === o) d++;
    else if (t[i] === c) { d--; if (d === 0) return i; }
  }
  return -1;
}
const lineOf = (t, idx) => t.slice(0, idx).split('\n').length;

function topLevelKeys(body) {
  const keys = [];
  let d = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') { d++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { d--; continue; }
    if (d !== 0) continue;
    const m = /^([A-Za-z_$][\w$]*)\s*(?::|,|$)/.exec(body.slice(i));
    // ⚠️ 键前面允许有换行/缩进。只认「紧邻 { 或 ,」会把**每个字面量的第一个键**
    //    悄悄丢掉(`{ stars: {} }` 里 stars 的前缀只有一个空格就整条漏了),
    //    而少收字段看起来只是「漏报」,不会有人发现 —— 实测踩过。
    if (m && /(?:^|[{,])\s*$/.test(body.slice(0, i))) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

/** 写入型尾随运算符 */
const WRITE_TAIL = /^\s*(=>|=[^=]|\+=|-=|\*=|\/=|\?\?=|\|\|=|&=|\|=|%=|<<=|>>>=|>>=|\*\*=)/;
const isWriteTail = (tail) => !/^\s*=>/.test(tail) && WRITE_TAIL.test(tail);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ═══════════════════════ 分析核心(纯函数 —— 自检复用同一份代码) ═══════════════════════

function loadCorpus(root) {
  const walk = (dir, out = []) => {
    const p = join(root, dir);
    if (!existsSync(p)) return out;
    for (const e of readdirSync(p)) {
      if (e === 'node_modules' || e === '__pycache__' || e === '_shots' || e.startsWith('.')) continue;
      const rel = `${dir}/${e}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
      else if (/\.(mjs|js|html)$/.test(e)) out.push(rel);
    }
    return out;
  };
  // ⚠️ 不能用 flatMap(walk):flatMap 会把 (值, 下标, 数组) 一起传给回调,
  //    walk 的第二个形参 out 会被塞进「下标」⇒ out.push 不是函数。
  const files = SCAN_ROOTS.map(r => walk(r)).flat();
  const corpus = new Map();
  for (const f of files) corpus.set(f, stripSource(readFileSync(join(root, f), 'utf8')));
  return { files, corpus };
}

function analyze(corpus) {
  const findings = [];
  const stats = { roots: 0, rootFields: 0, elementFields: 0, dynamicReaders: 0 };

  // ---- 动态读取器:把整个状态收进参数再按变量下标读 ----
  const dynamicReaders = [];
  for (const dr of DYNAMIC_READERS) {
    const t = corpus.get(dr);
    // 门禁自身失效检测:常量里列的文件必须真的还在做动态下标读,否则这份清单已经过期,
    // 过期 ⇒ 我们对动态读的抑制是多余的(会漏判),而不是保守 ⇒ 必须报 exit 2。
    if (t && !/\[\s*[A-Za-z_$][\w$]*\s*\]/.test(t)) {
      throw new Error(`DYNAMIC_READERS 里的 ${dr} 已经不做动态下标读了 —— 这份清单已过期,请删掉它,否则本门禁会漏判。`);
    }
    if (t) dynamicReaders.push(dr);
  }
  stats.dynamicReaders = dynamicReaders.length;
  const dynText = dynamicReaders.map(d => corpus.get(d)).filter(Boolean).join('\n');

  // ---- 1. 发现持久化状态根(锚点:localStorage.setItem(…, JSON.stringify(EXPR))) ----
  const roots = [];
  for (const [file, t] of corpus) {
    if (!file.startsWith('js/')) continue;
    const setItem = /localStorage\.setItem\s*\(/g;
    let sm;
    while ((sm = setItem.exec(t)) !== null) {
      const listOpen = t.indexOf('(', sm.index);
      const listClose = matchPair(t, listOpen, '(', ')');
      if (listClose < 0) continue;
      const args = t.slice(listOpen + 1, listClose);
      const js = args.indexOf('JSON.stringify');
      if (js < 0) continue;
      const so = t.indexOf('(', listOpen + 1 + js);
      if (so < 0 || so > listClose) continue;
      const sc = matchPair(t, so, '(', ')');
      if (sc < 0) continue;
      const expr = t.slice(so + 1, sc).trim();
      let prop = null;
      const thisM = /^this\s*\.\s*(s|data)\b/.exec(expr);
      if (thisM) prop = thisM[1];
      else if (/^[A-Za-z_$][\w$]*$/.test(expr)) prop = null;          // 模块级 const 状态,下面单独收
      if (prop) roots.push({ file, prop, expr, at: so });
    }
    // 模块级 const 状态(codex.js 的 `const state = { seen:{} }`)
    for (const m of t.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/gm)) {
      if (new RegExp(`JSON\\.stringify\\s*\\(\\s*${esc(m[1])}\\s*\\)`).test(t)) {
        roots.push({ file, prop: null, ident: m[1], expr: m[1], at: m.index });
      }
    }
    // 兜底根:**本文件在写 localStorage,且通过 `this.<prop>` 维护状态,但序列化时写的是
    //   展开表达式而不是 `this.<prop>` 本身** —— profile.js 就是这样:
    //   `localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }))`,
    //   状态本体是 `this.data`,`d` 只是它的局部别名。
    //   没有这条兜底,profile.js 整个不在扫描范围内,XX-AUDIT-006 的主角
    //   `d.base`(只读进来、从未消费、却随 { ...d } 进了存档)就完全看不见 ——
    //   而这正是这条门禁存在的理由。实测踩过。
    if (/localStorage\s*\.\s*setItem\s*\(/.test(t)) {
      for (const m of t.matchAll(/\bthis\s*\.\s*(s|data)\b/g)) {
        roots.push({ file, prop: m[1], expr: `this.${m[1]}`, at: m.index, viaFallback: true });
      }
    }
  }

  // 去重(同一文件同一属性)
  const rootByKey = new Map();
  for (const r of roots) {
    const k = `${r.file}|${r.prop ?? r.ident}`;
    if (!rootByKey.has(k)) rootByKey.set(k, r);
  }
  stats.roots = rootByKey.size;

  // ---- 2. 每个根:访问器 + 别名 + 字段 ----
  for (const root of rootByKey.values()) {
    const t = corpus.get(root.file);
    const hostM = [...t.slice(0, root.at).matchAll(/(?:export\s+)const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)].pop();
    const host = hostM ? hostM[1] : null;
    const accessors = new Set();
    if (root.prop) {
      accessors.add(`this.${root.prop}`);
      if (host) accessors.add(`${host}.${root.prop}`);
    } else accessors.add(root.ident);

    // 别名(不动点):const v = this.s / this.data = v / const v = {...别名,...}
    // ⚠️ 三条约束都是踩过坑加的,少一条就会污染:
    //   ① `(?![\w$.\[])` —— 没有它,`const last = this.s.lit` 会把 last 当成整个状态的别名
    //      (\b 在 `.` 前也成立),字段表里混进 m/last/wasBurning,元素分析拿着单字母别名
    //      全仓匹配,凭空造出 `CAMP.s.log[]` 这种不存在的容器。
    //   ② `^\s+const` —— 别名必须是**函数局部**的。模块级 const(DEFAULT_SEED 这种)
    //      一旦被当成别名,「它被当作实参传出」这条抑制理由会给**整个根**的所有字段降级,
    //      XX-AUDIT-006 的主角 Profile.data.base 就这样被挡在清单外。
    //   ③ 排除 null/true/false/undefined —— 它们不是绑定。
    const RESERVED = new Set(['null', 'true', 'false', 'undefined', 'this', 'arguments']);
    const aliases = new Set();
    const okAlias = (name) => name && !RESERVED.has(name);
    for (let round = 0; round < 4; round++) {
      const accRe = [...accessors, ...aliases].map(esc).join('|');
      const before = aliases.size;
      for (const m of t.matchAll(new RegExp(`^\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${accRe})(?![\\w$.\\[])`, 'gm'))) if (okAlias(m[1])) aliases.add(m[1]);
      for (const m of t.matchAll(new RegExp(`^\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${accRe})\\s*;`, 'gm'))) if (okAlias(m[1])) aliases.add(m[1]);
      const accRe2 = [...aliases].map(esc).join('|');
      if (accRe2) for (const m of t.matchAll(new RegExp(`^\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\{[^{}]*\\.\\.\\.\\s*(?:${accRe2})(?![\\w$.\\[])`, 'gm'))) if (okAlias(m[1])) aliases.add(m[1]);
      if (aliases.size === before) break;
    }
    const allAcc = [...accessors, ...aliases];
    // ⚠️⚠️ **局部别名只在本文件内有效**。`d` 在 profile.js 是「整个 Profile 状态」,
    //    在 weapons.js:343 它是 `WEAPONS[id]` —— 同一个字母,两个东西。
    //    第一版拿别名去全仓匹配/全仓查抑制,于是:
    //      · 读侧把 weapons.js 的 `d.base.cd[0]` 当成 Profile 的 base 被读过(假阴性)
    //      · 抑制侧在 39 个文件里撞上 `, d)`,把整个根降级成「判不准」(假绿)
    //    跨文件只能靠宿主限定名 `Profile.data`。这与元素规则里 `this.s.log` 的教训同源。
    const localAcc = [...accessors, ...aliases];
    const globalAcc = host ? [`${host}.${root.prop ?? root.ident}`] : [];
    const accFor = (gf) => (gf === root.file ? localAcc : globalAcc);
    const container = host ? `${host}.${root.prop ?? root.ident}` : (root.prop ? `this.${root.prop}` : root.ident);

    // ---- 2a. 字段来源:状态字面量 ----
    const fieldSrc = new Map();     // field -> 声明位置
    const addFields = (keys, at) => { for (const k of keys) if (!fieldSrc.has(k)) fieldSrc.set(k, at); };

    const litRe = root.prop
      ? new RegExp(`\\b${root.prop}\\s*:\\s*\\{`, 'g')
      : new RegExp(`(?:export\\s+)?const\\s+${esc(root.ident)}\\s*=\\s*\\{`, 'g');
    for (const m of t.matchAll(litRe)) {
      const o = t.indexOf('{', m.index);
      const c = matchPair(t, o, '{', '}');
      if (c < 0) continue;
      addFields(topLevelKeys(t.slice(o + 1, c)), lineOf(t, o));
    }
    // `s: defaultState()` / `s: someFactory()` —— 解析工厂函数的 return 字面量
    // ⚠️ **只认一个定义**,而且优先本文件的。四个模块都叫 defaultState()
    //    (camp/companion/spine/index 各自的),第一版在所有文件里各收一遍,
    //    于是 CAMP 的字段表里混进了 companion 的 run/ghost/log/mut 和
    //    spine 的 quests/arcsDone/tombstone —— 凭空多出一堆不存在的字段。
    for (const m of t.matchAll(new RegExp(`\\b${root.prop ?? esc(root.ident)}\\s*:\\s*([A-Za-z_$][\\w$]*)\\s*\\(\\s*\\)`, 'g'))) {
      const fn = m[1];
      const defRe = new RegExp(`(?:export\\s+)?function\\s+${esc(fn)}\\s*\\([^)]*\\)\\s*\\{`);
      const imported = new RegExp(`import[\\s\\S]{0,400}?\\b${esc(fn)}\\b[\\s\\S]{0,120}?from\\s*['"]`);
      for (const [g, gt] of corpus) {
        if (g !== root.file && !imported.test(t)) continue;
        const fm = defRe.exec(gt);
        if (!fm) continue;
        const ret = /return\s*\{/.exec(gt.slice(fm.index, fm.index + 8000));
        if (!ret) continue;
        const ro = fm.index + ret.index + ret[0].length - 1;
        const rc = matchPair(gt, ro, '{', '}');
        if (rc < 0) continue;
        addFields(topLevelKeys(gt.slice(ro + 1, rc)), lineOf(gt, ro));
        break;                                   // 只取第一个定义
      }
    }
    // `this.s = { ...DEFAULTS, ...JSON.parse(r) }` 与 `const d = { ...EMPTY, savedAt }`(profile.js)
    for (const m of t.matchAll(new RegExp(`(?:${allAcc.map(esc).join('|')}|const\\s+[A-Za-z_$][\\w$]*)\\s*=\\s*\\{([^{}]*?\\.\\.\\.[^{}]*?)\\}`, 'g'))) {
      const body = m[1];
      const keys = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(x => x[1]);
      const spread = /\.\.\.\s*([A-Za-z_$][\w$]*)/.exec(body);
      const keys2 = spread ? [...body.matchAll(/(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*:/g)].map(x => x[1]) : [];
      addFields(keys.length ? keys : keys2, lineOf(t, m.index));
    }

    // ---- 2b. 字段来源:赋值 this.s.F = ----
    for (const m of t.matchAll(new RegExp(`(?:${allAcc.map(esc).join('|')})\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*(?:=[^=]|\\+=|-=|\\*=|\\?=|\\|\\|=|&=)`, 'g'))) {
      addFields([m[1]], lineOf(t, m.index));
    }
    stats.rootFields += fieldSrc.size;

    // ---- 2c. 根字段的读写判定 ----
    const accRe = new RegExp(`(?:${allAcc.map(esc).join('|')})\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    for (const [field] of fieldSrc) {
      const writes = [], reads = [], reasons = [];
      const accPat = (gf) => {
        const a = accFor(gf);
        return a.length ? `(?:${a.map(esc).join('|')})` : null;
      };
      for (const [gf, gt] of corpus) {
        const P = accPat(gf);
        if (!P) continue;
        const re = new RegExp(`${P}\\s*\\??\\.\\s*${esc(field)}\\b`, 'g');
        let m;
        while ((m = re.exec(gt)) !== null) {
          const at = m.index + m[0].length;
          (isWriteTail(gt.slice(at, at + 14)) ? writes : reads).push(`${gf}:${lineOf(gt, m.index)}`);
        }
        // ['field']
        const dre = new RegExp(`${P}\\s*\\[\\s*['"\`]${esc(field)}['"\`]\\s*\\]`, 'g');
        while ((m = dre.exec(gt)) !== null) {
          const at = m.index + m[0].length;
          (isWriteTail(gt.slice(at, at + 14)) ? writes : reads).push(`${gf}:${lineOf(gt, m.index)}`);
        }
        // 解构读 const { field, … } = <acc>
        for (const dm of gt.matchAll(new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${P}\\b`, 'g'))) {
          if (new RegExp(`\\b${esc(field)}\\b`).test(dm[1])) reads.push(`${gf}:${lineOf(gt, dm.index)}(解构)`);
        }
      }
      // 抑制器:读点不可枚举 ⇒ 降级「判不准」
      // ⚠️ 序列化不是「把状态交出去消费」:JSON.stringify(this.s) 必须排除。
      //    lookbehind 里**不能**带那个左括号 —— 它断言的是「`(` 之前」的位置,
      //    带括号等于断言「`(` 之前已经有一个 `(`」,永远成立,等于没写。
      //    第一版就是这么写的,结果每个根的每个字段都被判「不可枚举」⇒
      //    一条都报不出来,而且报告看上去是绿的(假绿)。这是本文件踩过的两个坑之一。
      const NOT_SERIALIZE = '(?<!JSON\\.stringify)';
      for (const [gf, gt] of corpus) {
        const accs = accFor(gf);
        for (const a of accs) {
          const ae = esc(a);
          if (new RegExp(`${ae}\\s*\\[\\s*[^'"\`\\]]`).test(gt)) reasons.push(`${gf}: 对 ${a} 做了动态下标访问,读点不可枚举`);
          if (new RegExp(`\\.\\.\\.\\s*${ae}\\b`).test(gt)) {
            // 同理:JSON.stringify({ ...d, savedAt }) 里的展开是**写进存档**,不是消费。
            // 不排除它,profile.js 的每个字段都会因为「d 被展开」而降级,XX-AUDIT-006 的
            // 主角 d.base 又被挡在清单外 —— 而 `{ ...d }` 恰恰是它进存档的那条路。
            const intoStorage = new RegExp(`JSON\\.stringify\\s*\\(\\s*\\{[^{}]*?\\.\\.\\.\\s*${ae}\\b`);
            if (!intoStorage.test(gt)) reasons.push(`${gf}: ${a} 被展开进别处,读点不可枚举`);
          }
          if (new RegExp(`${NOT_SERIALIZE}[(,]\\s*${ae}\\s*[,)]`).test(gt)) reasons.push(`${gf}: ${a} 被当作实参传出,读点不可枚举`);
        }
      }
      if (dynText && new RegExp(`\\b${esc(field)}\\b`).test(dynText)) reasons.push(`${dynamicReaders.join(',')}: 动态读取器会按名字读它`);
      if (!writes.length) continue;
      if (!reads.length && reasons.length === 0) {
        findings.push({ kind: 'root', file: root.file, container, field, writes, reads, certain: true });
      } else if (!reads.length) {
        findings.push({ kind: 'root', file: root.file, container, field, writes, reads, certain: false, reasons });
      }
    }

    // ---- 3. 持久化数组的元素字段 ----
    // 【为什么要全仓扫,而不是只看声明文件】
    //   元素字段的读点可以发生在**任何**引用了这个数组的文件里
    //   (ui/build.js:31 `const inst = BUILD.s.placed[i]`、ui/livebar.js:84 `const p = placed[i]`、
    //    tests/t83.js 的 `B.BUILD.s.placed[0].workers`)。
    //   只看声明文件 ⇒ 把「UI 里读得好好的字段」判成死的 ⇒ 假红。
    for (const arrField of fieldSrc.keys()) {
      // ⚠️⚠️ 跨文件寻址**只能**用宿主限定名(`CHRONICLE.s.log`)。
      //   `this.s.log` 是**文件局部**的:companion / spine / chronicle 三家各有一个
      //   自己的 `this.s.log`。一旦拿 `this.s.log` 去全仓匹配,CHRONICLE.s.log[] 的
      //   元素集合就会把 companion 的 markRun({deaths,picks,present}) 和
      //   spine 的 sync({from,to,at}) 一并吞进去 —— 实测红出 20+ 条假条目。
      //   所以:`this.<prop>.<arr>` **只在本声明文件内**有效,别处一律不认。
      //   (本文件已栽了四回同类坑:别名 / topLevelKeys / 正则字面量 / this 跨文件。)
      if (!host) continue;
      const qualified = `${esc(host)}\\.${root.prop}\\.${arrField}`;
      const exprFor = (gf) => (gf === root.file
        ? `${qualified}|this\\.${root.prop}\\.${arrField}`
        : qualified);
      // 该数组在哪些文件里出现过 —— 只有这些文件才可能持有元素绑定
      const touched = [];
      for (const [gf, gt] of corpus) {
        if (new RegExp(`(?:${exprFor(gf)})\\b`).test(gt)) touched.push(gf);
      }
      if (!touched.length) continue;

      // 元素绑定(逐文件):<arr>[i] → const 出来的名字;局部数组别名;回调形参;for…of
      const bindingsByFile = new Map();
      const addBinding = (gf, name) => {
        if (!bindingsByFile.has(gf)) bindingsByFile.set(gf, new Set());
        bindingsByFile.get(gf).add(name);
      };
      for (const gf of touched) {
        const gt = corpus.get(gf);
        const A = exprFor(gf);
        for (const bm of gt.matchAll(new RegExp(`(?:${A})\\s*\\[`, 'g'))) {
          const pre = gt.slice(Math.max(0, bm.index - 120), bm.index);
          const cst = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,110}$/.exec(pre);
          if (cst) addBinding(gf, cst[1]);
        }
        for (const lm of gt.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${A})\\b`, 'g'))) {
          const lname = lm[1];                                  // const placed = BUILD.s.placed
          for (const lm2 of gt.matchAll(new RegExp(`\\b${esc(lname)}\\s*\\[`, 'g'))) {
            const pre = gt.slice(Math.max(0, lm2.index - 120), lm2.index);
            const cst = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,110}$/.exec(pre);
            if (cst) addBinding(gf, cst[1]);
          }
        }
        // 回调形参。接收者允许**方法链**:ui/bag.js:409 是
        //   `STORY.s.log.slice(0,7).map(e => …esc(e.text)…)`
        //   写死成 `A.map(` 的话 `e` 绑不上,`e.text` 这个读点就看不见,
        //   STORY.s.log[].text 会被误报成「只写不读」—— 实测红过这一条假条目。
        const CHAIN = `(?:${A})\\s*(?:\\.\\s*[A-Za-z_$][\\w$]*\\s*(?:\\([^()]{0,80}\\)\\s*)?)*\\.\\s*(?:forEach|map|filter|some|find|findIndex)\\s*\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)`;
        for (const cm of gt.matchAll(new RegExp(CHAIN, 'g'))) addBinding(gf, cm[1]);
        for (const cm of gt.matchAll(new RegExp(`for\\s*\\(\\s*(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s+of\\s+(?:${A})\\b`, 'g'))) addBinding(gf, cm[1]);
      }
      const allBindings = [...bindingsByFile.values()].reduce((a, s) => new Set([...a, ...s]), new Set());
      if (!allBindings.size) continue;

      // 元素构造字面量:进入该数组的对象字面量
      const elemFields = new Map();
      for (const gf of touched) {
        const gt = corpus.get(gf);
        const A = exprFor(gf);
        for (const pr of [
          new RegExp(`(?:${A})\\s*\\.\\s*(?:push|unshift)\\s*\\(\\s*\\{`, 'g'),
          new RegExp(`(?:${A})\\s*\\.\\s*splice\\s*\\([^,]+,\\s*[^,]+,\\s*\\{`, 'g'),
        ]) {
          let pm;
          while ((pm = pr.exec(gt)) !== null) {
            const o = gt.indexOf('{', pm.index + pm[0].length - 1);
            const c = matchPair(gt, o, '{', '}');
            if (c < 0) continue;
            for (const k of topLevelKeys(gt.slice(o + 1, c))) if (!elemFields.has(k)) elemFields.set(k, `${gf}:${lineOf(gt, o)}`);
          }
        }
        // `const inst = {…}; this.s.placed.splice(idx, 0, inst)` —— 元素字面量经由局部变量进数组
        // ⚠️ 必须收紧到「**同一次调用**」。第一版写成「字面量后面 400 字符内出现过
        //    <数组> 和这个变量名就算」,于是 chronicle/companion/story/tavern 里
        //    任意一个对象字面量,只要它后面的语句碰巧调了 SPINE.s.log.push(e),
        //    就被当成 SPINE.s.log 的元素 —— 凭空造出 SPINE.s.log[].ev / [].present
        //    这些不存在的字段,并且全部判成「只写不读」。实测踩过,红了 20 多条假条目。
        //    现在要求:① 中间最多一个 `;`;② 变量名必须是 push/unshift 的唯一实参,
        //    或 splice 第 3+ 个实参。
        // ⚠️ 这里是**正则字面量**,不是模板字符串 —— 写 `\\w` 是错的
        //    (那等于「反斜杠 + 字面 w」),字符类会匹配不到任何标识符,
        //    于是元素字段一个都收不到,placed[] 整条规则静默失效。
        //    静默失效比报错更坏:自检也一起看不见了。
        for (const dm of gt.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
          const name = dm[1], o = gt.indexOf('{', dm.index);
          const c = matchPair(gt, o, '{', '}');
          if (c < 0) continue;
          const tail = gt.slice(c + 1, c + 201);
          // ① 字面量闭合之后**第一处**对目标数组的引用
          const rel = tail.search(new RegExp(`(?:${A})\\s*\\.`));
          if (rel < 0) continue;
          // ② 中间隔着的语句不超过一条
          if ((tail.slice(0, rel).match(/;/g) || []).length > 1) continue;
          // ③ 变量名必须是那一次调用的实参(push/unshift 唯一实参,或 splice 第 3+ 个实参)
          const call = tail.slice(rel, rel + 200);
          const isArg =
            new RegExp(`\\.\\s*(?:push|unshift)\\s*\\([^;)]{0,80}?\\b${esc(name)}\\b\\s*[,)]`).test(call) ||
            new RegExp(`\\.\\s*splice\\s*\\([^;)]{0,80}?\\b${esc(name)}\\b\\s*[,)]`).test(call);
          if (!isArg) continue;
          for (const k of topLevelKeys(gt.slice(o + 1, c))) if (!elemFields.has(k)) elemFields.set(k, `${gf}:${lineOf(gt, o)}`);
        }
      }
      if (!elemFields.size) continue;
      stats.elementFields += elemFields.size;

      // 逃逸检测:元素绑定一旦传参/被重新赋值/被 return/被存进别的对象 ⇒ 分析不完 ⇒ 降级「判不准」
      // ⚠️ 只在**发现该绑定的文件里**查跨文件逃逸。
      //    第一版在全仓按裸名查 `p.x`,结果 js/game/particles.js 里的粒子 `p` 把
      //    build.js 的 placed 元素 `p` 判成「逃逸」⇒ 一条都报不出来(又一次假绿)。
      //    裸名在别的文件里可能根本不是同一个东西 —— 只有引用了这个数组的文件才可能是。
      const escapes = [];
      for (const [gf, names] of bindingsByFile) {
        const gt = corpus.get(gf);
        // 插入调用(push/splice/unshift)不是「逃逸」,那正是元素怎么进数组的
        const insertion = new RegExp(`(?:${exprFor(gf)})\\s*\\.\\s*(?:push|unshift|splice)\\s*\\([^;]{0,200}`, 'g');
        const gtNoIns = gt.replace(insertion, (s) => ' '.repeat(s.length));
        for (const b of names) {
          const be = esc(b);
          const decls = (gt.match(new RegExp(`(?:const|let|var)\\s+${be}\\s*=`, 'g')) || []).length;
          if (decls > 1) escapes.push(`${gf}: ${b} 在同一文件里被多次声明,绑定不唯一`);
          if (new RegExp(`[(,]\\s*${be}\\s*[,)]`).test(gtNoIns)) escapes.push(`${gf}: ${b} 被当作实参传出`);
          if (new RegExp(`\\breturn\\s+${be}\\b`).test(gtNoIns)) escapes.push(`${gf}: ${b} 被 return`);
          if (new RegExp(`(?:^|[^.\\w$])${be}\\s*=(?!=|>)[^=]`, 'm').test(gtNoIns.replace(new RegExp(`(?:const|let|var)\\s+${be}\\s*=`), ''))) escapes.push(`${gf}: ${b} 被重新赋值`);
          if (new RegExp(`\\.\\s*[A-Za-z_$][\\w$]*\\s*=\\s*${be}\\b`).test(gtNoIns)) escapes.push(`${gf}: ${b} 被存进别的对象`);
        }
      }

      const bindRe2 = [...allBindings].map(esc).join('|');
      const elemContainer = `${container}.${arrField}[]`;
      for (const [ef, declAt] of elemFields) {
        const writes = [`${declAt}(构造)`], reads = [];
        for (const [gf, gt] of corpus) {
          const A = exprFor(gf);
          if (!A) continue;
          const names = bindingsByFile.get(gf);
          const viaBinding = names ? [...names].map(esc).join('|') : null;
          const viaDirect = `(?:${A})\\s*\\[\\s*[^\\]]*\\]\\s*\\??\\.\\s*${esc(ef)}\\b`;
          const src = viaBinding
            ? `(?:\\b(?:${viaBinding})\\s*\\??\\.\\s*${esc(ef)}\\b|${viaDirect})`
            : viaDirect;
          const re = new RegExp(src, 'g');
          let m;
          while ((m = re.exec(gt)) !== null) {
            const end = m.index + m[0].length;
            (isWriteTail(gt.slice(end, end + 14)) ? writes : reads).push(`${gf}:${lineOf(gt, m.index)}`);
          }
        }
        if (reads.length) continue;
        findings.push(escapes.length
          ? { kind: 'element', file: root.file, container: elemContainer, field: ef, writes, reads, certain: false, reasons: escapes }
          : { kind: 'element', file: root.file, container: elemContainer, field: ef, writes, reads, certain: true });
      }
    }
  }
  return { findings, stats };
}

// ═══════════════════════ 自检:合成样本,不碰真实文件 ═══════════════════════

function selfCheck() {
  // 合成语料放在内存里 —— **与真实仓库状态零耦合**。
  // 为什么要反向自检(AUTONOMY §3.2):断言跟着被测对象走,它就只会验证自己的自洽。
  // 「把判定方向写反」必须能被抓出来,否则一个恒真的门禁和一个正确的门禁长得一模一样。
  const fx = new Map();
  fx.set('js/fx/state.js', [
    "import { Bag } from './bag.js';",
    "export const BOX = {",
    "  s: { gold: 0, ghost: 0, seed: 7, items: [] },",
    "  load() { try { const r = localStorage.getItem(K); if (r) this.s = { gold:0, ghost:0, seed:7, items:[], ...JSON.parse(r) }; } catch {} },",
    "  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },",
    "  spend(n) { this.s.gold -= n; this.s.ghost = 0; this.save(); },",
    "  place() { const inst = { bid:'x', rot: 0, used: 1 }; this.s.items.push(inst); this.save(); },",
    "  pin() { return this.s.seed; },",
    "}",
  ].join('\n'));
  fx.set('js/fx/ui.js', [
    "import { BOX } from './state.js';",
    "export const view = () => {",
    "  let h = '';",
    "  for (const p of BOX.s.items) h += p.used;",
    "  return h + BOX.s.gold;",
    "};",
  ].join('\n'));
  const corpus = new Map();
  for (const [k, v] of fx) corpus.set(k, stripSource(v));
  const r = analyze(corpus);

  const got = r.findings.filter(f => f.certain).map(f => `${f.kind}|${f.container}|${f.field}`).sort();
  // 合成样本里确实没人读 bid / rot / ghost —— 这三条是**真阳性**。
  // (第一版这里只写了 rot,少写了 bid,自检立刻炸了 —— 说明自检确实在盯着,
  //  而不是跟着实现走。这正是它该有的样子。)
  const want = ['element|BOX.s.items[]|bid', 'element|BOX.s.items[]|rot', 'root|BOX.s|ghost'].sort();

  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`自检失败:合成样本上应当只报出 ${JSON.stringify(want)},实际报出 ${JSON.stringify(got)}`);
  }
  // 反向自检(AUTONOMY §3.2):构造**同一份合成样本的另一个变体** ——
  // 只删掉 ui.js 里读 gold 的那一行,其它一个字不动。
  //   若 `gold` 是靠「真的去读它」才被排除的,变体的候选必须**恰好多出 gold**。
  //   若候选数不变,说明这套判定根本没在看读点 ⇒ 门禁是恒真的摆设,
  //   和一个正确的门禁在输出上长得一模一样。
  // 同一个变体里把 `p.used` 也删掉,顺带把元素规则也拖下水验一遍。
  // ⚠️ 第一版写成「把 .gold 全仓替换成 .__REDACTED__」,错在:
  //    gold 在 state.js 和 ui.js 里都被写/读,而替换只做在 state.js 上,
  //    ui.js 的读点还在 ⇒ 候选数当然不变 ⇒ 自检自己先炸了。
  //    差分必须是「只动一个变量」的,不能顺手改一堆。
  const blinded = new Map(corpus);
  blinded.set('js/fx/ui.js', stripSource([
    "import { BOX } from './state.js';",
    "export const view = () => {",
    "  let h = '';",
    "  for (const p of BOX.s.items) h += '';",
    "  return h;",
    "};",
  ].join('\n')));
  const r2 = analyze(blinded);
  const got2 = r2.findings.filter(f => f.certain).map(f => `${f.kind}|${f.container}|${f.field}`).sort();
  const want2 = [...want, 'element|BOX.s.items[]|used', 'root|BOX.s|gold'].sort();
  if (JSON.stringify(got2) !== JSON.stringify(want2)) {
    throw new Error(`反向自检失败:删掉唯一的 gold / used 读点后,候选应当恰好变成 ${JSON.stringify(want2)},实际是 ${JSON.stringify(got2)}。判定没有依赖读点,或依赖错了地方。`);
  }
  return true;
}

// ═══════════════════════ 基线 ═══════════════════════

const keyOf = (f) => `${f.kind}|${f.file}|${f.container}|${f.field}`;

function loadBaseline() {
  if (!existsSync(BASELINE)) return { entries: {} };
  let raw;
  try { raw = JSON.parse(readFileSync(BASELINE, 'utf8')); }
  catch (e) { throw new Error(`基线文件不是合法 JSON:${BASELINE}(${e.message})`); }
  if (!raw || typeof raw.entries !== 'object' || raw.entries === null) {
    throw new Error(`基线文件缺 entries 字段:${BASELINE}`);
  }
  return raw;
}

// ═══════════════════════ 主流程 ═══════════════════════

function main() {
  // ---- 门禁自身的健康检查:拿不到该拿的量 ⇒ exit 2,绝不放行 ----
  let selfOk = false, baseline = null;
  try {
    selfCheck();
    selfOk = true;
    baseline = loadBaseline();
  } catch (e) {
    console.error(`❌ 门禁自身失效:${e.message}`);
    console.error('   这不是代码有问题,是这条门禁自己坏了。先修门禁,再谈报红。');
    process.exit(2);
  }

  const { files, corpus } = loadCorpus(ROOT);
  const { findings, stats } = analyze(corpus);

  // 固定期望(不跟着配置走):js/ 下必须真的扫到源文件,否则「扫到 0 个状态根」的绿色毫无意义。
  const jsFiles = files.filter(f => f.startsWith('js/')).length;
  if (jsFiles === 0) {
    console.error('❌ 门禁自身失效:js/ 一个源文件都没扫到。');
    process.exit(2);
  }
  if (stats.roots === 0) {
    console.error('❌ 门禁自身失效:一个持久化状态根都没识别出来(锚点 localStorage.setItem(…, JSON.stringify(…)) 全灭)。');
    console.error('   少扫一个根不会让报告变红,只会让它悄悄漏报 —— 这条自检就是防这个的。');
    process.exit(2);
  }
  if (stats.rootFields === 0) {
    console.error('❌ 门禁自身失效:识别到状态根但一个字段都没解析出来。');
    process.exit(2);
  }

  const certain = findings.filter(f => f.certain);
  const uncertain = findings.filter(f => !f.certain);
  const known = new Set(Object.keys(baseline.entries));
  const fresh = certain.filter(f => !known.has(keyOf(f)));
  const accepted = certain.filter(f => known.has(keyOf(f)));
  const stale = [...known].filter(k => !certain.some(f => keyOf(f) === k));

  console.log(`\n死状态字段扫描: ${files.length} 个源文件 · ${stats.roots} 个持久化状态根 · ${stats.rootFields} 个根字段 · ${stats.elementFields} 个数组元素字段`);
  console.log(`  只写不读(判得准,可断言): ${certain.length}`);
  console.log(`  其中已在基线内、人工确认过: ${accepted.length}`);
  console.log(`  新增:                          ${fresh.length}`);
  console.log(`  判不准(进人工清单,不断言):    ${uncertain.length}`);
  console.log(`  动态读取器:                    ${stats.dynamicReaders} 个(${DYNAMIC_READERS.join(', ') || '无'})`);

  if (fresh.length) {
    console.log('\n新增「写进去再也不读」的状态字段:');
    for (const f of fresh) {
      console.log(`  ❌ ${f.container}.${f.field}   [${f.kind}]  声明 ${f.file}`);
      for (const w of f.writes) console.log(`       写于 ${w}`);
      console.log(`       读:零 —— 这个字段进了存档,全仓没有任何一条代码读它。`);
      console.log(`       要么删掉,要么给它接上消费者;基线豁免请写进 ${BASELINE} 并写清理由。`);
    }
  }

  if (process.argv.includes('--list')) {
    console.log('\n全部「只写不读」候选:');
    for (const f of [...certain, ...uncertain]) {
      const mark = known.has(keyOf(f)) ? '[基线内]' : (f.certain ? '[新增]  ' : '[判不准]');
      console.log(`  ${mark} ${f.container}.${f.field}   [${f.kind}] ${f.file}`);
      for (const w of f.writes) console.log(`          写于 ${w}`);
      if (!f.certain) for (const rs of f.reasons) console.log(`          ⚠ ${rs}`);
    }
    console.log(`\n基线里已不再是候选(${stale.length} 条 —— 它们已经被读上了,可以考虑从基线摘掉):`);
    if (!stale.length) console.log('  (无)');
    else for (const k of stale) console.log(`  · ${k}`);
  }

  if (process.argv.includes('--write-baseline')) {
    if (Object.keys(baseline.entries).length && !process.argv.includes('--force')) {
      console.error(`\n❌ ${BASELINE} 已有 ${Object.keys(baseline.entries).length} 条人工确认条目,本次未写入。`);
      console.error('   重新生成会冲掉全部理由注释 —— 那正是这份文件存在的意义。确认要覆盖请加 --force。');
      process.exit(2);
    }
    const entries = {};
    for (const f of certain) {
      entries[keyOf(f)] = { kind: f.kind, file: f.file, container: f.container, field: f.field, reason: '(待补:为什么可以留着/为什么删)' };
    }
    writeFileSync(BASELINE, JSON.stringify({
      _note: '死状态字段 · 人工确认清单。key = kind|file|container|field(**刻意不用行号**:行号会被任何无关改动冲掉)。reason 必须写人话。',
      entries,
    }, null, 2) + '\n');
    console.log(`\n✅ 基线已写:${BASELINE}(${certain.length} 条)`);
  }

  if (fresh.length) {
    console.log(`\n❌ 新增只写不读的状态字段 ${fresh.length} 项`);
    process.exit(1);
  }
  console.log('\n✅ 无新增只写不读的状态字段');
  process.exit(0);
}

main();
