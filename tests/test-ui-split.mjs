// 修仙阁 UI 拆分契约 —— 工单 XX-AUDIT-005
// 运行: node tests/test-ui-split.mjs
//
// 拆 ui.js 的拆法是「搬实现、留同名壳」:
//   js/xiuxian/ui/tomb.js : export function vTomb(hall) { ...真实现... }
//   js/xiuxian/ui.js      :   vTomb() { return vTombImpl(this); }    ← 壳
// 好处是 Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 但这个拆法有**四类不会自己报警的坏掉方式**,本文件逐条钉死:
//   1. 视图模块里 import 了 Hall —— ui.js import 视图,视图再 import ui.js,
//      循环依赖在原生 ESM 下拿到 undefined。不报错,只是那个方法是空的。
//   2. 搬的时候忘了把 `this.` 换成 `hall.` —— 函数照样定义得出来,
//      只在真执行到那一行时才炸,而这些方法很少被触发。
//   3. 壳忘了留 —— Hall 上少一个方法,调用点还在,点了没反应
//      (这正是 V0.89 那次误删 askStoryPath/showStoryDone 的事故形态)。
//   4. 新文件没进 sw.js 预缓存 —— 在线没事(SW 会走网络补),
//      离线整页白屏。lint-precache 已经做全量双向核对,这里再钉一道。

import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const UIDIR = ROOT + '/js/xiuxian/ui';

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const rel = p => p.slice(ROOT.length + 1);

// —— DOM / 运行时 stub:只要够这些方法跑起来 ——
const store = {};
globalThis.requestAnimationFrame = f => { try { f(); } catch {} return 0; };
globalThis.setTimeout = () => 0;
const madeEls = [];
const mkEl = () => {
  const e = {
    style: {}, dataset: {}, textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => ({ onclick: null, remove() {} }),
  };
  madeEls.push(e); return e;
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, createElement: mkEl,
  body: { appendChild() {} }, getElementById: () => mkEl(),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = v, removeItem: k => delete store[k] };

const viewFiles = existsSync(UIDIR)
  ? readdirSync(UIDIR).filter(f => f.endsWith('.js') && f !== 'dom.js').sort()
  : [];

// ─────────────────────────────────────────────────────────
console.log('\n[1] 拆出去的每个方法,Hall 上必须还有同名壳');
{
  const { Hall } = await import(ROOT + '/js/xiuxian/ui.js');
  ok('ui/ 目录已建立(有页面被拆出)', viewFiles.length > 0, `${viewFiles.length} 个视图文件`);
  const moved = [];
  for (const f of viewFiles) {
    const src = readFileSync(UIDIR + '/' + f, 'utf8');
    for (const m of src.matchAll(/^export\s+function\s+(\w+)\s*\(/gm)) moved.push([m[1], f]);
  }
  ok('至少搬走了一个方法', moved.length > 0);
  for (const [name, file] of moved) {
    ok(`Hall.${name} 还在(${file})`, typeof Hall[name] === 'function', `类型 ${typeof Hall[name]}`);
  }
  // 壳必须真的转发,不能只是个空函数或者复制了实现
  for (const [name] of moved) {
    const s = String(Hall[name]);
    ok(`Hall.${name} 是转发壳(不含实现体)`, s.length < 120, `壳有 ${s.length} 字符,像是把实现搬进了壳里`);
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n[2] 视图模块不得 import Hall(循环依赖)');
// ui.js import 视图模块;视图模块再 import ui.js 就是环。
// 原生 ESM 处理环时,先被加载的那个拿到的是 undefined —— 不抛错,
// 那个方法就是空的,点下去没反应。
{
  for (const f of viewFiles) {
    const src = readFileSync(UIDIR + '/' + f, 'utf8');
    ok(`${f} 没有 import ui.js`, !/from\s*'\.\.\/ui\.js'/.test(src));
    ok(`${f} 没有 import index.js 里的 Hall`, !/import\s*\{[^}]*\bHall\b[^}]*\}/.test(src));
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n[3] 视图模块里的 this. 必须换成 hall.');
// 搬的时候漏改不会在定义时报错,只在真执行到那一行时才炸。
{
  for (const f of viewFiles) {
    const src = readFileSync(UIDIR + '/' + f, 'utf8');
    const { codeMask } = await import('./lib-uimod.mjs');
    const code = codeMask(src).code;         // 先抹掉字符串/注释,免得误伤
    const bare = [...code.matchAll(/(^|[^\w.$])this\.(\w+)/g)].map(m => m[2]);
    ok(`${f} 没有裸 this.`, bare.length === 0, bare.slice(0, 5).join(','));
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n[4] 新文件必须进预缓存清单');
{
  const sw = readFileSync(ROOT + '/sw.js', 'utf8');
  const all = existsSync(UIDIR) ? readdirSync(UIDIR).filter(f => f.endsWith('.js')) : [];
  for (const f of all) {
    const key = `js/xiuxian/ui/${f}`;
    ok(`${key} 在 sw.js 清单里`, sw.includes(`'${key}'`), '离线拉不到 = 整页白屏');
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n[5] Hall 对外接口没变(外部真正在用的那些)');
{
  const { Hall } = await import(ROOT + '/js/xiuxian/ui.js');
  // 实测:main.js 用 open/showOffline,e2e-cult.mjs 用 act/isOpen/open/render,
  // test-uitext.mjs 用 open/render。close 与 tab 也在别处用到,一并钉住。
  for (const m of ['open', 'close', 'isOpen', 'showOffline', 'act', 'render'])
    ok(`Hall.${m} 仍是函数`, typeof Hall[m] === 'function');
  ok('Hall.tab 仍是可读写的页签', 'tab' in Hall);
}

// ─────────────────────────────────────────────────────────
console.log('\n[6] 运行时冒烟:拆出去的那一页要真能渲染');
// 结构测试只能证明"接线还在",证明不了"跑起来没变"。
// 这里真调一次,把结果记下来 —— 以后再拆别页时可以照这个模式加。
{
  const R = ROOT + '/js/xiuxian/';
  const { Hall } = await import(R + 'ui.js');
  const { Cult } = await import(R + 'index.js');
  const { TOMB } = await import(R + 'tomb.js');
  const { STORY } = await import(R + 'story.js');
  Cult.init();

  const notIn = Hall.vTomb();
  ok('不在墓里时给出「下墓」按钮', /data-act="tomb-enter"/.test(String(notIn)));

  // enter 的前置是「见过石将」。踩过一次:探针漏了这条,4 个状态全落在
  // 早返回分支,对比"完全一致"但一个字都没验到。
  STORY.reset(); STORY.see('shijiang');
  const r = TOMB.enter();
  ok('见过石将后能进墓', r && r.ok === true, JSON.stringify(r));

  const inTomb = String(Hall.vTomb());
  ok('进墓后画出平面图', (inTomb.match(/class="xx-node/g) || []).length > 0);
  ok('没走过的房间是迷雾', /class="xx-node tomb fog"/.test(inTomb));
  ok('当前房间有 cur 标记', /class="xx-node tomb cur"/.test(inTomb));
  ok('走不到的房间是 locked', /locked/.test(inTomb));
  ok('进墓后不再显示「下墓」按钮', !/data-act="tomb-enter"/.test(inTomb));
}

console.log(`\ntest-ui-split: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);