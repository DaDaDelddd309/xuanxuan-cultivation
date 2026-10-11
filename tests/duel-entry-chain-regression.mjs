// duel-entry-chain-regression.mjs —— 「局内 Boss → 回合制」**入口链**的门禁
//
// 为什么要单独一个文件:
//   tests/duel-session-latch-regression.mjs(XX-DUEL-004/005)是从 `Duel.start()`
//   往下跑的 —— 决斗内部(lose/win/busy/战败四选项)全绿,但**完全没走 toTurnBased()**。
//   于是下面这些至今只有代码、零实机证据:
//     · 水墨过场 wash('in') / wash('out') 与 #tb-wash 的 z-index 交接
//       (注释里记过一次 P0:墨盖满之后不退开,#tb-wash z-index:300 会一直压着
//        .xx-duel z-index:80 —— 回合制开了但立绘和战场全被墨挡着)
//     · engine.pause() / engine.resume() 的**配对**(engine.js:90/91 是计数器)
//     · inTurnBased 的完整生命周期(它一旦不复位,下一条 Boss 直接 early-return)
//     · 赢时把 boss 从 g.enemies / g.boss 摘掉
//     · Boss 血量继承(main.js 从 boss.hp / boss.hpMax 量出 hpRatio)
//
// ── 这条门禁怎么跑的(别误读结论)──────────────────────────────
//   §0 桩自检 / §1~§4 全部是**真跑**:
//     在 node 里用 DOM 桩 + 可控假时钟,把 js/main.js **原样 import 进来**
//     (Node 26 能解析 `./core/engine.js?v=17` 这种带 query 的相对说明符),
//     真的点「砍杀 → 选人」开一局,再走 Bus.emit('boss-spawn') 触发
//     main.js 里那条 setTimeout(→ toTurnBased),然后用真实的 Duel(不是桩)
//     打完一场。引擎 pause/resume、洗场类名、boss 摘除、血量比全是**实测值**。
//   §5 只有 `if (!Duel) { ... }` 那条分支是**静态断言**:Duel 是 main.js 的
//     const import,运行时没法让它变成假值。其余全部实跑。§5 的每一条都标注了。
//
// 出处可复现:node tests/duel-entry-chain-regression.mjs
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

// ————————————————————————————————————————————
// 断言器
// ————————————————————————————————————————————
let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};
const head = s => console.log(`\n=== ${s} ===`);

// ════════════════════════════════════════════
// §0 环境:假时钟 / DOM 桩 / 画布桩
//
// ⚠️ 这个桩自己出过错,而且错法很典型 —— 留在这里当反面教材:
//   第一版 el.removeChild 写成了空函数,于是 companion-broadcast.js:69
//   `while (el.children.length > MAX_LINES) el.removeChild(el.firstChild)`
//   **永远退不出**,第二个场景直接死循环。
//   「度量工具自己出错比没有度量工具更危险」:它会让人去改一段没坏的代码。
//   所以下面 §0 先跑一组**桩自检** —— 桩自己先证明自己像 DOM,后面的断言才有意义。
// ════════════════════════════════════════════
head('[0] 桩自检:门禁自己先证明自己像 DOM / 像时钟');

