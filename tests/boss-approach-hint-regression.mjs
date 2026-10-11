// boss-approach-hint-regression.mjs —— 「前方有强敌」预警行的门禁
//
// 病:**没有任何 UI 告诉玩家 Boss 在第 300 秒**。
//   实测(同事实测,可信):Boss 在 300s(boss.js 的 BOSS_DESIGNS.boss_golem.startTime),
//   600s 是最终 Boss。用调试钩子跳到 299s 再走一秒,Boss 真刷出来了
//   (石像守卫 / hp 24000)—— 但同期 330 秒墙钟只走了 16 秒游戏时间
//   (无头环境里 rAF 被节流,这是环境限制,不是被测结论)。
//   结论只有一条:**多数玩家活不到 300 秒**,于是 v099p 精心做的
//   「水墨过场 + 血量继承」实际曝光率接近零。
//   第 240 秒给一行提示,这件事有没有人做,决定那个系统有没有意义。
//
// 本门禁盯的是**玩家眼睛看到的东西**,不是「代码里有没有这个常量」:
//   真跑 HUD.update(),逐帧喂时间,数那行字在 DOM 里**亮了几次**。
//   把 hud.js 里那几行删掉,本门禁必红;把 setTimeout 删掉改成每帧重画,必红。
//
// 三条硬判据(任务书原文):
//   ① 提示恰好出现一次(不是每帧刷)
//   ② 240 秒前不出现
//   ③ 提示走的是 UI,不是 console.log
// 另加两条「不许动平衡」的守栏,见 [4]。
//
// ⚠️ 为什么 ② 写成「240」而不是「BOSS_HINT_AT」:任务书钉的是 240 这个数,
//   所以门禁独立复算一遍 `BOSS_DESIGNS.boss_golem.startTime - 60`,
//   两边一致才算数 —— 门禁自己不复算,就等于把实现里的常量抄了一遍,
//   实现改错了门禁也跟着错。
//
// 出处可复现:node tests/boss-approach-hint-regression.mjs
// 退出码:0 = 通过;1 = 不通过;2 = **门禁自身失效**(自检不过,见 [5])
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

// ————————————————————————————————————————————————————————————
// 可控假时钟。必须响应 clearTimeout:
//   hud.js 的 _hideBossHint 无条件 clearTimeout(上一局的收摊定时器
//   不能打在新一局头上)。假时钟不响应 clearTimeout,这个行为就测不出来,
//   而且测的是一个不存在的世界。
// ————————————————————————————————————————————————————————————
const timers = new Map();
let _tid = 0, _now = 0;
globalThis.setTimeout = (fn, ms = 0) => { const id = ++_tid; timers.set(id, { fn, at: _now + (ms || 0) }); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
const advance = ms => { _now += ms; for (const [id, task] of [...timers]) if (task.at <= _now) { timers.delete(id); task.fn(); } };
const resetClock = () => { timers.clear(); _now = 0; };

// ————————————————————————————————————————————————————————————
// DOM 桩(同 duel-* 那套同款实现)
// ⚠️ 节点必须**缓存**:`document.getElementById(id)` 每帧都返回**同一批活节点**。
//   否则 HUD.init() 挂上去的节点和 update() 读的不是同一个对象,
//   「提示出现了没有」这条断言会永远为假 —— 报出来的红全是假的。
// ————————————————————————————————————————————————————————————
const NODES = new Map();
function mkEl(tag = 'div') {
  const el = {
    tagName: tag, id: '', className: '', _cls: new Set(),
    style: { cssText: '', setProperty() {} }, dataset: {},
    _html: '', textContent: '', offsetWidth: 1, _kids: [], _handlers: {},
    classList: {
      add: (...c) => c.forEach(x => el._cls.add(x)),
      remove: (...c) => c.forEach(x => el._cls.delete(x)),
      contains: c => el._cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !el._cls.has(c) : !!on; v ? el._cls.add(c) : el._cls.delete(c); return v; },
    },
    get className() { return el._cls.size ? [...el._cls].join(' ') : ''; },
    set className(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = String(v); el._kids.length = 0; },
    appendChild(c) { el._kids.push(c); return c; },
    append(...c) { el._kids.push(...c); },
    removeChild(c) { const i = el._kids.indexOf(c); if (i >= 0) el._kids.splice(i, 1); return c; },
    addEventListener(ev, fn) { (el._handlers[ev] = el._handlers[ev] || []).push(fn); },
    removeEventListener() {},
    getContext: () => ({ save() {}, restore() {}, scale() {}, drawImage() {}, imageSmoothingEnabled: false }),
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    querySelector: sel => getNode(sel),
    querySelectorAll: () => [],
  };
  return el;
}
const getNode = key => { if (!NODES.has(key)) NODES.set(key, mkEl()); return NODES.get(key); };
const resetDom = () => { NODES.clear(); };

