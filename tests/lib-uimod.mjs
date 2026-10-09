// 修仙阁 UI 层源码读取器 —— XX-AUDIT-005 拆分 ui.js 的配套
//
// 为什么需要这个文件:
//   ui.js 拆分之前,有一批测试是 `readFileSync('js/xiuxian/ui.js')` 拿**一整块文本**
//   再 `regex.test(...)` 的。拆成多个文件后,那段实现搬到别的文件去了,
//   断言会**静默假通过** —— 不是报错,是"代码不在那儿了"被当成"没调"。
//
//   踩过一次的具体形态(工单 XX-AUDIT-005 原文记录):
//     const vTombBody = ui.slice(ui.indexOf('  vTomb() {'));   // indexOf → -1
//     ok('没把 openTomb 塞进 vTomb()', !vTombBody.slice(0,900).includes(...));
//   vTomb 搬走后 indexOf 返回 -1,slice(-1) 取到**最后一个字符**,
//   slice(0,900).includes(...) 恒为 false → 取反恒为 true → 这条断言永远绿。
//   而且它绿得特别像"我验证过了"。
//
// 本模块提供三件事:
//   1) uiFiles()  —— UI 层文件清单(ui.js + js/xiuxian/ui/*.js),拆几个文件都不用改测试
//   2) blob()     —— 全部拼成一块,供"这个字符串在整个 UI 层出现过没有"用
//   3) methodBody() —— **按花括号配对**取某个方法的完整实现体,跨文件找
//
// 关于 methodBody 的实现:朴素的花括号计数会被字符串/模板串/注释/正则里的
// 花括号骗到(比如 `'}'` 或 `// }` 或 `/\{/`)。这里做了一遍轻量扫描把它们跳过。
// 反向注入验证过:故意把注释里写成 `{`,提取结果不受影响。

import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

export const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const XIU = ROOT + '/js/xiuxian';
const UIDIR = XIU + '/ui';

/** UI 层所有源文件的相对路径。目录不存在时只有 ui.js,与拆分前一致。 */
export function uiFiles() {
  const out = ['js/xiuxian/ui.js'];
  if (existsSync(UIDIR)) {
    for (const f of readdirSync(UIDIR).filter(x => x.endsWith('.js')).sort()) {
      out.push('js/xiuxian/ui/' + f);
    }
  }
  return out;
}

/** 单个文件的源码 */
export const readOne = f => readFileSync(ROOT + '/' + f, 'utf8');

/**
 * UI 层全文拼接。
 * 每块之间用不会出现在源码里的分隔符,防止跨文件拼出"假相邻":
 * A 文件末尾的 `}` 和 B 文件开头的 `}` 被当成同一个方法体。
 */
export function blob() {
  return uiFiles()
    .map(f => readOne(f))
    .join('\n/*__UIMOD_SPLIT__*/\n');
}

// ————————————————————————————————————————————
// 轻量扫描:找出「字符串 / 注释 / 正则」之外的真实代码字符
// ————————————————————————————————————————————

/**
 * @param {string} src
 * @returns {{code:string}} mask —— 与 src 等长,非代码位置填空格
 *
 * ⚠️ 踩过两次,都在这里:
 *   第一次:模板串里有**嵌套模板串**(UI 层遍地都是,形如
 *     `${items.map(x => `<div>${esc(x.name)}</div>`).join('')}`)
 *     单层扫描一遇到内层反引号就认为模板结束,后面整段全部错位 ——
 *     ui.js 里有 7 处这种模板,最长的一个被吞掉 3039 字符,
 *     导致 build()/act() 等方法的花括号配平直接失败。
 *   第二次:从方法签名处再往前找 `(` 找错了位置(截出方法体里的一段)。
 * 所以这里改成**栈式扫描**:模板串进栈,`${` 压表达式帧,嵌套模板自然递归。
 */
export function codeMask(src) {
  const out = new Array(src.length).fill(' ');
  const blank = (k, len = 1) => {
    for (let z = 0; z < len; z++) if (src[k + z] !== '\n') out[k + z] = ' ';
  };
  // 上一个**有意义的**代码字符,用来判断 `/` 是除号还是正则开头
  let prev = '';
  // 帧栈:{t:'tmpl'} = 模板串体内;{t:'expr',d:n} = 模板串的 ${ } 表达式内
  const st = [];
  let i = 0;
  const n = src.length;
  const top = () => st[st.length - 1];

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    // —— 模板串体内 ——
    if (top() && top().t === 'tmpl') {
      if (c === '\\') { blank(i, 2); i += 2; continue; }
      if (c === '`') { blank(i); st.pop(); i++; continue; }
      if (c === '$' && d === '{') { blank(i, 2); st.push({ t: 'expr', d: 0 }); i += 2; continue; }
      blank(i); i++; continue;      // 普通模板文本
    }

    // 行注释
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    // 块注释
    if (c === '/' && d === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    // 普通字符串
    if (c === '"' || c === "'") {
      blank(i); i++;
      while (i < n) {
        if (src[i] === '\\') { blank(i, 2); i += 2; continue; }
        if (src[i] === c) { blank(i); i++; break; }
        blank(i); i++;
      }
      continue;
    }
    // 模板串开头(栈式处理,支持嵌套)
    if (c === '`') { blank(i); st.push({ t: 'tmpl' }); i++; continue; }
    // 正则字面量:上一个代码字符是这些之一时,`/` 才是正则开头
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev))) {
      let j = i + 1, cls = false, ok = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) { ok = true; break; }
        else if (src[j] === '\n') break;   // 没闭合就不是正则
        j++;
      }
      if (ok) {
        blank(i, j - i + 1);
        i = j + 1;
        while (i < n && /[a-z]/.test(src[i])) i++;   // gimsuy 标志位
        prev = ' ';                                  // 正则后面不是标识符
        continue;
      }
    }
    // 表达式帧里的 `}`:可能是对象字面量的,也可能是在关 `${`
    if (c === '}' && top() && top().t === 'expr') {
      if (top().d > 0) { top().d--; out[i] = c; prev = c; i++; continue; }
      blank(i); st.pop(); i++; continue;             // 关掉 ${},回到模板体内
    }
    if (c === '{' && top() && top().t === 'expr') top().d++;

    out[i] = c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { code: out.join('') };
}