const timers = new Map();
let _tid = 0, NOW = 0;
globalThis.setTimeout = (fn, ms = 0) => { const id = ++_tid; timers.set(id, { fn, at: NOW + ms }); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
globalThis.performance = { now: () => NOW };
/** 把虚拟时钟往前推 ms,期间到期的定时器按到期先后依次跑掉 */
const advance = ms => {
  const until = NOW + ms;
  let guard = 0;
  for (;;) {
    if (++guard > 4000) throw new Error('advance 不收敛(定时器在原地自续)');
    let best = null, bid = null;
    for (const [id, x] of timers) if (x.at <= until && (!best || x.at < best.at)) { best = x; bid = id; }
    if (!best) break;
    timers.delete(bid); NOW = best.at; best.fn();
  }
  NOW = until;
};
/** 跑到没有定时器为止(分步推进,避免一步跨掉整段时长) */
const drain = label => {
  let guard = 0;
  while (timers.size) {
    if (++guard > 600) throw new Error(`假时钟不收敛(${label}):还有 ${timers.size} 个定时器在排队`);
    advance(30000);
  }
};

// —— 画布 2d 上下文(够 sprites.js 的 bake()/tint 和 engine._draw 跑通)——
function mkCtx(el) {
  const noop = () => {};
  const base = {
    canvas: el, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'top', imageSmoothingEnabled: false,
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop,
    lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    translate: noop, rotate: noop, scale: noop, transform: noop, setTransform: noop,
    drawImage: noop, fillText: noop, strokeText: noop, fillRect: noop, strokeRect: noop,
    clearRect: noop, putImageData: noop, setLineDash: noop, arcTo: noop, bezierCurveTo: noop,
    measureText: s => ({ width: String(s).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
  };
  return new Proxy(base, {
    get: (o, k) => (k in o ? o[k] : (typeof k === 'symbol' ? undefined : noop)),
    set: (o, k, v) => { o[k] = v; return true; },
  });
}

// —— DOM 桩 ——
//   ① 同一个 selector / id 必须永远返回**同一个**元素:
//      duel.js 的 paintHp 写到 #xd-epb、hurt 读到的必须是同一个对象。
//   ② createElement 建出来的节点要能被找到(选人卡片、战败四选项靠它)。
//   ③ innerHTML 只存字符串;要"点"里面的按钮/选项时从字符串里解析
//      (duel.js 就是 innerHTML 渲染 + querySelectorAll 挂 onclick)。
const REG = new Map();
const CREATED = [];
const reg = sel => { if (!REG.has(sel)) REG.set(sel, mkEl('div')); return REG.get(sel); };
/** 从 innerHTML 还原 data-art="x"(技能按钮) */
function parseArt(html) {
  const out = [], re = /data-art="([^"]+)"/g;
  let m;
  while ((m = re.exec(html || '')) !== null) { const b = mkEl('button'); b.dataset.art = m[1]; out.push(b); }
  return out;
}
/** 从 innerHTML 还原 data-c="x"(战败四选项)。
 *  ⚠️ 必须按 (宿主元素, html) 记忆化:真实 DOM 里 querySelectorAll 每次返回
 *  **同一批活节点**,duel.js 挂的 el.onclick 得是下一次还能找到的那个。
 *  我第一版每次现造新节点,结果点下去什么也不会发生 —— 门禁报了 4 条红,
 *  而实际产品代码没毛病。 */
function parseChio(host) {
  const html = host.innerHTML;
  if (!host._chioCache || host._chioCache.html !== html) {
    const out = [], re = /data-c="([^"]+)"/g;
    let m;
    while ((m = re.exec(html || '')) !== null) { const b = mkEl('div'); b.dataset.c = m[1]; b.onclick = null; out.push(b); }
    host._chioCache = { html, nodes: out };
  }
  return host._chioCache.nodes;
}
function mkEl(tag) {
  const el = {
    tagName: tag, style: {}, dataset: {}, _cls: new Set(), _h: {}, _html: '', _tc: '',
    _kids: [], _attr: {}, onclick: null, offsetWidth: 1, offsetHeight: 1,
    hidden: false, width: 800, height: 600, type: '', checked: false, scrollTop: 0,
    classList: {
      add: (...c) => c.forEach(x => el._cls.add(x)),
      remove: (...c) => c.forEach(x => el._cls.delete(x)),
      contains: c => el._cls.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !el._cls.has(c) : !!on;
        want ? el._cls.add(c) : el._cls.delete(c);
        return want;
      },
    },
    get className() { return [...el._cls].join(' '); },
    set className(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = String(v); },
    get textContent() { return el._tc; },
    set textContent(v) { el._tc = String(v); },
    get children() { return el._kids; },
    get childNodes() { return el._kids; },
    get firstChild() { return el._kids[0] || null; },
    get lastChild() { return el._kids[el._kids.length - 1] || null; },
    get parentNode() { return null; },
    appendChild(c) { el._kids.push(c); return c; },
    append(...c) { el._kids.push(...c); },
    // ⚠️ removeChild 必须是真删 —— 见本节开头的反面教材。
    removeChild(c) { const i = el._kids.indexOf(c); if (i >= 0) el._kids.splice(i, 1); return c; },
    insertBefore(c) { return c; }, replaceWith() {}, remove() {}, cloneNode() { return mkEl(tag); },
    addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
    removeEventListener() {}, setAttribute(k, v) { el._attr[k] = String(v); },
    getAttribute(k) { return el._attr[k] === undefined ? null : el._attr[k]; },
    removeAttribute(k) { delete el._attr[k]; }, hasAttribute(k) { return el._attr[k] !== undefined; },
    contains() { return false; }, closest() { return null; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }),
    querySelector: sel => reg(sel),
    querySelectorAll(sel) {
      if (sel === '.xx-chio') return parseChio(el);
      if (sel === '[data-art]' || sel === 'button') return parseArt(el._html);
      return [];
    },
    getContext: () => mkCtx(el),
  };
  CREATED.push(el);
  return el;
}
globalThis.document = {
  readyState: 'complete', hidden: false, title: '',
  addEventListener() {}, removeEventListener() {},
  createElement: tag => mkEl(tag),
  createDocumentFragment: () => mkEl('fragment'),
  body: reg('body'),
  getElementById: id => reg('#' + id),
  querySelector: sel => reg(sel),
  querySelectorAll: () => [],
};
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
};
globalThis.location = { search: '', protocol: 'file:', href: 'file:///' };
Object.defineProperty(globalThis, 'navigator',
  { value: { userAgent: 'node' }, configurable: true, writable: true });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
