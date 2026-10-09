// 变异播报测试 —— 工单 XX-MUTATION-005
// 运行: node tests/mutation-broadcast-regression.mjs
//
// 背景:变异做完了,玩家喂了石头、看了进度条,但**没有任何一句话说这件事发生过**。
// 局内已有广播条(XX-COMPANION-003),但它只接了「本局表现触发的台词」。
//
// 设计约束(本工单最关键的一条):
//   `ui.js` 正在被 Z8 侧做 XX-AUDIT-005 拆分(2176→942 行,拆出 js/xiuxian/ui/)。
//   所以这里走「**模型发事件 → 视图订阅**」:
//     companion.js 只 emit,不 import 任何 DOM 模块;
//     bond.js 订阅后转给 companion-broadcast.js。
//   结果:**ui.js 一行都不用动** —— 与并行开发零冲突。
//   本测试把这一点当成契约来断言,防止后人「顺手在 ui.js 里补一句」把冲突埋回去。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

// ---- 环境 shim:广播条要真的建 DOM,所以这次 shim 得比别处完整一点 ----
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
function mkEl(tag) {
  const e = {
    tagName: tag, className: '', children: [], style: {}, innerHTML: '', textContent: '',
    id: '', hidden: false,
    // ⚠️ firstChild/lastChild 必须有:广播条的「只保留 2 行」是
    // `while (el.children.length > 2) el.removeChild(el.firstChild)`。
    // mock 里少一个 firstChild,removeChild(undefined) 什么都不做 →
    // **死循环**,整个测试卡住不退出。踩过一次,记在这里。
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    classList: { _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); e.className = [...this._s].join(' '); },
      remove(...c) { c.forEach(x => this._s.delete(x)); e.className = [...this._s].join(' '); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return this._s.has(c); } },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) {
      this.children.push(c);
      // 每挂一行广播就记一次 —— 事后重读 children 会重复计数
      // (DOM 只留 2 行,重读等于把旧行又数一遍)
      if (c && /cc-bc-line/.test(c.className || '')) _onLine(c);
      return c;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
  };
  return e;
}
const BODY = mkEl('body');
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: mkEl,
  querySelector: () => null,
  getElementById: () => mkEl('div'),
  body: BODY,
};
globalThis.window = {};
globalThis.requestAnimationFrame = fn => { try { fn(); } catch {} };