globalThis.document = {
  getElementById: id => getNode('id:' + id),
  querySelector: sel => getNode('sel:' + sel),
  querySelectorAll: () => [],
  createElement: t => mkEl(t),
  addEventListener() {}, removeEventListener() {},
  body: mkEl('body'), hidden: false,
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 400, devicePixelRatio: 2 };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

// ————————————————————————————————————————————————————————————
// 断言器
// ————————————————————————————————————————————————————————————
let pass = 0, fail = 0; const RED = [], SELF_FAIL = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; RED.push(n); console.log(`  ❌ ${n}${d ? '\n       — ' + d : ''}`); }
};
/** 度量工具本身出问题 ⇒ 这轮结果不可信,必须 exit 2 而不是 exit 1 */
const tf = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; SELF_FAIL.push(n); console.log(`  🛑 ${n}${d ? '\n       — ' + d : ''}`); }
};

const { HUD } = await import('../js/ui/hud.js?r=8');   // 戳与 js/main.js 一致(模块身份别分裂)
const { BOSS_DESIGNS } = await import('../js/game/boss.js?v=17');

// 门禁独立复算的「预警时刻」,不抄实现里的常量
const HINT_AT = BOSS_DESIGNS.boss_golem.startTime - 60;

/** 一个够 HUD.update() 用的假引擎 */
const mkG = () => ({
  time: 0, paused: false, boss: null,
  stats: { kills: 0, gold: 0 },
  player: {
    hp: 100, xpRatio: () => 0.4, level: 1, charId: 'sword',
    weapons: [], dashCd: () => 0,
    stats: { maxHp: 100, cdMult: 1, might: 1, armor: 1, speed: 1, areaMult: 1, xpMult: 1, goldMult: 1, magnet: 60 },
  },
});

const hintEl = () => HUD._bossHintEl;
const visible = () => { const el = hintEl(); return !!(el && !el.classList.contains('hidden')); };

/**
 * 在预警节点上装一个「取消隐藏」的计数器。
 *
 * ⚠️ 为什么不能只数**可见性跳变**:那样「每帧重画」和「一次性点亮后一直亮着」
 *   会被数成同一个结果(都是 1 次跳变)—— 实测踩过:把一次性闩整个删掉,
 *   预警变成一条从 240 秒糊到结算的常驻横幅,「亮了恰好 1 次」那条照样绿。
 *   常驻横幅就是本条判据要禁的东西。数**取消隐藏的次数**才是直接的。
 */
function armUnhideCounter(el) {
  let n = 0;
  const orig = el.classList.remove.bind(el.classList);
  el.classList.remove = (...c) => { if (c.includes('hidden')) n++; return orig(...c); };
  return () => n;
}

/**
 * 逐帧驱动真 HUD.update(),返回「那行字亮起来过几次」。
 * console.log 在**驱动期间**被换成收集器 —— 判据 ③ 要的就是这个证据。
 */
function drive(g, from, to, step) {
  const realLog = console.log;
  const logged = [];
  console.log = (...a) => { logged.push(a.map(String).join(' ')); };
  let appears = 0, wasVisible = false, firstAt = null, frames = 0;
  const unhides = armUnhideCounter(hintEl());
  try {
    for (let t0 = from; t0 <= to; t0 += step) {
      g.time = t0;
      HUD.update();          // 真代码路径,不是抄公式
      advance(step * 1000);  // 假时钟跟着推进,收摊定时器才会在正确的时刻触发
      frames++;
      const vis = visible();
      if (vis && !wasVisible) { appears++; if (firstAt === null) firstAt = t0; }
      wasVisible = vis;
    }
  } finally { console.log = realLog; }
  return { appears, firstAt, frames, logged, unhides: unhides() };
}

