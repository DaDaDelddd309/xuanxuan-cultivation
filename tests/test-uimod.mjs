// lib-uimod.mjs 自测 —— 给"测试的测试"补一层
// 运行: node tests/test-uimod.mjs
//
// 为什么需要这个文件:
//   lib-uimod.mjs 是被 8 个测试文件依赖的**源码解析工具**。
//   它如果悄悄返回一段错的文本,那 8 个测试会一起绿给假答案 ——
//   而且比没有测试更坏,因为它看起来是在"验证"。
//   写这个工具的过程中它已经错了两次(参数表定位、嵌套模板串),
//   两次都是**提取到了非空的错文本**,长度检查完全看不出来。
//
//   所以这里的核心不是"它能用",而是「它错的时候会报」。

import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const throws = (n, fn) => {
  try { fn(); fail++; failed.push(n + ' :: 本该抛错却没抛'); console.log(`  ❌ ${n} 本该抛错却没抛`); }
  catch { pass++; }
};

const M = await import('./lib-uimod.mjs');

// ─────────────────────────────────────────────────────────
console.log('\n[1] codeMask 在真实 UI 源文件上括号配平');
// 一个 mask 出了错,后面每一条断言都在错文本上跑,而它们会照常通过。
{
  const files = M.uiFiles();
  ok('UI 层至少有一个文件', files.length >= 1);
  for (const f of files) {
    const mask = M.codeMask(M.readOne(f)).code;
    let d = 0, min = 0;
    for (const c of mask) { if (c === '{') d++; else if (c === '}') { d--; if (d < min) min = d; } }
    ok(`${f} 花括号配平`, d === 0 && min === 0, `净值 ${d} 最低 ${min}`);
    let p = 0, pmin = 0;
    for (const c of mask) { if (c === '(') p++; else if (c === ')') { p--; if (p < pmin) pmin = p; } }
    ok(`${f} 圆括号配平`, p === 0 && pmin === 0, `净值 ${p} 最低 ${pmin}`);
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n[2] 嵌套模板串不被截断(第一次踩的坑)');
// UI 层遍地是 `${x.map(a => `<div>${esc(a)}</div>`).join('')}`。
// 单层扫描一遇到内层反引号就收尾,后面几千字符全错位。
{
  const src = [
    'const a = `',                       // 0: 模板开始
    '${list.map(x => `<i>${esc(x)}</i>`).join("")}',   // 1: 嵌套模板 + 内层插值
    '`;',
    'function after(){ const o = { k: 1 }; return o.k; }',
  ].join('\n');
  const mask = M.codeMask(src).code;
  ok('嵌套模板后面的代码还在', /function after/.test(mask));
  ok('嵌套模板的正文被抹掉', !mask.includes('<i>') && !mask.includes('</i>'));
  // 注意:${ } 里的表达式是**真代码**,必须留在 mask 里 —— 它里面可能有花括号。
  // 这里曾经把「插值里的代码被抹掉」当成正确,那是把方向搞反了。
  ok('插值里的代码保留(它可能含花括号)', /esc\(x\)/.test(mask));
  ok('模板里的 ${ } 本身被抹掉',
     !mask.slice(mask.indexOf('const a'), mask.indexOf('function after')).includes('{'));
  ok('插值内的对象字面量不影响配平', (() => {
    let d = 0; for (const c of mask) { if (c === '{') d++; else if (c === '}') d--; } return d === 0;
  })());
}

// ─────────────────────────────────────────────────────────
console.log('\n[3] 字符串/注释/正则里的花括号不算数');
{
  const src = [
    "const s = '} {';",
    '// 注释里的 } {',
    '/* 块注释 } { */',
    'const r = /[{}]/g;',
    'const o = {',
    '  f(){ return 1; }',
    '};',
  ].join('\n');
  const mask = M.codeMask(src).code;
  const b = M.methodBody('f', src).trim();
  ok('methodBody 只取到 f 本体', b === 'f(){ return 1; }', JSON.stringify(b));
}

// ─────────────────────────────────────────────────────────
console.log('\n[4] methodBody 定位准确(第二次踩的坑)');
// 原实现在签名后**再往前找下一个 `(`**,于是截到了函数体里的调用。
// 症状:返回的文本非空,长度检查过得去,内容完全不相干。
{
  const src = '  act(a, v, v2) {\n    const s = get(a);\n    switch (a) { case 1: break; }\n  },\n  next() { return 0; }';
  const b = M.methodBody('act', src).trim();
  ok('取到的是 act 本身', b.startsWith('act(a, v, v2)'), JSON.stringify(b.slice(0, 30)));
  ok('没有多吃到 next', !b.includes('next'));
  ok('取到的是完整方法体', b === 'act(a, v, v2) {\n    const s = get(a);\n    switch (a) { case 1: break; }\n  }', JSON.stringify(b));
}

// ─────────────────────────────────────────────────────────
console.log('\n[5] 找不到方法必须抛错,绝不返回一段"看着有内容"的文本');
// 这是本文件存在的**核心理由**:工单 XX-AUDIT-005 里那条假通过的断言
// 是 `slice(-1)` 拿到最后一个字符后 `.includes(...)` 恒为 false,
// 取反恒为 true。工具层面的对策是:找不到 = 抛错,不给任何返回值。
{
  throws('不存在的方法要抛错', () => M.methodBody('根本没这个方法'));
  let err = null;
  try { M.methodBody('vTomb如果被搬走了'); } catch (e) { err = e; }
  ok('报错信息说清了扫过哪些文件', !!err && err.message.includes('js/xiuxian/ui.js'));
  ok('hasMethod 对不存在的方法返回 false(不抛错)', M.hasMethod('不存在的X') === false);
  ok('hasMethod 对存在的方法返回 true', M.hasMethod('vRealm') === true);
  ok('locateMethod 对存在的方法能定位到文件', M.locateMethod('vRealm') === 'js/xiuxian/ui.js',
     String(M.locateMethod('vRealm')));
}

// ─────────────────────────────────────────────────────────
console.log('\n[6] Hall 的每个方法都能被提取(拆分前的基线)');
// methodBody 覆盖不到的方法,一旦被搬走,那些断言就会静默失效。
// 这里先钉死"今天全都提得到",拆分后新增的文件也要自动进这个集合。
{
  const hall = await (async () => {
    globalThis.document = { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }), body: { appendChild() {} }, getElementById: () => null };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    return (await import(ROOT + '/js/xiuxian/ui.js')).Hall;
  })();
  const names = Object.keys(hall).filter(k => typeof hall[k] === 'function');
  ok('Hall 至少 40 个方法', names.length >= 40, `实际 ${names.length}`);
  const missed = [];
  for (const n of names) { try { M.methodBody(n); } catch { missed.push(n); } }
  ok('Hall 的每个方法名都能在源码里定位到', missed.length === 0, missed.join(','));
}