globalThis.sessionStorage = globalThis.localStorage;
// rAF 不接:引擎主循环自己会递归 rAF,一接上就停不下来。决斗链路走 setTimeout,不受影响。
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };

// 产品日志收进数组(异常路径的 console.warn 是断言材料,不该刷屏)
const LOGS = [];
globalThis.console.warn = (...a) => LOGS.push(a.map(String).join(' '));
globalThis.console.error = (...a) => LOGS.push('ERR ' + a.map(String).join(' '));

{
  const probe = mkEl('div');
  const kid = mkEl('span');
  probe.appendChild(kid);
  probe.appendChild(mkEl('i'));
  probe.removeChild(kid);
  t('DOM 桩:appendChild/removeChild 真的会增删 children',
    probe.children.length === 1 && probe.children[0] !== kid,
    `children=${probe.children.length} —— removeChild 空实现会让 while(el.children.length>N) 死循环`);
  // getElementById 与 querySelector 必须落在**同一份**注册表上:
  // duel.js 有一处用 querySelector('#xd-sk') 挂监听、另一处用别的方式取同一个节点,
  // 两者不是同一个对象的话,门禁点下去什么也不会发生(我第一版踩过)。
  t('DOM 桩:同一节点在 querySelector / getElementById 下是同一个对象',
    reg('#xd-sk') === reg('#xd-sk') && reg('#xd-sk') === document.getElementById('xd-sk'));
  let order = [];
  setTimeout(() => order.push('a'), 30);
  setTimeout(() => order.push('b'), 10);
  const killed = setTimeout(() => order.push('不该出现'), 20);
  clearTimeout(killed);
  drain('桩自检');
  t('假时钟:按到期顺序执行且响应 clearTimeout',
    order.join('') === 'ba', `实际 ${JSON.stringify(order)}`);
  const logBefore = LOGS.length;
  console.warn('桩自检探针');
  t('产品日志收进 LOGS(异常路径的 [turn-based] 断言材料)',
    LOGS.length === logBefore + 1 && LOGS[logBefore].includes('桩自检探针'),
    `LOGS 长度 ${LOGS.length} —— 收不到日志,§4 那条 [turn-based] 断言就是恒真的`);
  LOGS.length = logBefore;
}

// ════════════════════════════════════════════
// 场景脚手架:开一局真实 main.js
// ════════════════════════════════════════════
const { Bus } = await import(ROOT + '/js/core/engine.js?v=17');
const { Duel } = await import(ROOT + '/js/xiuxian/duel.js');
const { Screens } = await import(ROOT + '/js/ui/screens.js?v=17');
const { codeMask } = await import('./lib-uimod.mjs');