// 方法体提取缓存:codeMask 很贵(每个字符扫一遍)
const _maskCache = new Map();

/**
 * 取某个方法的完整实现文本(含方法签名行到配对的 `}`)。
 * 找不到时抛错 —— 绝不返回一段"看起来有内容"的垃圾。
 *
 * @param {string} name 方法名,如 'vQuest'
 * @param {string} [src] 在给定文本里找,默认整个 UI 层
 * @returns {{src:string, exported:boolean}[]}
 */
function _collect(name, src = blob()) {
  if (!_maskCache.has(src)) _maskCache.set(src, codeMask(src).code);
  const mask = _maskCache.get(src);
  // 前缀可选:`  vQuest() {`(对象方法 / 原 ui.js)和
  // `export function vQuest(hall) {`(拆分后的实现)都要能命中。
  // ⚠️ 踩过:前缀写成 `^[ \t]*name\s*\(` 时,`export function vQuest(` 完全匹配不上
  // —— 于是一份都找不到,只剩 ui.js 里的壳,断言照样绿。
  // 用 (?=\s*\() 前瞻,让 m[0] 停在 `(` **之前**,下面的配对逻辑不用改。
  const re = new RegExp(
    '^[ \\t]*((?:export\\s+)?(?:async\\s+)?function\\s+)?' + name + '\\b(?=\\s*\\()', 'gm');
  const out = [];
  let m;
  while ((m = re.exec(mask)) !== null) {
    // 必须是方法定义,不是调用:`foo(` 前不能有 . 或标识符字符
    const lineStart = m.index;
    const before = mask.slice(Math.max(0, lineStart - 2), lineStart);
    if (/[.\w$]/.test(before[before.length - 1] || '')) continue;
    // 这一份是"导出的顶层实现"还是"对象里的壳"?
    // ⚠️ 踩过:拆分后同一个名字有两份 —— ui/tomb.js 里 export function vTomb(hall){真实现}
    // 和 ui.js 里 vTomb(){ return vTombImpl(this); }。只认第一份会拿到壳,
    // 于是"实现里不该有 SPINE.openTomb"会因为**实现被搬走**而变绿。
    const exported = !!m[1] && /export/.test(m[1]);

    // 正则已匹配到 `(` 之后(m[0] 以 '(' 结尾),从**这个左括号**开始配对。
    // ⚠️ 踩过一次:这里原本又往前扫了一遍去找 `(`,于是扫进了方法体里
    // (下一处 `(` 是函数体里的调用),拿到的是一段完全不相干的文本 ——
    // 而且它非空,长度检查照样通过。看起来在正常工作,其实一直在截错位置。
    let i = m.index + m[0].length;
    let depth = 0;
    for (; i < mask.length; i++) {
      if (mask[i] === '(') depth++;
      else if (mask[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    if (i >= mask.length) continue;
    // 参数表之后到函数体 `{` 之间只允许空白(留个口子给返回类型标注)
    while (i < mask.length && /\s/.test(mask[i])) i++;
    if (mask[i] !== '{') continue;
    if (i >= mask.length) continue;

    // 花括号配对
    let d = 0, end = -1;
    for (let j = i; j < mask.length; j++) {
      if (mask[j] === '{') d++;
      else if (mask[j] === '}') { d--; if (d === 0) { end = j + 1; break; } }
    }
    if (end < 0) throw new Error(`methodBody('${name}'): 花括号没配平,源码可能坏了`);
    out.push({ src: src.slice(m.index, end), exported });
  }
  if (!out.length) {
    throw new Error(
      `methodBody('${name}'): 整个 UI 层里找不到这个方法定义。\n` +
      `已扫描文件:\n  ${uiFiles().join('\n  ')}\n` +
      `（如果它刚被拆走，检查方法名拼写或文件名是否已加入 uiFiles()）`
    );
  }
  // 导出实现优先 —— 壳只是转发,断言要看的是真实现
  out.sort((a, b) => (b.exported ? 1 : 0) - (a.exported ? 1 : 0));
  return out;
}

/**
 * 取某个方法的**全部**实现文本(跨文件),按 [导出的顶层函数, 对象方法] 排。
 * 排查"这个方法现在一共有几份 / 分别在哪"时用。
 */
export function methodBodies(name, src = blob()) {
  return _collect(name, src).map(x => x.src);
}

/**
 * 取某个方法的实现文本(跨文件找)。有导出实现就返回实现,否则返回第一个对象方法。
 * 找不到时抛错 —— 绝不返回一段"看起来有内容"的垃圾。
 */
export function methodBody(name, src = blob()) {
  return _collect(name, src)[0].src;
}

/** 方法体是否存在(不断言,只判断)—— 用于「这个东西被拆走了吗」这类检查 */
export function hasMethod(name, src = blob()) {
  try { _collect(name, src); return true; } catch { return false; }
}

/** 某个方法定义在哪个文件里 —— 排查"为什么断言找不到"时用 */
export function locateMethod(name) {
  for (const f of uiFiles()) {
    try { _collect(name, readOne(f)); return f; } catch { /* 下一个 */ }
  }
  return null;
}