const { COMPANION } = await import('../js/xiuxian/companion.js');
const { MUTATION } = await import('../js/xiuxian/mutation.js');
await import('../js/xiuxian/companion-broadcast.js');   // 让它把自己挂到 body
const { Bond } = await import('../js/xiuxian/bond.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

/** 每一行广播在挂载瞬间记一条 —— 播了什么,一目了然 */
let _log = [];
function _onLine(line) {
  const who = (line.innerHTML.match(/<b[^>]*>(.*?)<\/b>/) || [, ''])[1];
  const text = (line.innerHTML.match(/<span class="cc-bc-text">(.*?)<\/span>/) || [, ''])[1];
  _log.push({ who, text, html: line.innerHTML });
}
function saidAll() { return _log; }

// 订阅只挂一次,让 _mutHooked 守卫自己生效。
// ⚠️ 早先的夹具每次 fresh() 都把 _mutHooked 重置掉再挂一次,于是订阅了两份,
//    每条播报记两遍 —— 看起来像「产品重复播报」,其实是夹具绕过了防重挂守卫。
// 顺带记一条:`COMPANION.reset()` **不清订阅者**是刻意的 ——
// 订阅是应用接线不是玩家状态,清掉会让重置后 UI 失聪。
COMPANION.reset();
COMPANION.init('宝宝');
Bond._hookMutation();
Bond._hookMutation();   // 幂等性顺带验一遍

function fresh() {
  _log = [];
  COMPANION.reset();
  COMPANION.init('宝宝');
}

function feed(tier, part, n = 1) {
  for (let i = 0; i < n; i++) COMPANION.feed(tier, part, () => 0.5);
}

// ————— 1. 事件钩子本身 —————
{
  fresh();
  let hit = null;
  const off = MUTATION.on('mutate', e => { hit = e; });
  feed(1, 'skin');
  ok('mutate 事件真的发出去了', !!hit);
  ok('事件带回了族与阶段', hit && !!hit.family && typeof hit.to === 'number');
  off();
  hit = null;
  feed(1, 'skin');
  ok('退订后不再收到', hit === null);
}

// ————— 2. 只在阶段跃迁时播报 ———
{
  fresh();
  feed(1, 'skin');                       // 第 1 次:封印→初醒
  ok('阶段跃迁会播报', saidAll().length === 1, JSON.stringify(saidAll()));
  feed(1, 'skin');                       // 第 2 次:仍在初醒
  ok('普通投喂不播报(不刷屏)', saidAll().length === 1, JSON.stringify(saidAll()));
  feed(1, 'skin');                       // 第 3 次:初醒→显形
  ok('第二次跃迁也播报', saidAll().length === 2, JSON.stringify(saidAll()));
}

// ————— 3. 播报内容带族徽与阶段名 —————
{
  fresh();
  feed(1, 'skin');
  const m = COMPANION.s.mut;
  const fam = MUTATION.FAMILIES[m.family];
  ok('播报带族徽', saidAll()[0] && saidAll()[0].text.includes(fam.sigil), saidAll()[0] && saidAll()[0].text);
  ok('播报带阶段名', saidAll()[0] && saidAll()[0].text.includes(MUTATION.STAGES[1].name), saidAll()[0] && saidAll()[0].text);
  ok('播报人是灵伴名', saidAll()[0] && saidAll()[0].who === '宝宝');
}

// ————— 4. 真身定稿的两种结局都要播 ——————
{
  fresh();
  for (let i = 0; i < 10; i++) feed(4, 'skin');
  const before = saidAll().length;
  ok('10 次投喂后已到真身且未提前播报', COMPANION.canChooseFinal() && saidAll().length === before);
  COMPANION.chooseFinal(true);
  ok('伸手会播报', saidAll().length === before + 1, JSON.stringify(saidAll().slice(-1)));
  ok('伸手播报含「是你变了」', saidAll()[saidAll().length-1].text.includes('是你变了'), saidAll()[saidAll().length-1].text);

  fresh();
  for (let i = 0; i < 10; i++) feed(4, 'skin');
  const b2 = saidAll().length;
  COMPANION.chooseFinal(false);
  ok('收手会播报', saidAll().length === b2 + 1);
  ok('收手播报含「收回了手」', saidAll()[saidAll().length-1].text.includes('收回了手'), saidAll()[saidAll().length-1].text);
  ok('定稿后不再播报', (() => {
    const n = saidAll().length;
    COMPANION.chooseFinal && (() => { try { COMPANION.chooseFinal(false); } catch {} })();
    return saidAll().length === n;
  })());
}

// ————— 5. 层级契约:模型不碰 DOM,ui.js 不被碰 ——————
{
  const comp = readFileSync(ROOT + '/js/xiuxian/companion.js', 'utf8');
  ok('companion.js 没有 import 广播条(模型不依赖视图)',
     !/^\s*import[^;]*companion-broadcast/m.test(comp));
  // 事件钩子归 mutation.js 所有 —— 这样 companion.js 才守得住体积守卫
  ok('companion.js 不再持有事件钩子',
     !/\bon\(ev, fn\)/.test(comp) && !/\bemit\(ev, data\)/.test(comp));

  const mut = readFileSync(ROOT + '/js/xiuxian/mutation.js', 'utf8');
  ok('mutation.js 提供 emit', /emit\(ev, data\)/.test(mut));
  ok('mutation.js 提供 on(可退订)', /on\(ev, fn\)/.test(mut));
  // 只看真正的 import 语句 —— 注释里提到模块名不算,否则这条断言会一直假红
  ok('mutation.js 也没有 import 广播条',
     !/^\s*import[^;]*companion-broadcast/m.test(mut));
  ok('feed 里真的 emit 了', /this\.emit\('mutate', ev\)/.test(mut));
  ok('resolveFinal 里真的 emit 了', /this\.emit\('final', out\)/.test(mut));

  // companion.js 的体积守卫必须保住(那是「菜单系统没长回来」的证据)
  ok('companion.js 仍守住体积守卫(<340 行)', comp.split('\n').length < 340,
     '实际 ' + comp.split('\n').length);

  const bond = readFileSync(ROOT + '/js/xiuxian/bond.js', 'utf8');
  ok('bond.js 订阅了 mutate', /MUTATION\.on\('mutate'/.test(bond));
  ok('bond.js 订阅了 final', /MUTATION\.on\('final'/.test(bond));
  ok('bond.js 转给 Broadcast.say', /Broadcast\.say\(/.test(bond));

  // 🚨 零冲突契约:ui.js 不得被本工单改动
  const ui = readFileSync(ROOT + '/js/xiuxian/ui.js', 'utf8');
  ok('ui.js 没有订阅变异事件(避免与 Z8 拆分撞车)',
     !/COMPANION\.on\(/.test(ui) && !/MUTATION\.on\(/.test(ui));
  ok('ui.js 没有引用 Broadcast', !/companion-broadcast/.test(ui));
}

// ————— 6. 订阅只挂一次 —————
{
  fresh();
  Bond._hookMutation(); Bond._hookMutation(); Bond._hookMutation();
  const n = saidAll().length;
  feed(1, 'skin');
  ok('重复调用 _hookMutation 不会重复播报', saidAll().length === n + 1,
     `期望 ${n + 1},实际 ${saidAll().length}`);
}

console.log(`\n变异播报: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项:\n  - ' + failed.join('\n  - ')); process.exit(1); }