const STARTS = [];                       // 每次 Duel.start 的实收参数
let SHOWRESULT = null;                   // 结算屏实收参数
const realDuelStart = Duel.start.bind(Duel);
Duel.start = cfg => { STARTS.push({ cfg, t: NOW }); return realDuelStart(cfg); };
const realShowResult = Screens.showResult.bind(Screens);
Screens.showResult = (a, b) => {
  SHOWRESULT = { stats: a, defeat: b && b.defeat, victory: b && b.victory };
  return realShowResult(a, b);
};

let ENGINE = null, PAUSE_N = 0, RESUME_N = 0;

/**
 * 开一个新会话(等价于玩家刷新一次页面:全新 main.js 模块实例 + 全新 DOM + 全新时钟)。
 * @param {number} n 会话序号(当 cache-buster 用)
 */
async function boot(n) {
  // screens.js 的 bindTap 防连点是**模块级 WeakMap**,跨会话共享;
  // 不把虚拟时钟推过 300ms 就会把第二次点击静默吞掉(实测踩过)。
  advance(1000);
  const before = new Map([...Bus.map].map(([k, v]) => [k, v.length]));
  await import(ROOT + `/js/main.js?duel-entry-gate=${n}`);
  // 掐掉上一会话留在 Bus 上的监听:否则一次 emit 会同时驱动两局的 toTurnBased。
  for (const [k, v] of Bus.map) { const k0 = before.get(k) || 0; if (v.length > k0) v.splice(0, k0); }

  ENGINE = globalThis.window.__g;
  const P = ENGINE.pause.bind(ENGINE), R = ENGINE.resume.bind(ENGINE);
  ENGINE.pause = () => { PAUSE_N++; return P(); };
  ENGINE.resume = () => { RESUME_N++; return R(); };

  const mark = CREATED.length;
  reg('#btn-play').onclick();                                  // 主菜单 →「砍杀」
  const card = CREATED.slice(mark).find(e => e.tagName === 'button' && /char-card/.test(e.className) && e.onclick);
  if (!card) throw new Error('没找到选人卡片 —— 桩与 screens.js 脱节了');
  card.onclick();                                              // 选人 → 开局
  drain('开局');
  if (!ENGINE.player) throw new Error('startRun 没跑起来(engine.player 仍是 null)');
  PAUSE_N = 0; RESUME_N = 0;                                   // 开局自带一次 resume,从零开始数
}

/** 往场上放一条局内 boss(结构对齐 game/boss.js 产出的对象) */
const putBoss = (o = {}) => {
  const b = Object.assign({ type: 'boss_golem', name: '石像守卫', hp: 40, hpMax: 100, x: 60, y: 60, boss: true, elite: false, r: 20, dead: false }, o);
  ENGINE.enemies.push(b);
  ENGINE.boss = b;
  return b;
};
/** 点一个技能按钮:走 duel.js 注册的那个真实监听器,不绕过点击闸门 */
function clickArt(id) {
  const sk = reg('#xd-sk');
  const b = parseArt(sk.innerHTML).find(x => x.dataset.art === id);
  if (!b) return false;
  const ev = { target: { closest: s => (s === '[data-art]' ? b : null) } };
  (sk._h.click || []).forEach(fn => fn(ev));
  return true;
}
const ink = () => [...reg('#tb-wash')._cls];
const inkIn = () => ink().includes('in');
const inkOut = () => ink().includes('out') && !ink().includes('in');

/** 场景跑挂了要变成一条红,而不是一段栈 —— 桩出错不能被读成"产品有问题/没问题" */
const scenario = async (name, fn) => {
  try { await fn(); }
  catch (err) { fail++; console.log(`  ❌ 场景「${name}」没能跑完 —— ${err && err.message}`); }
};