console.log('\n=== [1] 预警节点是真的 UI:挂在 #hud 下、有可见文字 ===');
let g = mkG();
resetClock(); resetDom();
HUD.init(g);
HUD.show(true);
{
  const el = hintEl();
  tf('HUD.init() 建出了预警节点(不是 log,是一个真 DOM 元素)', !!el && !!el.tagName,
    'HUD._bossHintEl 为空 —— 没有这个节点,后面三条判据全部无从谈起');
  const parent = NODES.get('id:hud');
  tf('预警节点真的挂在 #hud 里(玩家看得见的位置)',
    !!el && !!parent && parent._kids.includes(el),
    '节点没进 #hud 的子节点表 —— 它不是玩家能看到的东西');
  t('预警节点有一行玩家能读的字', !!el && String(el.textContent || '').trim().length > 0,
    'textContent 是空的');
  t('预警节点初始是隐藏的(不是常驻横幅)', !!el && !visible(),
    '一开局就亮着 —— 那不叫预警,那叫常驻噪音');
  t('预警行文里带得上「强敌」两个字', /强敌/.test(String(el && el.textContent || '')),
    `实读:${JSON.stringify(String(el && el.textContent || ''))}`);
}

console.log('\n=== [2] 240 秒前不出现(逐帧,不是抽查) ===');
{
  const pre = drive(g, 0, HINT_AT - 1, 1);
  t(`${HINT_AT - 1} 秒之前逐秒走完 ${pre.frames} 帧,预警一次都没亮`,
    pre.appears === 0, `提前亮了 ${pre.appears} 次`);
  t('预警时刻复算一致(BOSS_DESIGNS.startTime 300 − 60 = 240)', HINT_AT === 240,
    `复算出来是 ${HINT_AT}s,BOSS_DESIGNS.boss_golem.startTime=${BOSS_DESIGNS.boss_golem.startTime}`);
}

console.log('\n=== [3] 恰好出现一次 —— 从 0 秒一路跑到最终 Boss(599s)===');
let run;
{
  HUD.show(true);            // 换新一局
  run = drive(g, 0, 599, 1);
  t(`整局 ${run.frames} 帧里,预警亮了恰好 1 次(不是每帧刷)`,
    run.appears === 1, `亮了 ${run.appears} 次`);
  t('整局只有一次「点亮」动作(360 帧里取消隐藏恰好被调 1 次)',
    run.unhides === 1, `取消隐藏被调了 ${run.unhides} 次 —— 每帧都在重画`);
  t('第一次亮在 240 秒(不早也不晚)',
    run.firstAt === HINT_AT, `第一次亮在 ${run.firstAt}s`);
  t('它自己会收走(到点给一句话,不是糊一整局)',
    run.appears === 1 && !visible(), `599s 时它还亮着`);
}

console.log('\n=== [4] 走的是 UI 不是 console.log ===');
{
  const text = String(hintEl().textContent || '').trim();
  const logged = run.logged.filter(l => l.includes(text) || l.includes('强敌'));
  t('整局驱动下来,没有任何一行 console.log 提到这行提示',
    logged.length === 0, `log 里出现了 ${logged.length} 次:${JSON.stringify(logged.slice(0, 3))}`);
  tf('门禁自己真的采到了 log(采集器是通的,不是空数组蒙对)',
    Array.isArray(run.logged), 'run.logged 不是数组');
}