// ─────────────────────────────────────────────────────────
console.log('\n[7] 区分「导出的实现」与「对象里的壳」(第三次踩的坑)');
// 拆分后同一个方法名有两份:
//   js/xiuxian/ui/tomb.js : export function vTomb(hall) { ...真实现... }
//   js/xiuxian/ui.js      :   vTomb() { return vTombImpl(this); }    ← 壳
// 只认第一份会拿到壳,而壳里当然没有真代码 ——
// "vTomb 里不该出现 SPINE.openTomb" 这条断言就会因为**实现被搬走了**而变绿。
// 这正是工单 XX-AUDIT-005 里那条假通过的升级版。
{
  const src = [
    'const Hall = {',
    '  vTomb() { return vTombImpl(this); },',
    '};',
    'export function vTomb(hall) {',
    '  hall.doSomething();',
    '  return 1;',
    '}',
  ].join('\n');
  const all = M.methodBodies('vTomb', src);
  ok('两份都找得到', all.length === 2, `实际 ${all.length}`);
  ok('默认给的是真实现(不是壳)', !M.methodBody('vTomb', src).includes('vTombImpl(this)'),
     M.methodBody('vTomb', src).slice(0, 60));
  ok('真实现里有内容', /doSomething/.test(M.methodBody('vTomb', src)));
  ok('两份都能单独拿到', all.some(x => /return vTombImpl/.test(x)) && all.some(x => /doSomething/.test(x)));
  // 反过来:实现里真出现了 openTomb,断言必须能看到
  const src2 = src.replace('  hall.doSomething();', '  SPINE.openTomb();');
  ok('实现里的敏感调用没被壳挡掉', /SPINE\.openTomb/.test(M.methodBody('vTomb', src2)));
}

console.log(`\ntest-uimod: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);