// ════════════════════════════════════════════
// §1 入口:Boss 出场 → 墨盖满 → 暂停 → Duel.start(带血量)→ 墨退开
// ════════════════════════════════════════════
head('[1] 实跑:入口链 —— 墨盖满 / 暂停 / 血量继承 / 墨退开 / 重入守卫');
await scenario('入口链', async () => {
  await boot(1);
  const boss = putBoss();
  const n0 = STARTS.length;

  Bus.emit('boss-spawn', { name: boss.name });
  advance(699);
  t('Boss 出场后 700ms 内不打开决斗层(先让墨盖满)',
    STARTS.length === n0 && ENGINE.paused === 0,
    `starts 增量 ${STARTS.length - n0},paused ${ENGINE.paused}`);

  advance(1);                                    // setTimeout(700) → toTurnBased 入口
  t('过场墨盖上:#tb-wash 进入 in', inkIn() && !inkOut(), `类名 ${JSON.stringify(ink())}`);
  t('过场字幕写的是这条 Boss 的名字', reg('#tb-cap').textContent === boss.name,
    `实际 "${reg('#tb-cap').textContent}"`);
  t('进入回合制前先暂停局内(engine.paused 0→1)',
    ENGINE.paused === 1 && PAUSE_N === 1, `paused=${ENGINE.paused} pause 调用 ${PAUSE_N} 次`);

  advance(519);
  t('墨盖满的 520ms 内决斗层还没开', STARTS.length === n0);
  advance(1);                                    // wash('in') 返回 520 → Duel.start
  const cfg = STARTS.length > n0 ? STARTS[STARTS.length - 1].cfg : null;
  t('Duel.start 被真实调用', !!cfg);
  t('【血量继承】hpRatio = 局内 boss 的 hp / hpMax',
    cfg && Math.abs(cfg.hpRatio - boss.hp / boss.hpMax) < 1e-9,
    `boss ${boss.hp}/${boss.hpMax} → hpRatio ${cfg && cfg.hpRatio}`);
  t('对手身份跟这条 boss 走(不是写死的某个反派)',
    cfg && cfg.foe.name === boss.name && cfg.foe.key === boss.type,
    `foe=${cfg && JSON.stringify({ name: cfg.foe.name, key: cfg.foe.key })}`);
  t('决斗层开起来的那一刻墨还盖着(#tb-wash 仍 in)',
    inkIn(), `类名 ${JSON.stringify(ink())} —— 墨提前退开等于白做过场`);
  t('决斗进行中局内保持暂停', ENGINE.paused === 1, `paused=${ENGINE.paused}`);

  advance(700);                                  // main.js 里 700ms 后 wash('out')
  t('【过场交接】决斗层开着的时候墨必须退开',
    inkOut() && !!Duel.S,
    `类名 ${JSON.stringify(ink())},Duel.S=${Duel.S ? '有' : 'null'} —— 墨不退开就是 z-index:300 压着 z-index:80`);

  // 重入守卫:决斗还开着的时候又来一条 boss
  const nBefore = STARTS.length, pBefore = ENGINE.paused;
  putBoss({ name: '第二条', hp: 100, hpMax: 100 });
  Bus.emit('boss-spawn', { name: '第二条' });
  drain('重入守卫');
  t('决斗进行中再触发 Boss 不会开第二场(inTurnBased 守卫)',
    STARTS.length === nBefore, `Duel.start 又被调了 ${STARTS.length - nBefore} 次`);
  t('重入触发不会再叠一次暂停', ENGINE.paused === pBefore,
    `paused ${pBefore} → ${ENGINE.paused}`);
});

