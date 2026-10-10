// 广播条跨局残留测试 —— 工单 XX-AUDIT-031
// 运行: node tests/broadcast-residue-regression.mjs
//
// 背景:`companion-broadcast.js` 的 root 元素是 `ensure()` 建的、
// **整页只建一次**,而且从来没有被移除过(全仓 `cc-broadcast` 只有一处赋值)。
// 于是 `clearBroadcast()` 从写出来那天起就没人调用 ——
// 它自己的注释白纸黑字写着「开局/结算清场」。
//
// 玩家看到的现象:
//   上一局最后两句留在 DOM 里 → 中途 HUD 被 `.hidden` 藏住,看不见 →
//   一开新局 HUD 恢复,旧台词**先于本局任何台词**出现,
//   并且因为 `cur` 还指着旧行,本局第一句一进来,旧行会被顶成
//   「刚说完的」那一行(`cc-bc-line-prev`)。
//
// 这与 `_sFeedable` / `player.gearBonus` / XX-AUDIT-029 是同一族:
//   **「定义了 ≠ 用得上」**,而且两边都不报错。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
import { stripComments } from './lib-swlist.mjs';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

// ───── 环境 shim(照 tests/mutation-broadcast-regression.mjs 同款)─────
// firstChild 必须有:「只保留 2 行」是 while(children.length>2) removeChild(firstChild),
// mock 里少一个 firstChild 会死循环。那里踩过一次,这里跟着抄。
function mkEl(tag = 'div') {
  const e = {
    tagName: tag, id: '', className: '', children: [], textContent: '', _html: '',
    // ⚠️ innerHTML 必须是真语义:clearBroadcast() 用的是 `root.innerHTML=''`。
    // 当普通字符串存着的话,清场之后 children 还在 —— mock 会让**修复本身看起来是坏的**,
    // 那种失败最容易把人引到「产品代码写错了」的错误方向上。
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === '') this.children.length = 0; },
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    classList: { _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); e.className = [...this._s].join(' '); },
      remove(...c) { c.forEach(x => this._s.delete(x)); e.className = [...this._s].join(' '); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return this._s.has(c); } },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
  };
  return e;
}
const BODY = mkEl('body');
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: mkEl,
  querySelector: () => null,          // 与真实 index.html 不同,但 ensure() 会退回 body
  getElementById: () => mkEl('div'),
  body: BODY,
};
globalThis.window = {};
globalThis.requestAnimationFrame = fn => { try { fn(); } catch {} };
globalThis.setTimeout = (fn) => 0;      // 停留计时器不必真跑
globalThis.clearTimeout = () => {};

const { say, clearBroadcast, setVisible } = await import('../js/xiuxian/companion-broadcast.js');

// ───── 0. 前提:新旧两条都要真存在 ─────
ok('导出 say()', typeof say === 'function');
ok('导出 clearBroadcast()', typeof clearBroadcast === 'function');
ok('导出 setVisible()', typeof setVisible === 'function');

// ───── 1. 说两句 → 广播条里留下 2 行 ─────
// ⚠️ root 是挂在 body 下的**一个元素**,BODY.children 数的是根节点个数,
//    台词行在 root.children 里。直接数 BODY 会得到「1」并误判成没渲染。
say('宝宝', '第一局的第一句');
const ROOT_EL = BODY.children[0];
ok('root 挂在 body 下', !!ROOT_EL && ROOT_EL.id === 'cc-broadcast',
  '实际: ' + (ROOT_EL ? ROOT_EL.id : '(无)'));
say('宝宝', '第一局的第二句');
ok('局内两句后广播条有 2 行', ROOT_EL.children.length === 2,
  `实测 ${ROOT_EL.children.length} 行`);

// ───── 2. clearBroadcast() 必须真的清空(这是本工单的修复点) ─────
clearBroadcast();
ok('clearBroadcast() 清空残留', ROOT_EL.children.length === 0,
  `清完还剩 ${ROOT_EL.children.length} 行`);

// ───── 3. 清空后再说,不能再把旧行当成「刚说完的」顶上来 ─────
say('宝宝', '第二局的第一句');
ok('新局第一句后只有 1 行', ROOT_EL.children.length === 1,
  `实测 ${ROOT_EL.children.length} 行 —— 说明旧行没清干净`);
ok('新局第一行是本局那句',
  ROOT_EL.children[0] && /第二局的第一句/.test(ROOT_EL.children[0].innerHTML),
  '实际内容: ' + (ROOT_EL.children[0] ? ROOT_EL.children[0].innerHTML : '(无)'));

// ───── 4. setVisible 是被 .hidden 兜住的冗余件(注释要如实) ─────
setVisible(false);
ok('setVisible(false) 走 class 而非移除节点',
  ROOT_EL.children.length === 1, '它只切 class,不该删节点');
setVisible(true);

// ───── 5. 接线契约:main.js 必须在开局处调用它 ─────
{
  const raw = readFileSync(ROOT + '/js/main.js', 'utf8');
  // ⚠️ 必须先剥注释再用正则匹配。
  //    踩过一次:把调用行改成 `// clearBroadcast();` 之后,裸正则
  //    /clearBroadcast\(\)/ **照样匹配** —— 被注释掉的代码仍然含这串字符,
  //    断言于是变成恒真,反向验证当场失败(摘掉接线,测试仍 13/13 全绿)。
  //    这与 lint-precache / lint-portraits「把注释里的内容当条目」是同一族,
  //    项目里已有单一真源 tests/lib-swlist.mjs 的 stripComments,直接复用。
  const src = stripComments(raw);

  ok('main.js import 了 clearBroadcast',
    /import\s*\{[^}]*clearBroadcast[^}]*\}\s*from\s*['"][^'"]*companion-broadcast\.js['"]/.test(src));

  const calls = (src.match(/clearBroadcast\(\)/g) || []).length;
  ok('main.js 在开局处调用 clearBroadcast()', calls === 1,
    `剥注释后匹配到 ${calls} 次(期望 1 次)`);

  // 必须挨着开局:与 companion.begin() 同段,不能塞进无关分支
  ok('clearBroadcast() 与 companion.begin() 相邻(局内状态重置区)',
    /companion\.begin\(\);[\s\S]{0,400}clearBroadcast\(\)/.test(src));

  // 反向:不能把清理塞进 HUD 隐藏那侧 —— 那是结算前,不是开局
  ok('没有把清理塞到 HUD.show(false) 之后',
    !/HUD\.show\(false\)[\s\S]{0,120}clearBroadcast\(\)/.test(src));
}

console.log(`\n广播条跨局残留: ${pass} 通过, ${fail} 失败`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);