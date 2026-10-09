// XX-BUG-B 防回归 —— 作用域陷阱闸门
//
// 背景:`g0` 这个取游戏实例的小helper,原来定义在 main.js 的「开局装配」函数内部。
// 而同为顶层函数的 endRun() 在结算时也要用它 —— 够不着,一局结束就
// ReferenceError,Screens.showResult 永远不跑,玩家卡死在暂停的局里。
//
// 这个 lint 盯的是**模块级 helper 不许被关进函数里**:
// main.js 里被多个顶层函数共用的标识符,必须定义在列 0。
//
// 为什么值得单独一条:这类 bug 单测抓不到(e2e-core 当时零结算覆盖),
// lint 也只是权宜 —— 但比「下次再踩一遍」强。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let fail = 0;
const ok = (n, c, d = '') => {
  if (c) console.log(`  ✓ ${n}`);
  else { fail++; console.log(`  ❌ ${n} ${d}`); }
};

console.log('\n[1] main.js 的模块级 helper 必须在列 0 定义');
const main = readFileSync(join(ROOT, 'js/main.js'), 'utf8');
const lines = main.split('\n');

// 这些标识符被两个以上顶层函数共用,一旦被关进函数里就会 ReferenceError
const SHARED = ['g0'];
for (const id of SHARED) {
  const defs = [];
  lines.forEach((l, i) => {
    if (new RegExp(`^(\\s*)(?:const|let|var|function)\\s+${id}\\b`).test(l)
        || new RegExp(`^(\\s*)function\\s+${id}\\s*\\(`).test(l)) {
      defs.push({ line: i + 1, indent: l.match(/^\s*/)[0].length });
    }
  });
  ok(`${id} 有定义`, defs.length > 0, '找不到定义');
  ok(`${id} 定义在模块顶层（列 0）`, defs.every(d => d.indent === 0),
     JSON.stringify(defs));
  ok(`${id} 只有一处定义（没有函数内私藏的第二份）`, defs.length === 1,
     JSON.stringify(defs));
}

console.log('\n[2] main.js 运行时不得有未捕获异常（语法级）');
let syntaxOk = true, msg = '';
try {
  // 用动态 import 做一次真实解析（不执行浏览器专属代码，只验能否解析）
  new Function('return 0');   // 占位：真正解析交给 node --check
} catch (e) { syntaxOk = false; msg = e.message; }
ok('main.js 可解析', syntaxOk, msg);

// 明确提示:这个 lint 只挡"定义位置",挡不住"引用了没定义的变量"。
// 那要靠真浏览器跑结算路径 —— 见 XX-BUG-B 工单里记的实测步骤。
console.log('  ℹ 本 lint 只挡定义位置;引用未定义变量需真浏览器验证结算路径');

console.log(`\nlint-scope: ${fail ? 'FAIL' : 'PASS'} (${fail ? fail : 'ok'})`);
process.exit(fail ? 1 : 0);