// ════════════════════════════════════════════
// §2 赢:boss 摘除 / 暂停配对 / inTurnBased 释放
// ════════════════════════════════════════════
head('[2] 实跑:赢 —— boss 摘除 + pause/resume 配对 + inTurnBased 释放');
await scenario('赢', async () => {
  await boot(2);
  const boss = putBoss();
  Bus.emit('boss-spawn', { name: boss.name });
  drain('开场');
  t('真的打起来了(决斗层开着、技能栏有按钮)',
    !!Duel.S && parseArt(reg('#xd-sk').innerHTML).length > 0,
    '没渲染技能 = 后面全是空测');

  const art = Object.keys(Duel.S.hero.arts)[0];
  Duel.S.e.hp = 1;                               // 一下带走
  clickArt(art);
  drain('终局');
  // ⚠️ 这里必须断言 Duel.S 真的被收起来了 —— 我第一版写的是
  //   `t('赢了', !!Duel.S === false || true)`,那个表达式恒为 true,
  //   是一条自己给自己发绿牌的假断言。判据只能是决斗状态机的真实收尾。
  t('赢:决斗层真的收起来了(Duel.S 归位、root 隐藏)',
    Duel.S === null && Duel.root.classList.contains('hidden'),
    `S=${Duel.S === null ? 'null' : '还在'} hidden=${Duel.root.classList.contains('hidden')}`);
  t('赢:boss 从 g.enemies 摘掉', !ENGINE.enemies.includes(boss),
    `还在场上:${ENGINE.enemies.indexOf(boss) >= 0}`);
  t('赢:g.boss 置 null', ENGINE.boss === null, `g.boss=${ENGINE.boss && ENGINE.boss.name}`);
  t('赢:pause 与 resume 成对(各 1 次)',
    PAUSE_N === 1 && RESUME_N === 1, `pause=${PAUSE_N} resume=${RESUME_N}`);
  t('赢:局内恢复运行(没有留下暂停)', ENGINE.paused === 0, `paused=${ENGINE.paused}`);
  t('赢:墨也退开了', inkOut(), `类名 ${JSON.stringify(ink())}`);

  // inTurnBased 释放探针:同一个会话里再来一条 boss,必须还能进
  const n0 = STARTS.length;
  const boss2 = putBoss({ name: '无常尊者', hp: 100, hpMax: 100 });
  Bus.emit('boss-spawn', { name: boss2.name });
  drain('第二场');
  t('赢之后下一条 Boss 还能进回合制(inTurnBased 已复位)',
    STARTS.length === n0 + 1, `Duel.start 增量 ${STARTS.length - n0} —— inTurnBased 卡住就是这条永远 early-return`);
  t('第二场也带着血量比进来',
    STARTS[STARTS.length - 1].cfg.hpRatio === 1, `hpRatio=${STARTS[STARTS.length - 1].cfg.hpRatio}`);
});

// ════════════════════════════════════════════
// §3 败北:战败四选项 → 死亡结算 → 暂停没有漏 → 再来一局还能进
// ════════════════════════════════════════════
head('[3] 实跑:败北 —— onLose 有活 + 死亡结算落地 + 暂停不漏 + 闩释放');
await scenario('败北', async () => {
  await boot(3);
  const boss = putBoss();
  Bus.emit('boss-spawn', { name: boss.name });
  drain('开场');

  Duel.S.hero.hp = 1;                            // 挨一下就死
  clickArt(Object.keys(Duel.S.hero.arts)[0]);
  drain('终局');
  const opts = parseChio(reg('#xd-defeat'));
  t('战败面板真的渲染出四个选项',
    opts.length === 4, `实际 ${opts.length} 个 —— 没渲染出来说明根本没走到 lose(),后面全是空测`);

  // 致命伤害落下时,决斗的暂停必须**已经**被解除
  let pausedAtDeath = null;
  const realTd = ENGINE.player.takeDamage.bind(ENGINE.player);
  ENGINE.player.takeDamage = d => { if (d >= 999999) pausedAtDeath = ENGINE.paused; return realTd(d); };

  const target = opts[0];
  t('点战败选项会真的调 onLose(不是空函数)',
    typeof target.onclick === 'function',
    'onLose 是空壳 → 点了等于没点,局卡在暂停里出不来');
  target.onclick();
  drain('战败结算');
  t('【败北出口】致命伤害落下时局内已经解除暂停',
    pausedAtDeath === 0, `takeDamage 时 paused=${pausedAtDeath} —— 决斗那次 pause 没还,整局永久停摆`);
  t('玩家确实死了(这一局真的结束了,不是卡着)',
    ENGINE.player.hp <= 0, `hp=${ENGINE.player.hp}`);
  t('败北后落在结算屏的那一次暂停上,没有多出一次',
    ENGINE.paused === 1, `paused=${ENGINE.paused} —— 等于 2 就是决斗那次 pause 没还`);
  t('pause / resume 成对', PAUSE_N === 2 && RESUME_N === 1,
    `pause=${PAUSE_N}(入口 + 结算屏) resume=${RESUME_N}`);
  t('结算屏拿到了玩家选的那条战败路',
    SHOWRESULT && SHOWRESULT.defeat === target.dataset.c,
    `结算屏收到 ${JSON.stringify(SHOWRESULT && SHOWRESULT.defeat)}`);
  t('墨也退开了', inkOut(), `类名 ${JSON.stringify(ink())}`);

  // 再来一局 → 新 boss 必须还能进回合制(inTurnBased 已复位的唯一实跑证据)
  advance(1000);
  reg('#btn-again').onclick();
  advance(1000);
  drain('再来一局');
  t('「再来一局」能开出新的一局', !!ENGINE.player && ENGINE.paused === 0,
    `player=${!!ENGINE.player} paused=${ENGINE.paused}`);
  const n0 = STARTS.length;
  putBoss({ name: '第二局Boss', hp: 20, hpMax: 80 });
  Bus.emit('boss-spawn', { name: '第二局Boss' });
  drain('第二局 boss');
  t('败北之后下一条 Boss 还能进回合制(inTurnBased 已复位)',
    STARTS.length === n0 + 1, `Duel.start 增量 ${STARTS.length - n0}`);
  t('第二局也带着血量比进来',
    STARTS[STARTS.length - 1].cfg.hpRatio === 0.25,
    `hpRatio=${STARTS[STARTS.length - 1].cfg.hpRatio}(期望 20/80=0.25)`);
});