console.log('\n=== [5] 门禁自检:这套尺子自己先红一遍(反向自检) ===');
{
  // ① 帧驱动真的在跑 —— 挡「update() 从没被调用,于是 0 次出现」的空过
  tf('帧驱动确实调用了 update()(0 次出现不是空过)',
    run.frames > 500, `只跑了 ${run.frames} 帧`);
  tf('驱动期间 HUD 确实是可见的', HUD.visible === true, 'HUD.visible 为假,update() 第一行就 return 了');

  // ② 出现次数这个计数器**能分辨**「一次」和「多次」——
  //    手动把一次性闩清掉,再跑一次,必须数出 2 次。
  //    这测的是尺子,不是产品;它必须能红,否则上面那条 ==1 永远为真。
  // ⚠️ 必须驱动 **HUD 自己绑着的那个引擎**(init() 时存进 HUD.g 的那个):
  //   HUD.update() 读的是 this.g,不是参数。换一个新对象喂进去,量到的
  //   还是上一次那个引擎的时间 —— 门禁会拿一个从没跑过的世界报绿。
  HUD.show(true);
  g.time = HINT_AT + 1;
  HUD.update();
  const onceAgain = visible();
  HUD._bossHintDone = false;          // 模拟「没有闩 / 每帧重画」的产品缺陷
  g.time = HINT_AT + 2;
  HUD.update();
  const twice = visible();
  tf('计数器能分辨:闩在=亮着,闩被清掉后再调一次仍亮 ⇒ 闩才是「一次」的原因',
    onceAgain === true && twice === true,
    '闩清掉后没再亮 —— 说明 update() 里有别的东西在挡着,「只出现一次」未必是闩的功劳');
  HUD._bossHintDone = false;
  HUD._hideBossHint();
  HUD._bossHintDone = false;

  // ③ 时刻门禁能分辨「到点才亮」和「开局就亮」——
  //    在推导时刻的前一秒必须不亮,落在那一刻必须立刻亮。
  //    这挡的是「实现把 240 写成了别的数,门禁的 240 也是抄的」这种同源错误。
  HUD.show(true);
  g.time = HINT_AT - 1;
  HUD.update();
  const justBefore = visible();
  g.time = HINT_AT;                   // 恰好落在推导出的那一刻
  HUD.update();
  const atTheMoment = visible();
  tf('时刻门禁能分辨:推导时刻的前一秒不亮、那一刻就亮',
    justBefore === false && atTheMoment === true,
    `前 1 秒=${justBefore},推导时刻=${atTheMoment}。` +
    `两种可能:① 实现把阈值挪了(那是产品红,[2]/[3] 会各报一条);` +
    `② 门禁的复算公式本身错了(那是尺子坏了)。分不清就不该把结果算成通过。`);
  HUD._bossHintDone = false; HUD._hideBossHint();
}

console.log('\n=== [6] 一局一次:换新局会重新给,收摊不会提前打掉 ===');
{
  HUD.show(true);
  const a = drive(g, 0, 599, 1);
  HUD.show(false);                     // 收摊
  HUD.show(true);                      // 开新一局
  const b = drive(g, 0, 599, 1);
  t('第二局同样恰好给一次', a.appears === 1 && b.appears === 1,
    `第一局 ${a.appears} 次 / 第二局 ${b.appears} 次`);
  t('收摊(不在局内)时预警不还亮着',
    (HUD.show(false), !visible()), '局都结束了提示还挂在屏幕上');
  HUD.show(true);
}

console.log('\n=== [7] 纯提示:不许动平衡 ===');
{
  // 这条提示**只能**读引擎状态。把四个被改就会伤到平衡的量拍快照,
  // 跑完 600 秒再对一遍 —— 谁碰谁红。
  HUD.show(true);
  const before = { kills: g.stats.kills, gold: g.stats.gold, hp: g.player.hp, boss: g.boss };
  drive(g, 0, 600, 1);
  const after = { kills: g.stats.kills, gold: g.stats.gold, hp: g.player.hp, boss: g.boss };
  t('预警跑完 600 秒,击杀/金币/血量/ Boss 实体一个都没动',
    JSON.stringify(before) === JSON.stringify(after),
    `前 ${JSON.stringify(before)} → 后 ${JSON.stringify(after)}`);
  t('Boss 出场时刻仍是 300 / 600(预警没有偷偷挪走 Boss)',
    BOSS_DESIGNS.boss_golem.startTime === 300 && BOSS_DESIGNS.boss_overlord.startTime === 600,
    `现在是 ${BOSS_DESIGNS.boss_golem.startTime} / ${BOSS_DESIGNS.boss_overlord.startTime}`);
  t('Boss 血量设计没被提示改过',
    BOSS_DESIGNS.boss_golem.baseHp === 24000 && BOSS_DESIGNS.boss_overlord.baseHp === 120000,
    `现在是 ${BOSS_DESIGNS.boss_golem.baseHp} / ${BOSS_DESIGNS.boss_overlord.baseHp}`);
  HUD.show(false);
}

// ————————————————————————————————————————————————————————————
if (SELF_FAIL.length) {
  console.log(`\n🛑 门禁自身失效:${SELF_FAIL.length} 项自检没过 —— 这轮结果不可信,不能当通过`);
  process.exit(2);
}
const total = pass + fail;
console.log(fail
  ? `\n❌ boss 预警:红 ${fail}/${total} 项\n   ${RED.map(x => '· ' + x).join('\n   ')}`
  : `\n✅ boss 预警通过:${total} 项(恰好一次 · 240s 前不出现 · 走 UI 不是 log · 不动平衡)`);
process.exit(fail ? 1 : 0);