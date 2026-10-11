// ===== 装备页交互门禁(点选 / 拖拽)=====
//
// 运行: node tests/gear-ui-interaction-regression.mjs
// 退出码:0 通过 / 1 不通过 / 2 门禁自身失效(解析不到东西,后面全在空转)
//
// 存在理由:装备页刚从「四张文字卡片 + 两个文字按钮」重构成
// 「槽位网格 + 背包网格 + 点选穿戴 + 拖拽穿戴」。这类改动最危险的失败**不报错**:
//   · 点一下穿上了,拖着穿却没穿上(两条路分叉)—— 不比对落档就发现不了
//   · 拖到一半系统收走手势(来电/通知/系统返回键),装备穿了一半或凭空消失
//   · 「快滑背包」被当成拖拽 —— 玩家报过「滑动不了,向下拉不了」
// 所以这个门禁盯四件事:**点与拖的落档是否一致**、**打断是否留下半截状态**、
// **判定函数在合成样本上是否真的判反**、**类名契约有没有走样**。
//
// ⚠️ 本机没有浏览器(harness.mjs 顶上写着:playwright 在 Android PRoot 上装不上),
//    所以这里验的是**真实模块 + 真实存档写入 + 自己写的 DOM 桩**,
//    不等于「浏览器里点过了」。真机触摸、真实滚动、CSS 滚动容器的高度,
//    都得由 CI 或桌面补 —— 见交付说明里的「验证强度」。
//
// ⚠️ 桩的自检在 [G0]。harness 自带的 closest 是「跳到容器里第一个匹配节点」,
//    dispatch 也只调本节点监听器、不冒泡。两条不修的话,这个门禁报出来的
//    红全是假的(4 个 .xx-gear-slot 同父时,第 3 个槽会被认成第 1 个)。

import { install } from './harness.mjs';
install();