// ════════════════════════════════════════════
// §4 异常:Duel.start 抛异常 → 不能留下软锁
// ════════════════════════════════════════════
head('[4] 实跑:异常路径 —— Duel.start 抛异常不许软锁');
await scenario('异常', async () => {
  await boot(4);
  const realStart = Duel.start;
  Duel.start = () => { throw new Error('注入:Duel.start 炸了'); };
  putBoss({ name: '会炸的Boss', hp: 10, hpMax: 10 });
  const logMark = LOGS.length;
  Bus.emit('boss-spawn', { name: '会炸的Boss' });
  let escaped = null;
  try { drain('异常路径'); } catch (err) { escaped = err && err.message; }
  t('Duel.start 抛出的异常没有逃出定时器回调',
    escaped === null, `逃出了:${escaped} —— 会把整个主循环的调用栈掀掉`);
  t('异常走了 [turn-based] 的兜底(而不是被吞掉)',
    LOGS.slice(logMark).some(x => x.includes('[turn-based]')),
    `日志:${JSON.stringify(LOGS.slice(logMark))}`);
  t('异常路径解除了暂停(不软锁)',
    ENGINE.paused === 0, `paused=${ENGINE.paused}`);
  t('异常路径 pause/resume 成对', PAUSE_N === 1 && RESUME_N === 1,
    `pause=${PAUSE_N} resume=${RESUME_N}`);

  Duel.start = realStart;
  const n0 = STARTS.length;
  putBoss({ name: '异常后的Boss', hp: 50, hpMax: 100 });
  Bus.emit('boss-spawn', { name: '异常后的Boss' });
  drain('异常后的 boss');
  t('异常之后下一条 Boss 还能进回合制(inTurnBased 已复位)',
    STARTS.length === n0 + 1, `Duel.start 增量 ${STARTS.length - n0}`);
});

// ════════════════════════════════════════════
// §5 静态断言(只有这一节不是实跑)
//
// ⚠️ 静态断言,**不是实跑**。它只覆盖运行时够不到的那条分支:
//    `if (!Duel) { inTurnBased = false; engine.resume(); return; }`
//    —— Duel 是 main.js 的 const import,没法在运行时变成假值。
// 提取方式与 tests/lib-uimod.mjs 的 methodBody 同构:codeMask() 剥注释/字符串,
//  再按花括号配对取实现体。**不硬编码行号** —— 行号一漂,断言就变成恒真的假绿。
// ════════════════════════════════════════════
head('[5] 静态断言(仅覆盖运行时够不到的 `!Duel` 分支)');
const MAIN_SRC = R('js/main.js');
const MAIN_CODE = codeMask(MAIN_SRC).code;

/** 从 main.js 真实源码里按花括号配对取函数实现体。取不到就抛 —— 绝不返回一段垃圾 */
function funcBody(name, src = MAIN_CODE, raw = MAIN_SRC) {
  const re = new RegExp('^[ \\t]*function\\s+' + name + '\\b(?=\\s*\\()', 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`funcBody('${name}'): main.js 里找不到这个函数`);
  let i = m.index + m[0].length, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '{') throw new Error(`funcBody('${name}'): 参数表后不是 {`);
  let d = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error(`funcBody('${name}'): 花括号没配平,源码可能坏了`);
  return raw.slice(m.index, end);
}

let toTurnBased = '', fromTurnBased = '', washBody = '';
try {
  toTurnBased = funcBody('toTurnBased');
  fromTurnBased = funcBody('fromTurnBased');
  washBody = funcBody('wash');
  t('提取自检:三个实现体都从 main.js 真实源码里取到了(且不是空壳)',
    toTurnBased.length > 1200 && fromTurnBased.length > 200 && washBody.length > 200,
    `长度 toTurnBased=${toTurnBased.length} fromTurnBased=${fromTurnBased.length} wash=${washBody.length}`);
  t('提取自检:取到的确实是这三个函数本身',
    /^function toTurnBased\(/.test(toTurnBased) && /^function fromTurnBased\(/.test(fromTurnBased) && /^function wash\(/.test(washBody));
} catch (err) {
  fail++; console.log(`  ❌ 源码提取失败 —— ${err && err.message}`);
}

if (toTurnBased) {
  // `!Duel` 分支:两件事必须写在**同一条语句**里,否则就是空过场
  const noDuel = /if\s*\(\s*!\s*Duel\s*\)\s*\{[^}]*inTurnBased\s*=\s*false[^}]*engine\.resume\s*\(\s*\)[^}]*\}/.test(toTurnBased)
    || /if\s*\(\s*!\s*Duel\s*\)\s*\{\s*inTurnBased\s*=\s*false\s*;\s*engine\.resume\s*\(\s*\)\s*;\s*return\s*;\s*\}/.test(toTurnBased);
  t('[静态] `!Duel` 分支同一句里既解除 inTurnBased 又 engine.resume()',
    noDuel,
    'Duel 万一不存在,入口就既卡住后续 Boss(inTurnBased)又卡住整局(paused +1)');
  // 负控制:证明上面那条正则不是恒真的
  t('[静态] 负控制 —— 同一条模式在 wash() 里匹配不到(正则不是恒真)',
    !/if\s*\(\s*!\s*Duel\s*\)/.test(washBody));
}
if (fromTurnBased) {
  t('[静态] 出口 fromTurnBased 会复位 inTurnBased 并 engine.resume()',
    /inTurnBased\s*=\s*false/.test(fromTurnBased) && /engine\.resume\s*\(\s*\)/.test(fromTurnBased),
    '出口不复位 = 每条 Boss 都 early-return + 整局暂停');
  t('[静态] 出口先复位再交还局内(顺序反了会留一拍软锁)',
    fromTurnBased.indexOf('inTurnBased = false') < fromTurnBased.indexOf('engine.resume()'),
    '当前顺序:' + fromTurnBased.replace(/\s+/g, ' ').slice(0, 120));
}

// z-index:CSS 不执行,只能静态读 —— 但「墨盖得住决斗层」正是退开成为 P0 的原因
{
  const washCss = R('css/wash.css') + R('css/xiuxian.css');
  const washZ = Number((/#tb-wash\s*\{[^}]*z-index\s*:\s*(\d+)/.exec(washCss) || [])[1]);
  const duelZ = Number((/\.xx-duel\s*\{[^}]*z-index\s*:\s*(\d+)/.exec(washCss) || [])[1]);
  t('[静态] #tb-wash 与 .xx-duel 的 z-index 都读得到', washZ > 0 && duelZ > 0,
    `读出来 wash=${washZ} duel=${duelZ} —— 读不到就是选择器/写法变了,这条断言已经失效`);
  t('[静态] 墨层确实盖在决斗层之上(所以"退开"是承重动作,不是装饰)',
    washZ > duelZ, `#tb-wash=${washZ} / .xx-duel=${duelZ}`);
}

// ════════════════════════════════════════════
if (fail === 0) {
  console.log(`\n✅ 入口链通过:${pass} 项 —— 墨盖/墨退、pause↔resume 配对、inTurnBased 生命周期、boss 摘除、血量继承、异常自愈都跑到了`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标(共 ${pass + fail} 项) —— 打到 Boss 的入口链上还有洞`);
  process.exit(1);
}