import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};
const die2 = msg => { console.log(`\n❌ 门禁自身失效:${msg}`); process.exit(2); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 与 gear.js 同款戳 —— 否则拿到的是另一份 save.js 模块实例,spy 装在没人用的那份上
const V = '?v=17';
let GEARMOD, SAVE, HALL, CULT;
try {
  ({ Save: SAVE } = await import('../js/core/save.js' + V));
  GEARMOD = await import('../js/xiuxian/ui/gear.js');
  ({ Hall: HALL } = await import('../js/xiuxian/ui.js'));
  ({ Cult: CULT } = await import('../js/xiuxian/index.js'));
  CULT.init();
} catch (e) {
  die2(`装备页模块加载失败,下面的断言一条都没跑:\n     ${e.message}`);
}
HALL.open();                       // 走真链路:build() → #xx-body,ui.js 的委托才有挂载点

const { GEAR, GEAR_IDS } = await import('../js/game/gear.js' + V);
const { gearDropAction, gearDragPhase, DRAG_HOLD_MS } = GEARMOD;

// ─────────────────────────────────────────────
// DOM 桩:修 closest、补指针捕获、让事件真的冒泡、给命中测试
// ─────────────────────────────────────────────

/** 选择器拆解:支持 #id / .cls / [attr] / [attr="v"] / tag / 逗号并列 */
function parseSel(sel) {
  return String(sel).split(',').map(s => s.trim()).filter(Boolean).map(c => {
    let m;
    if ((m = c.match(/^#(.+)$/))) return { k: 'id', v: m[1] };
    if ((m = c.match(/^\.(.+)$/))) return { k: 'cls', v: m[1] };
    if ((m = c.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/))) return { k: 'attr', a: m[1], v: m[2] };
    return { k: 'tag', v: c.toUpperCase() };
  });
}
const hitNode = (el, p) => {
  if (!el) return false;
  if (p.k === 'id') return el.id === p.v;
  if (p.k === 'cls') return !!(el.classList && el.classList.contains(p.v));
  if (p.k === 'tag') return el.tagName === p.v;
  const d = el.dataset || {}, a = el.attrs || {};
  if (p.a.startsWith('data-')) return p.v === undefined ? (p.a.slice(5) in d) : d[p.a.slice(5)] === p.v;
  return p.v === undefined ? (p.a in a) : a[p.a] === p.v;
};
/** 浏览器语义:先看自己,再往上找最近的匹配祖先 */
function realClosest(self, sel) {
  const parts = parseSel(sel);
  for (let n = self; n; n = n.parentElement) if (parts.some(p => hitNode(n, p))) return n;
  return null;
}

/** 捕获相监听器登记表。harness 的 addEventListener 不记 capture 标志,
 *  不分相的话同一次点击会把 ui.js 的委托触发两遍 —— 门禁会看到两次 equip,
 *  然后报一个「浏览器里不存在的红」。必须在监听注册时就把标志截下来。 */
const CAP_LS = [];
{
  const host = document.querySelector('#xx-body');
  if (!host) die2('HALL.open() 之后找不到 #xx-body');
  const raw = host.addEventListener;
  host.addEventListener = (type, f, opts) => {
    raw.call(host, type, f, opts);
    CAP_LS.push({ node: host, type, f, cap: !!(opts && opts.capture) });
  };
}

function decorate(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (n.tagName !== undefined) {
      n.closest = sel => realClosest(n, sel);
      if (typeof n.setPointerCapture !== 'function') {
        n._cap = null;
        n.setPointerCapture = id => { n._cap = id; CAPTURED++; };
        n.releasePointerCapture = () => { n._cap = null; RELEASED++; };
        n.hasPointerCapture = id => n._cap === id;
      }
    }
    for (const c of (n.children || [])) stack.push(c);
  }
}
let CAPTURED = 0, RELEASED = 0;

/** 带捕获/冒泡的事件派发:harness 的 dispatch 只调本节点监听器 */
function fire(target, type, ev = {}) {
  const chain = [];
  for (let n = target; n; n = n.parentElement) chain.push(n);
  chain.reverse();
  const e = Object.assign({
    type, target, cancelable: true,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.__stop = true; },
  }, ev);
  e.defaultPrevented = false;
  const run = ls => { for (const f of ls) f(e); };
  const caps = n => CAP_LS.filter(l => l.node === n && l.type === type && l.cap).map(l => l.f);
  const bubbles = n => (n._listeners && n._listeners[type] ? n._listeners[type] : [])
    .filter(f => !CAP_LS.some(l => l.node === n && l.type === type && l.cap && l.f === f));
  for (let i = 0; i < chain.length - 1; i++) { if (e.__stop) break; run(caps(chain[i])); }   // 捕获
  if (!e.__stop) run(chain[chain.length - 1]._listeners && chain[chain.length - 1]._listeners[type] || []);  // 目标
  for (let i = chain.length - 2; i >= 0; i--) { if (e.__stop) break; run(bubbles(chain[i])); }            // 冒泡
  return e;
}

// —— 命中测试:elementFromPoint 走一张手工摆的矩形表,命中最小的那个(最深的节点)——
let BOXES = [];
const area = r => (r.right - r.left) * (r.bottom - r.top);
globalThis.document.elementFromPoint = (x, y) => {
  let best = null;
  for (const b of BOXES)
    if (x >= b.r.left && x <= b.r.right && y >= b.r.top && y <= b.r.bottom)
      if (!best || area(b.r) < area(best.r)) best = b;
  return best ? best.node : null;
};

/** 摆好这一页的几何:4 槽一行、背包一块、8 件一行,顺手修桩。返回可点的节点表。 */
function layout() {
  const body = document.querySelector('#xx-body');
  if (!body) die2('渲染后找不到 #xx-body');
  decorate(body);
  BOXES = [];
  const bySlot = {}, byGear = {};
  const rect = (i, top) => ({ left: 10 + i * 90, top, right: 100 + i * 90, bottom: top + 80 });
  const put = (node, r, bag) => {
    node.getBoundingClientRect = () => r;
    BOXES.push({ node, r });
    return { node, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, bag: !!bag };
  };
  body.querySelectorAll('.xx-gear-slot').forEach((s, i) => { bySlot[s.dataset.slot] = put(s, rect(i, 10)); });
  const bagNode = body.querySelector('.xx-gear-bag');
  const bag = bagNode ? put(bagNode, { left: 10, top: 200, right: 800, bottom: 420 }, true) : null;
  body.querySelectorAll('.xx-gear-item').forEach((n, i) => { byGear[n.dataset.gear] = put(n, rect(i, 600)); });
  return { bySlot, byGear, bag, body };
}

// —— 存档探针:证明写入走的是 Save.equip / Save.unequip,而不是页面自己改数组 ——
const CALLS = [];
const REAL_EQUIP = SAVE.equip, REAL_UNEQUIP = SAVE.unequip;
SAVE.equip = function (id) { CALLS.push({ fn: 'equip', arg: id }); return REAL_EQUIP.call(SAVE, id); };
SAVE.unequip = function (slot) { CALLS.push({ fn: 'unequip', arg: slot }); return REAL_UNEQUIP.call(SAVE, slot); };
const takeCalls = () => { const c = CALLS.slice(); CALLS.length = 0; return c; };
const sameCalls = (got, want) => JSON.stringify(got) === JSON.stringify(want);
const snap = () => JSON.stringify({ gear: SAVE.data.gear, owned: SAVE.data.gearOwned });

/** 重开一页装备页。存档从零搭,不留上一次的残局。 */
function openGear(owned = GEAR_IDS, worn = {}) {
  takeCalls();
  SAVE.reset();
  SAVE.data.gearOwned = [...owned];
  SAVE.data.gear = { head: null, body: null, hand: null, foot: null, ...worn };
  HALL.tab = 'gear';
  HALL.render();
  return layout();
}

const POINT = { pointerId: 7 };
const clickOn = pt => { fire(pt.node, 'click'); return layout(); };
/** 按住 → 移动 → 松开(或被系统收走)。
 *  holdFirst=true:先等过长按阈值再动(模拟「长按拖」)。
 *  via:最后一次 pointermove 停在哪。**不给的话最后一步正好落在目标上**,
 *       于是「落点到底看最后一次 move 还是看抬手坐标」这件事验不出来 ——
 *       手机上最快的甩投恰恰是「最后一下 move 没到、抬手才到」。 */
async function drag(from, to, opts = {}) {
  const { holdFirst = true, end = 'pointerup', steps = 2, via = null } = opts;
  fire(from.node, 'pointerdown', { ...POINT, clientX: from.x, clientY: from.y, cancelable: true });
  if (holdFirst) await sleep(DRAG_HOLD_MS + 100);
  const lastMove = via || to;
  for (let i = 1; i <= steps; i++) {
    fire(from.node, 'pointermove', {
      ...POINT, cancelable: true,
      clientX: from.x + (lastMove.x - from.x) * i / steps,
      clientY: from.y + (lastMove.y - from.y) * i / steps,
    });
  }
  fire(from.node, end, { ...POINT, clientX: to.x, clientY: to.y, cancelable: true });
  return layout();
}
const ghosts = () => (document.body.querySelectorAll ? document.body.querySelectorAll('.xx-gear-drag') : []);
const anyDropOk = L => L.body.querySelectorAll('.xx-gear-slot').some(s => s.classList.contains('drop-ok'));
const OFF_PAGE = { node: null, x: 990, y: 990 };

// ─────────────────────────────────────────────
console.log('\n[G5] 解析器防退化 + 类名契约:真的解析到 4 个槽位和 8 件装备');
// 这条在最前面跑:DOM 桩一旦解不出东西,后面的断言全在空转,
// 而一份全绿但什么都没验的门禁比没有门禁更危险(AUTONOMY §3)。
let L = openGear();
{
  const slots = L.body.querySelectorAll('.xx-gear-slot');
  const items = L.body.querySelectorAll('.xx-gear-item');
  if (slots.length === 0 || items.length === 0)
    die2(`槽位解析到 ${slots.length} 个、背包条目 ${items.length} 个 —— ` +
         `装备页根本没渲染出来,后面所有断言都验不到东西`);
  t('解析到 4 个槽位', slots.length === 4, `实测 ${slots.length}`);
  t('解析到 8 件装备', items.length === 8, `实测 ${items.length}`);
  t('四个槽位齐全(head/body/hand/foot)',
    ['head', 'body', 'hand', 'foot'].every(s => slots.some(n => n.dataset.slot === s)),
    slots.map(s => s.dataset.slot).join(','));
  t('根容器是 .xx-gear', !!L.body.querySelector('.xx-gear'));
  t('背包区是 .xx-gear-bag', !!L.body.querySelector('.xx-gear-bag'));
  t('提示行是 .xx-gear-hint', !!L.body.querySelector('.xx-gear-hint'));
  t('每个槽位都有槽位名', slots.every(s => !!s.querySelector('.xx-gear-slot-name')));
  t('每件装备都有名字', items.every(n => !!n.querySelector('.xx-gear-item-name')));
  t('每件装备都有 rarity-1…4 配色钩子',
    items.every(n => /(^|\s)rarity-[1-4](\s|$)/.test(n.className)),
    items.map(n => n.className).join(' | '));
  t('空槽画出的是 .xx-gear-slot-empty',
    slots.every(s => !!s.querySelector('.xx-gear-slot-empty')));

  // CSS 代理并行在写 gear.css:源码里出现的每个 .xx-gear-* 都得在清单里,
  // 清单里每个名字也真得被用上。两个方向少一个都会漏。
  const CONTRACT = ['xx-gear', 'xx-gear-slots', 'xx-gear-slot', 'xx-gear-slot-icon', 'xx-gear-slot-name',
    'xx-gear-slot-item', 'xx-gear-slot-empty', 'xx-gear-bag', 'xx-gear-item', 'xx-gear-item-icon',
    'xx-gear-item-name', 'xx-gear-drag', 'xx-gear-hint'];
  const src = readFileSync(ROOT + '/js/xiuxian/ui/gear.js', 'utf8');
  const used = new Set([...src.matchAll(/\bxx-gear(-[a-z-]+)?/g)].map(m => m[0]));
  const outside = [...used].filter(c => !CONTRACT.includes(c));
  const missing = CONTRACT.filter(c => !used.has(c));
  t('源码里没有契约之外的 .xx-gear-* 类名(CSS 代理按这份清单写)', outside.length === 0, outside.join(','));
  t('契约里的类名都被用上了', missing.length === 0, missing.join(','));
}

// ─────────────────────────────────────────────
console.log('\n[G0] 桩自检:事件真的冒泡、closest 找的是最近的祖先');
{
  const slots = L.body.querySelectorAll('.xx-gear-slot');
  t('closest 命中的是自己(第 3 个槽不是第 1 个)', realClosest(slots[2], '.xx-gear-slot') === slots[2],
    `拿到的 dataset.slot=${(realClosest(slots[2], '.xx-gear-slot') || {}).dataset?.slot}`);
  const bagItem = L.byGear['hongyi_garment'].node;
  const icon = bagItem.querySelector('.xx-gear-item-icon') || bagItem;
  t('closest 能从图标里找到所属的背包条目', realClosest(icon, '.xx-gear-item') === bagItem);
  let probeHit = false;
  L.body.addEventListener('click', () => { probeHit = true; });
  fire(bagItem, 'click');
  t('在子节点上 fire 会一路冒泡到祖先(否则点不到 ui.js 的委托)', probeHit === true);
  t('一次点击只触发一次委托(harness 不分捕获/冒泡会触发两遍)',
    takeCalls().filter(c => c.fn === 'equip').length === 1, JSON.stringify(CALLS));
  t('elementFromPoint 命中手位槽', document.elementFromPoint(L.bySlot.hand.x, L.bySlot.hand.y) === L.bySlot.hand.node);
  t('空白处命中 null', document.elementFromPoint(OFF_PAGE.x, OFF_PAGE.y) === null);
}

// ─────────────────────────────────────────────
console.log('\n[G1] 点一下:写的确实是 Save.equip / Save.unequip,单槽互斥没被绕过');
{
  L = openGear(GEAR_IDS, {});
  L = clickOn(L.byGear['hongyi_garment']);
  t('点背包里的一件 → 落进它自己的 body 槽', SAVE.data.gear.body === 'hongyi_garment',
    JSON.stringify(SAVE.data.gear));
  t('这次写入只经由 Save.equip', sameCalls(takeCalls(), [{ fn: 'equip', arg: 'hongyi_garment' }]));

  L = clickOn(L.byGear['shijiang_seal']);            // head, 稀有度 2
  L = clickOn(L.byGear['laolao_hairpin']);           // 同槽, 稀有度 4
  t('同槽换装:后来者上位', SAVE.data.gear.head === 'laolao_hairpin', JSON.stringify(SAVE.data.gear));
  t('同槽换装:被替下的那件没有消失(仍在背包里)',
    SAVE.data.gearOwned.includes('shijiang_seal') && SAVE.data.gearOwned.length === 8,
    `owned=${SAVE.data.gearOwned.length}`);
  t('换装只调了两次 equip', sameCalls(takeCalls(), [
    { fn: 'equip', arg: 'shijiang_seal' }, { fn: 'equip', arg: 'laolao_hairpin' }]));

  L = clickOn(L.bySlot.head);
  t('点已穿的槽位 → 脱下', SAVE.data.gear.head === null, JSON.stringify(SAVE.data.gear));
  t('脱下走 Save.unequip', sameCalls(takeCalls(), [{ fn: 'unequip', arg: 'head' }]));
  t('脱下不改变拥有列表', SAVE.data.gearOwned.length === 8);

  L = clickOn(L.bySlot.foot);                         // 空槽没有 data-act
  t('点空槽不写存档', takeCalls().length === 0);
  const wornItem = L.byGear['hongyi_garment'].node;   // 身上穿着的那件
  L = clickOn(L.byGear['hongyi_garment']);
  t('点已穿着的背包条目不重复穿戴(它已在本槽)',
    takeCalls().length === 0 && SAVE.data.gear.body === 'hongyi_garment', JSON.stringify(CALLS));
  t('已穿着的条目带 .worn', wornItem.classList.contains('worn'), wornItem.className);

  // UI 没绕过 save.js 的空槽校验:直接问一次
  const r = GEARMOD.doGearOff(HALL, 'foot');
  t('空槽直接脱下被 save.js 拒掉(规则只定一次,没被绕过)', r.ok === false, JSON.stringify(r));
  takeCalls();
}

// ─────────────────────────────────────────────
console.log('\n[G2] 点着穿 vs 拖着穿:落档结果必须逐字相同');
{
  const seq = async (mode) => {
    let g = openGear(GEAR_IDS, { hand: 'jiangu_blade' });   // 手位先戴一件,逼出「互斥替换」分支
    const step = async (a, b) => (mode === 'click'
      ? clickOn(a)
      // 甩投:最后一次 move 故意停在离槽位 70px 的地方,抬手才到 ——
      // 落点如果读的是「最后一次 move」,这里就会掉进空处,点与拖立刻分叉
      : drag(a, b, { via: { x: b.x + 70, y: b.y + 70 } }));
    // 每一步都要把 g 换成重绘后的节点表 —— 拿着上一帧的旧节点点,验的是空气
    g = await step(g.byGear['baize_claw'], g.bySlot.hand);       // 同槽替换
    g = await step(g.byGear['laolao_hairpin'], g.bySlot.head);    // 穿上
    g = await step(g.bySlot.head, g.bag);                         // 拖回背包 = 脱下
    return snap();
  };
  const byClick = await seq('click');
  const byDrag = await seq('drag');
  t('点与拖的最终存档逐字相同', byClick === byDrag,
    byClick === byDrag ? '' : `\n       点:${byClick}\n       拖:${byDrag}`);
  const wornByClick = JSON.parse(byClick).gear;
  t('对照组真的动过存档(不是两边都空才相等)',
    wornByClick.hand === 'baize_claw' && !wornByClick.head, byClick);

  // 反向:拖拽必须真的写了存档 —— 否则上面那句相等可能只是「两边都没生效」
  openGear(GEAR_IDS, {});
  let g = layout();
  takeCalls();
  g = await drag(g.byGear['dengshi_lamp'], g.bySlot.foot);
  t('拖到对的槽位 → 真的穿上', SAVE.data.gear.foot === 'dengshi_lamp', JSON.stringify(SAVE.data.gear));
  t('拖拽的写入也经由 Save.equip', sameCalls(takeCalls(), [{ fn: 'equip', arg: 'dengshi_lamp' }]));
  t('拖完重绘了(槽位里画出装备名)', !!g.bySlot.foot.node.querySelector('.xx-gear-slot-item'));
  g = await drag(g.bySlot.foot, g.bag);
  t('从槽位拖回背包 → 真的脱下', SAVE.data.gear.foot === null, JSON.stringify(SAVE.data.gear));
  t('脱下这一下真的调了 Save.unequip(不是空转的假绿)',
    sameCalls(takeCalls(), [{ fn: 'unequip', arg: 'foot' }]));
  t('拖完装备回到背包,一件没少', SAVE.data.gearOwned.length === 8 && SAVE.data.gearOwned.includes('dengshi_lamp'));
  t('拖完幽灵已收掉', ghosts().length === 0, `残留 ${ghosts().length}`);
  t('拖完没有残留 drop-ok 高亮', !anyDropOk(g));

  // 拖拽落点的悬停反馈:只有「这件装备能进的那个槽」才亮
  g = openGear(GEAR_IDS, {});
  const it = g.byGear['hongyi_garment'];               // body 件
  fire(it.node, 'pointerdown', { ...POINT, clientX: it.x, clientY: it.y, cancelable: true });
  await sleep(DRAG_HOLD_MS + 100);
  fire(it.node, 'pointermove', { ...POINT, clientX: g.bySlot.hand.x, clientY: g.bySlot.hand.y, cancelable: true });
  t('悬停在错槽位不高亮(那是 body 件,手位不收)', !g.bySlot.hand.node.classList.contains('drop-ok'));
  fire(it.node, 'pointermove', { ...POINT, clientX: g.bySlot.body.x, clientY: g.bySlot.body.y, cancelable: true });
  t('悬停在对的槽位会高亮 .drop-ok', g.bySlot.body.node.classList.contains('drop-ok'));
  fire(it.node, 'pointerup', { ...POINT, clientX: g.bySlot.body.x, clientY: g.bySlot.body.y, cancelable: true });
  g = layout();
  t('顺着高亮松手 → 穿上了(悬停反馈与落点判定是同一套)', SAVE.data.gear.body === 'hongyi_garment');
  takeCalls();
}

// ─────────────────────────────────────────────
console.log('\n[G3] 拖到一半被打断 / 落在空白 / 落在错槽位:不产生半截状态');
{
  // a) pointercancel:系统收走了手势(来电、通知、系统返回键)
  let g = openGear(GEAR_IDS, { hand: 'jiangu_blade' });
  let before = snap(); takeCalls();
  g = await drag(g.byGear['baize_claw'], g.bySlot.hand, { end: 'pointercancel' });
  t('pointercancel 后存档逐字不变', snap() === before, `\n       前:${before}\n       后:${snap()}`);
  t('pointercancel 不写存档', takeCalls().length === 0);
  t('pointercancel 收掉了幽灵', ghosts().length === 0);
  t('pointercancel 没留下 drop-ok', !anyDropOk(g));

  // b) 松手落在空白处
  g = openGear(GEAR_IDS, { hand: 'jiangu_blade' });
  before = snap(); takeCalls();
  g = await drag(g.byGear['baize_claw'], OFF_PAGE);
  t('落在空白处:存档逐字不变', snap() === before, snap());
  t('落在空白处:不写存档', takeCalls().length === 0);
  t('落在空白处:装备没丢(背包里还在)',
    SAVE.data.gearOwned.length === 8 && SAVE.data.gearOwned.includes('baize_claw'), snap());
  t('落在空白处:身上那件没被顺手脱掉', SAVE.data.gear.hand === 'jiangu_blade', snap());
  t('落在空白处:幽灵已收掉', ghosts().length === 0);

  // c) 拖到错槽位:红嫁衣是 body 件,拖到 head 槽
  g = openGear(GEAR_IDS, {});
  before = snap(); takeCalls();
  g = await drag(g.byGear['hongyi_garment'], g.bySlot.head);
  t('拖到错槽位:存档逐字不变', snap() === before, snap());
  t('拖到错槽位:不写存档', takeCalls().length === 0);

  // d) 空槽拖回背包:本来就没穿。规则只在 save.js 定一次,
  //    所以这里允许它走到 Save.unequip(由 save.js 拒掉),但**一个字都不能改**。
  g = openGear(GEAR_IDS, {});
  before = snap(); takeCalls();
  g = await drag(g.bySlot.body, g.bag);
  const emptySlotCalls = takeCalls();
  t('空槽拖回背包:存档逐字不变', snap() === before, snap());
  t('空槽拖回背包:绝不会穿上任何东西', emptySlotCalls.every(c => c.fn !== 'equip'), JSON.stringify(emptySlotCalls));

  // e) 手指还没按住满就大幅移动 → 判定为滚动手势,不抢(玩家报过「滑动不了」)
  g = openGear(GEAR_IDS, {});
  before = snap(); takeCalls();
  const it = g.byGear['hongyi_garment'];
  fire(it.node, 'pointerdown', { ...POINT, clientX: it.x, clientY: it.y, cancelable: true });
  const mv = fire(it.node, 'pointermove', { ...POINT, clientX: it.x, clientY: it.y + 40, cancelable: true });
  fire(it.node, 'pointerup', { ...POINT, clientX: it.x, clientY: it.y + 40, cancelable: true });
  g = layout();
  t('快滑背包不会被当成拖拽(不写存档)', takeCalls().length === 0 && snap() === before, snap());
  t('快滑时没开幽灵(页面滚动不被吞)', ghosts().length === 0);
  t('滚动手势下没有把 move 拦掉', mv.defaultPrevented === false, `defaultPrevented=${mv.defaultPrevented}`);
  t('滚动手势下点一下仍然能穿(滚动不该吃掉点击)',
    (clickOn(g.byGear['hongyi_garment']), SAVE.data.gear.body === 'hongyi_garment'), snap());
  takeCalls();

  // f) 真拖起来了就必须拦掉 move —— 上面那条不是「永远不 preventDefault」的假绿
  g = openGear(GEAR_IDS, {});
  const it2 = g.byGear['hongyi_garment'];
  fire(it2.node, 'pointerdown', { ...POINT, clientX: it2.x, clientY: it2.y, cancelable: true });
  await sleep(DRAG_HOLD_MS + 100);
  const mv2 = fire(it2.node, 'pointermove', { ...POINT, clientX: it2.x, clientY: it2.y - 30, cancelable: true });
  t('进入拖拽态后 move 被 preventDefault(拖拽中不滚页面)', mv2.defaultPrevented === true);
  t('进入拖拽态后幽灵出现', ghosts().length === 1, `幽灵数 ${ghosts().length}`);
  t('幽灵带着装备名(跟手的那个不是空气)', !!ghosts()[0] && /红嫁衣/.test(ghosts()[0].innerHTML),
    ghosts()[0] ? ghosts()[0].innerHTML : '没有幽灵');
  fire(it2.node, 'pointerup', { ...POINT, clientX: g.bySlot.body.x, clientY: g.bySlot.body.y, cancelable: true });
  g = layout();
  t('拖到 body 槽(对照:拖拽确实生效)', SAVE.data.gear.body === 'hongyi_garment', JSON.stringify(SAVE.data.gear));
  t('拖拽过程中做了指针捕获(手指滑出原节点也跟得住)', CAPTURED > 0 && RELEASED > 0, `captured=${CAPTURED} released=${RELEASED}`);
  takeCalls();

  // g) 长按到位但一次没动 → 撤销,并且不拦 click(慢按的玩家不该丢掉那一次点击)
  g = openGear(GEAR_IDS, {});
  takeCalls();
  const it3 = g.byGear['qingqiong_robe'];
  fire(it3.node, 'pointerdown', { ...POINT, clientX: it3.x, clientY: it3.y, cancelable: true });
  await sleep(DRAG_HOLD_MS + 100);
  fire(it3.node, 'pointerup', { ...POINT, clientX: it3.x, clientY: it3.y, cancelable: true });
  fire(it3.node, 'click');                     // 浏览器在抬手后补发的那一次 click
  g = layout();
  t('长按未移动:不会穿到别的槽位,也不会穿两次',
    SAVE.data.gear.foot === 'qingqiong_robe' && !SAVE.data.gear.head, JSON.stringify(SAVE.data.gear));
  t('长按未移动:只写了一次(慢按的那一次点击没被吞掉)',
    takeCalls().filter(c => c.fn === 'equip').length === 1);
  t('长按未移动:幽灵已收掉', ghosts().length === 0);
}

// ─────────────────────────────────────────────
console.log('\n[G4] 判定函数在合成样本上的反向自检(不碰真实存档)');
{
  // gearDropAction:样本表故意覆盖错槽、落空白、来路不明等边界。
  // ⚠️ 样本形状必须是 {from,to,want} —— 写成 [[args],want] 时,map 的
  //    解构会把「期望」当成第二个参数传进被测函数,全表恒为 none,
  //    比较恒真 —— 下面「覆盖三种结果」那条就是为了钉死这种事。
  const SYN = [
    { from: { kind: 'bag', id: 'hongyi_garment' }, to: { kind: 'slot', slot: 'body' }, want: 'equip' },
    { from: { kind: 'bag', id: 'hongyi_garment' }, to: { kind: 'slot', slot: 'head' }, want: 'none' },
    { from: { kind: 'bag', id: 'hongyi_garment' }, to: { kind: 'bag' }, want: 'none' },
    { from: { kind: 'bag', id: 'hongyi_garment' }, to: { kind: 'none' }, want: 'none' },
    { from: { kind: 'bag', id: 'hongyi_garment' }, to: null, want: 'none' },
    { from: { kind: 'slot', slot: 'head' }, to: { kind: 'bag' }, want: 'unequip' },
    { from: { kind: 'slot', slot: 'head' }, to: { kind: 'slot', slot: 'body' }, want: 'none' },
    { from: { kind: 'slot', slot: 'head' }, to: { kind: 'none' }, want: 'none' },
    { from: { kind: 'slot', slot: 'nope' }, to: { kind: 'bag' }, want: 'none' },
    { from: { kind: 'bag', id: 'no_such_gear' }, to: { kind: 'slot', slot: 'body' }, want: 'none' },
    { from: null, to: { kind: 'slot', slot: 'body' }, want: 'none' },
  ];
  // 独立写一遍期望(不调被测函数),避免「用被测实现给自己判分」
  const expectKind = s => {
    const from = s.from, to = s.to;
    if (!from || !to) return 'none';
    if (from.kind === 'bag') return GEAR[from.id] && to.kind === 'slot' && to.slot === GEAR[from.id].slot ? 'equip' : 'none';
    if (from.kind === 'slot') return ['head', 'body', 'hand', 'foot'].includes(from.slot) && to.kind === 'bag' ? 'unequip' : 'none';
    return 'none';
  };
  const got = SYN.map(s => gearDropAction(s.from, s.to).kind);
  const want = SYN.map(expectKind);
  const selfWant = SYN.map(s => s.want);
  t('样本表里的期望与独立算出来的一致(表本身没写歪)', JSON.stringify(want) === JSON.stringify(selfWant),
    selfWant.map((w, i) => `#${i} 表里=${w} 独立算=${want[i]}`).join('; '));
  t('落点判定的每一行样本都对', JSON.stringify(got) === JSON.stringify(want),
    got.map((g, i) => `#${i} 期望${want[i]} 实得${g}`).join('; '));
  t('样本表覆盖了 equip / unequip / none 三种结果', new Set(want).size === 3, [...new Set(want)].join(','));
  // 反向自检:把某一行的期望写反,比较必须报「不符」——
  // 否则上面那句可能因为比较写错而恒真,这道门禁等于没有
  const flipped = want.map((w, i) => (i === 0 ? (w === 'equip' ? 'unequip' : 'equip') : w));
  t('把第一行期望写反时确实判为不符(这张比较表不是空转)', flipped.join() !== got.join());

  const PH = [
    [{ moved: 0, held: false }, 'idle'],
    [{ moved: 3, held: false }, 'idle'],
    [{ moved: 9, held: false }, 'scroll'],
    [{ moved: 0, held: true }, 'drag'],
    [{ moved: 99, held: true }, 'drag'],
    [{}, 'idle'],
  ];
  const gotP = PH.map(([s]) => gearDragPhase(s));
  const wantP = PH.map(([, w]) => w);
  t('手势定级的每一行样本都对', JSON.stringify(gotP) === JSON.stringify(wantP),
    gotP.map((g, i) => `#${i} 期望${wantP[i]} 实得${g}`).join('; '));
  t('定级里出现过三种阶段(否则只验了一条分支)', new Set(gotP).size === 3, gotP.join(','));
  const flippedP = wantP.map((w, i) => (i === 2 ? (w === 'scroll' ? 'idle' : 'scroll') : w));
  t('把手势样本写反时确实判为不符', flippedP.join() !== gotP.join());
}

// ─────────────────────────────────────────────
console.log(`\ngear-ui-interaction-regression: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);