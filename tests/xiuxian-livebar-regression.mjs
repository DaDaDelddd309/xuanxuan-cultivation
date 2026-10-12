// ===== 修仙阁 ·「当前正在发生」动态区门禁(XX-LIVE-001)=====
//
// 运行: node tests/xiuxian-livebar-regression.mjs
// 退出码:0 通过 / 1 不通过 / 2 门禁自身失效(解析不到东西,后面全在空转)
//
// 存在理由:
//   这一轮修的是**转换层**,不是内容层 —— 把好文案贴在数据旁边当注释,
//   玩家看到一个静止的自己,不是一个正在运转的宗门。
//   于是这个门禁盯的不是「文案好不好」,是三件不会自己报警的事:
//   · 「每一页都有动态区」——插在分发处,所以将来加页签不会漏;
//     一旦有人改成逐页插、或漏掉某一页,玩家看到的是「这页坏了」。
//   · 「它是活的」——燃料分钟数必须真的随时间走。
//     写死一个分钟数,这一整条工单就白做了,而且**看上去完全正常**。
//   · 「没有在发生的时候它也要开口」——空白条会被读成加载失败,比没有更糟。
//
// ⚠️ 本机没有浏览器(见 harness.mjs 顶上),这里验的是**真实模块 + 真实分发链路**,
//    不是「浏览器里看过了」。真机上那根燃料条的 CSS 宽度过渡,得由 CI 补。
//
// ⚠️ 关于「不与当前代码状态耦合」:本门禁**不读任何存档**。
//    CAMP.s / BUILD.s / Date.now 全部用合成样本喂进去,断言的是
//    「合成输入 → 对应方向」这条契约,而不是「玩家当前恰好有什么」。
//    所以玩家玩到第 30 天时这个门禁的结论也不会变。

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

// 合成基准时刻。
// ⚠️ 必须锚在**真实的此刻**上,不能写死一个过去的常量:
//    写死过去的时间戳 → 那堆「火在烧」的样本在真实 now 看来早就烧完了,
//    tick 项一律为空 → 定时器一条都挂不上,而门禁还全绿。
//    锚在 now 上就不受影响:所有断言都是**相对量**(37 分钟 → 32 分钟),
//    跟玩家几点打开测试无关。
const T0 = Date.now();
const MIN = 60000;

/** 剥掉标签,取可见文字。harness 不把 innerHTML 聚合到解析出来的子节点上,
 *  所以文字一律从**源码串**上取,不从子节点上取(见 G1 的说明)。 */
const text = html => String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/**
 * 从 #xx-body 的赋值串里抠出动态区那一块(**精确到标签配平**)。
 *
 * ⚠️ 不能去读 `#xx-livebar` 节点自己的 innerHTML:
 *    harness 的 parseHTML 建子节点时不写 innerHTML,那个 getter 恒返回空串 ——
 *    于是「定时器到底改没改 DOM」这条读到的是空气。
 *    #xx-body 是被赋过 innerHTML 的,读它才拿得到真东西。
 *
 * ⚠️ 也不能「截到下一张 .xx-card 为止」:大地图页/营地页后面跟的元素
 *    不一定是 .xx-card,那种页面上会一路截到页面末尾 —— 于是「动态区渲染成空」
 *    会被后面页面的字掩盖过去,门禁就瞎了。改成数 div 开合,配平为止。
 */
function barHtml() {
  const h = document.querySelector('#xx-body').innerHTML;
  const i = h.indexOf('<div class="xx-card" id="xx-livebar"');
  if (i < 0) return '';
  const re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  let depth = 0, m;
  while ((m = re.exec(h))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return h.slice(i, m.index + 6);
  }
  return h.slice(i);
}

// —— 定时器陷阱:本项目栽过「定时器泄漏」,所以必须能数清楚有几颗在跑 ——
function trapTimers() {
  const rec = { live: new Set(), cbs: new Map(), cleared: [], n: 0 };
  const realSI = globalThis.setInterval, realCI = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => { const id = ++rec.n; rec.live.add(id); rec.cbs.set(id, fn); rec.ms = ms; return id; };
  globalThis.clearInterval = id => { rec.live.delete(id); rec.cleared.push(id); };
  rec.restore = () => { globalThis.setInterval = realSI; globalThis.clearInterval = realCI; };
  rec.fire = () => { for (const fn of Array.from(rec.cbs.values())) fn(); };
  return rec;
}

let HALL, CAMP, BUILD, LB, Cult;
const SNAP = {};
try {
  ({ Cult } = await import('../js/xiuxian/index.js'));
  ({ CAMP } = await import('../js/xiuxian/camp.js'));
  ({ BUILD } = await import('../js/xiuxian/build.js'));
  LB = await import('../js/xiuxian/ui/livebar.js');
  ({ Hall: HALL } = await import('../js/xiuxian/ui.js'));
  Cult.init();
  SNAP.camp = JSON.parse(JSON.stringify(CAMP.s));
  SNAP.build = JSON.parse(JSON.stringify(BUILD.s));
} catch (e) {
  die2(`动态区模块加载失败,下面的断言一条都没跑:\n     ${e.message}`);
}
/** 喂合成样本。**只写内存里的 s 对象**,不碰 localStorage,退出时还原。 */
const setCamp = patch => { CAMP.s = { ...JSON.parse(JSON.stringify(SNAP.camp)), ...patch }; };
const setBuild = patch => { BUILD.s = { ...JSON.parse(JSON.stringify(SNAP.build)), ...patch }; };
const restore = () => { CAMP.s = JSON.parse(JSON.stringify(SNAP.camp)); BUILD.s = JSON.parse(JSON.stringify(SNAP.build)); LB.livebarOff(); };

const burning = fuelEnd => setCamp({ lit: true, fuelEnd, totalSec: 0 });
const cold = () => setCamp({ lit: false, fuelEnd: 0 });
const field = (plantAt, bid = 'bld_field') => setBuild({ placed: [{ bid, slot: 0, workers: [], plantAt }] });

/**
 * 从 ui.js 源码里取 TABS。
 * 不 import ui.js 的内部量(ui.js 没有导出 TABS,也不该为了一个门禁去导出它 ——
 * 那等于把「页签表有几条」变成公开契约,以后改页签就得改门禁的 import)。
 * key 允许带引号不带引号两种写法(现在是 ['realm','境界'])。
 */
function parseTabs() {
  const src = readFileSync(ROOT + '/js/xiuxian/ui.js', 'utf8');
  // 取到**同一行末尾的分号**为止,不能写成 [^\]]* —— TABS 自己是数组,
  // 用 [^\]] 会在第一个 ['realm' 的 ] 上就停住,一个页签都解析不出来。
  const decl = src.match(/const\s+TABS\s*=\s*(\[[^\n]*?\]);/);
  if (!decl) return null;
  return [...decl[1].matchAll(/\[(?:'|")?(\w+)(?:'|")?\s*,\s*'([^']+)'\]/g)].map(m => [m[1], m[2]]);
}

// ─────────────────────────────────────────────────────────────
console.log('\n[G4] 防退化:真的解析到 14 个页签与 14 份动态区输出');
// 这条必须排在最前面。解析不到 TABS、或动态区渲染不出东西时,
// 后面每一条断言都会「因为找不到东西所以没报错」地绿过去 ——
// 一份全绿但什么都没验的门禁,比没有门禁更危险(AUTONOMY §3)。
{
  const src = readFileSync(ROOT + '/js/xiuxian/ui.js', 'utf8');
  const TABS = parseTabs();
  if (!TABS || TABS.length === 0) die2('TABS 解析到 0 个页签(声明格式变了?):' + (src.match(/const\s+TABS[^;]*/) || [''])[0].slice(0, 140));
  if (TABS.length !== 14) die2(`TABS 解析到 ${TABS.length} 个页签,预期 14。页签表变了就改这份门禁的预期值,别让它悄悄放过。`);
  console.log(`  · 解析到 ${TABS.length} 个页签:${TABS.map(x => x[0]).join(',')}`);

  t('页签 key 互不重复', new Set(TABS.map(x => x[0])).size === TABS.length);
  // 动态区插入点:渲染链路上必须真的有 livebar 调用,而不是函数存在就算数
  t('ui.js 的渲染分发处确实调用了 livebar(一处插入点)',
    /bodyEl\.innerHTML\s*=\s*livebarHTML\(tab\)/.test(src));
  t('livebarOn 挂在渲染之后', /livebarOn\(bodyEl,\s*tab\)/.test(src));
  t('close() 会收定时器(离页不留野定时器)',
    /close\(\)\s*\{\s*livebarOff\(\);/.test(src));

  // 合成一份「没有在发生任何事」的状态,逐页渲染,数动态区条数
  HALL.open();
  const body = document.querySelector('#xx-body');
  if (!body) die2('HALL.open() 之后找不到 #xx-body —— 后面的断言全在空转');

  // 「门禁自身失效」只认**组件自己都渲染不出东西**这一种:
  // 那说明本门禁已经看不见被测对象了,后面全是空转,必须 exit 2。
  // 反过来,组件单独调用是好的、只有页面里没出现 —— 那是**接线断了**
  // (真实缺陷),该报红退出 1,不是 exit 2。把两者混为一谈,
  // 就会让「动态区根本没接上」被报成「门禁坏了」,两件事互相掩护。
  cold(); setBuild({ placed: [] });
  if (text(LB.livebarHTML('realm', T0)).length === 0)
    die2('直接调用 livebarHTML 都出不来文字 —— 门禁自身失效,别信结论');

  let rendered = 0;
  for (const [k] of TABS) {
    HALL.tab = k; HALL.render();
    if (body.querySelector('#xx-livebar')) rendered++;
  }
  console.log(`  · 遍历 ${TABS.length} 个页签,渲染出 ${rendered} 条动态区`);
  t('14 个页签全都渲染出了动态区(接线在,不是门禁瞎了)', rendered === TABS.length, `渲染出 ${rendered} 条`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n[G1] 每一页顶部都有一条动态区(遍历全部页签,不是抽查)');
{
  const TABS = parseTabs();
  if (!TABS || TABS.length !== 14) die2('G1 拿不到 14 个页签(G4 已查过,这里不该发生)');
  const body = document.querySelector('#xx-body');

  // 两种状态各跑一遍:「在烧」和「零态」。漏插的页签在任一种下都会露出来。
  for (const [label, setup] of [['在烧', () => { burning(T0 + 37 * MIN); field(T0 + 4 * MIN); }],
                                ['零态', () => { cold(); setBuild({ placed: [] }); }]]) {
    setup();
    const missing = [], notFirst = [], silent = [];
    for (const [k, name] of TABS) {
      HALL.tab = k; HALL.render();
      const el = body.querySelector('#xx-livebar');
      if (!el) { missing.push(k); continue; }
      if (body.children[0] !== el) notFirst.push(k);
      // harness 不聚合子节点的 innerHTML,文字一律取 #xx-body 上真实的赋值串(见 barHtml)
      if (text(barHtml()).length < 4) silent.push(k);
    }
    t(`[${label}] 14 个页签全都有动态区`, missing.length === 0, '缺:' + missing.join(','));
    t(`[${label}] 动态区在页面最顶端(不是塞在页面末尾)`, notFirst.length === 0, '不在首位:' + notFirst.join(','));
    t(`[${label}] 动态区有字(不是一条空壳)`, silent.length === 0, '空条:' + silent.join(','));
    // 对照组:这条断言必须真的会因为「插在末尾」而红,否则它在空转
    t(`[${label}] 对照组:body.innerHTML 以动态区开头`,
      body.innerHTML.startsWith('<div class="xx-card" id="xx-livebar"'));
  }

  // 换页签不会漏:同一个实例连切 14 次,每次都得有
  cold(); setBuild({ placed: [] });
  let n = 0;
  for (const [k] of TABS) { HALL.tab = k; HALL.render(); if (body.querySelector('#xx-livebar')) n++; }
  t('连切 14 个页签,动态区条数不衰减', n === TABS.length, `实测 ${n}`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n[G2] 它是活的:燃料分钟数随时间递减(不是写死的一行字)');
{
  burning(T0 + 37 * MIN);
  field(T0 + 4 * MIN);

  const at0 = LB.livebarItems(T0).find(i => i.k === '篝火');
  const at5 = LB.livebarItems(T0 + 5 * MIN).find(i => i.k === '篝火');
  t('喂 T0:燃料 37 分钟', /37/.test(at0.v), at0.v);
  t('喂 T0+5 分钟:燃料 32 分钟', /32/.test(at5.v), at5.v);
  t('分钟数随时间递减', /37/.test(at0.v) && /32/.test(at5.v));

  // 另一条路:不传 now,走 Date.now() 的默认路径。
  // 只测上面那条的话,「默认 now 在模块加载时被算死」这种退化照样全绿。
  const realNow = Date.now;
  let viaDefault = '', viaDefault5 = '';
  try {
    Date.now = () => T0;
    viaDefault = text(LB.livebarHTML('camp'));
    Date.now = () => T0 + 5 * MIN;
    viaDefault5 = text(LB.livebarHTML('camp'));
  } finally { Date.now = realNow; }
  t('走 Date.now() 默认路径时,喂两个时刻得到不同分钟数',
    viaDefault !== viaDefault5 && /37/.test(viaDefault) && /32/.test(viaDefault5),
    `${viaDefault} → ${viaDefault5}`);

  // 反向自检:喂第三个时刻,必须落在两者之间 —— 只判「不相等」的话,
  // 打印成随机数也能过。
  const at12 = text(LB.livebarItems(T0 + 12 * MIN).find(i => i.k === '篝火').v);
  t('第三个时刻落在递减序列上(25 分钟)', /25/.test(at12), at12);

  // 灵田同理:plantAt 是真实时间戳,分钟数必须跟着走
  const f0 = text(LB.livebarItems(T0).find(i => i.k === '灵田').v);
  const f3 = text(LB.livebarItems(T0 + 3 * MIN).find(i => i.k === '灵田').v);
  t('灵田倒计时随时间递减(4 → 1 分钟)', /4/.test(f0) && /1/.test(f3), `${f0} → ${f3}`);
  t('灵田熟透之后不再报倒计时,改口说已熟',
    /已熟/.test(LB.livebarItems(T0 + 5 * MIN).find(i => i.k === '灵田').v));

  // —— 定时器:真的一秒一秒在改 DOM,并且不越攒越多 ——
  burning(T0 + 37 * MIN); field(T0 + 4 * MIN);
  const rec = trapTimers();
  try {
    HALL.tab = 'camp'; HALL.render();
    t('在烧的时候挂上了定时器', rec.live.size === 1, `活着 ${rec.live.size} 颗`);
    HALL.tab = 'realm'; HALL.render();
    t('切页签不会攒出第二颗定时器', rec.live.size === 1, `活着 ${rec.live.size} 颗`);
    HALL.render();
    t('同页重绘也不会攒出第二颗定时器', rec.live.size === 1, `活着 ${rec.live.size} 颗`);

    // 让世界走 5 分钟,敲一下定时器,DOM 里的分钟数必须跟着改
    //
    // ⚠️ before 与 after 取的不是同一个节点,这是被 harness 的桩逼出来的:
    //    渲染时是给 **#xx-body** 赋的 innerHTML,所以初始那块只能从 #xx-body 读;
    //    定时器写的是 **#xx-livebar 节点自己**的 innerHTML,而 parseHTML 不把
    //    子节点的改动回传父节点的赋值串 —— 于是「改完」只能从那个节点读。
    //    两边都读被真正赋值过的那个节点,不是绕过桩去摸 _html。
    const node = document.querySelector('#xx-livebar');
    // 动态区没接进页面时这里会拿到 null —— 直接读 innerHTML 会把门禁带崩成
    // 一个 TypeError 堆栈。崩掉虽然也是非零退出,但那读起来像「门禁自己坏了」,
    // 掩盖了真正该看的那条红。所以先判一次,再继续。
    t('定时器的作用目标节点存在', !!node, node ? '' : '页面上找不到 #xx-livebar');
    const before = text(barHtml());
    const realNow2 = Date.now;
    try { Date.now = () => T0 + 5 * MIN; rec.fire(); }
    finally { Date.now = realNow2; }
    const after = node ? text(node.innerHTML) : '(无节点,读不到)';
    t('定时器真的把 DOM 上的分钟数改小了(37 → 32)',
      /37/.test(before) && /32/.test(after), `${before} → ${after}`);
    // 对照组:再敲一次、把钟拨回去,必须重新写回 37 —— 只判「变了」的话,
    // 一个只会往节点里写死「32 分钟」的定时器照样能过。
    try { Date.now = () => T0; rec.fire(); }
    finally { Date.now = realNow2; }
    const back = node ? text(node.innerHTML) : '(无节点,读不到)';
    t('对照组:钟拨回去,节点上的分钟数跟着回到 37', /37/.test(back), back);
    // 拨回去以后重新前进一次,把下面的「退休」测试接上
    try { Date.now = () => T0 + 5 * MIN; rec.fire(); }
    finally { Date.now = realNow2; }

    HALL.close();
    t('离页(close)收掉了定时器', rec.live.size === 0, `还活着 ${rec.live.size} 颗`);
    t('收的是刚才那一颗(不是收了个别的)', rec.cleared.length >= 1, JSON.stringify(rec.cleared));

    // 零态不该留一颗每秒空转的野定时器
    cold(); setBuild({ placed: [] });
    HALL.tab = 'camp'; HALL.render();
    t('零态不挂定时器(没有在变的东西)', rec.live.size === 0, `活着 ${rec.live.size} 颗`);

    // 燃料烧完 → 定时器自己退休
    burning(T0 + 30 * 1000); field(T0 + 30 * 1000);      // 只剩 30 秒
    HALL.tab = 'camp'; HALL.render();
    t('快烧完时定时器仍挂着(倒计时还没走完)', rec.live.size === 1, `活着 ${rec.live.size} 颗`);
    const realNow3 = Date.now;
    try { Date.now = () => T0 + 20 * MIN; rec.fire(); } finally { Date.now = realNow3; }
    t('倒计时走完后定时器自己退休', rec.live.size === 0, `还活着 ${rec.live.size} 颗`);
  } finally { rec.restore(); }
}

// ─────────────────────────────────────────────────────────────
console.log('\n[G3] 零态:没有在烧的时候,它要开口,不是留白');
{
  cold(); setBuild({ placed: [] });
  const html = LB.livebarHTML('realm', T0);
  const s = text(html);
  console.log(`  · 零态输出:${s}`);
  t('零态不是空条', s.length > 4, `长度 ${s.length}`);
  t('零态明说此刻没有在烧', /没有在烧/.test(s), s);
  t('零态有一句总结,不是一堆碎片', /此刻没有什么在发生/.test(s), s);
  t('零态标签还在(玩家看得出这是什么)', /此 刻 正 在 发 生/.test(s));
  t('空壳判定:不是一对空的 div', !/^<div[^>]*>\s*<\/div>$/.test(html.trim()));

  // 反向:有火的时候就不该说「没有在烧」—— 否则这条断言是恒真的
  burning(T0 + 37 * MIN);
  const hot = text(LB.livebarHTML('realm', T0));
  t('对照组:火在烧时不说「没有在烧」', !/没有在烧/.test(hot), hot);
  t('对照组:火在烧时也不说「此刻没有什么在发生」', !/此刻没有什么在发生/.test(hot), hot);

  // 没下种的田不是「正在发生的事」,不该占一条 —— 但火那条还在
  cold(); field(0);
  const s2 = text(LB.livebarHTML('build', T0));
  t('没下种的灵田不进动态区', !/灵田/.test(s2), s2);
  t('没下种的灵田不影响零态仍然开口', /没有在烧/.test(s2), s2);
}

// ─────────────────────────────────────────────────────────────
console.log('\n[G5] 反向自检:合成样本,方向写反时必须报红');
// 这一组全是**合成**的 CAMP/BUILD 状态,不读存档、不依赖玩家玩到哪一步。
// 存在的意义:前面几条万一因为某个原因恒真,这里是唯一还能翻红的地方。
{
  // a) 灵田:plantAt 在未来 / 在过去 / 为 0,三种输入必须给三种不同的答案
  field(T0 + 6 * MIN);
  const growing = LB.livebarItems(T0).filter(i => i.k === '灵田');
  const ready = LB.livebarItems(T0 + 10 * MIN).filter(i => i.k === '灵田');
  field(0);
  const unplanted = LB.livebarItems(T0).filter(i => i.k === '灵田');
  t('plantAt 在未来 → 有倒计时', growing.length === 1 && /还剩 6 分钟/.test(growing[0].v), JSON.stringify(growing));
  t('plantAt 在过去 → 报已熟,不再报倒计时', ready.length === 1 && /已熟/.test(ready[0].v) && !/还剩/.test(ready[0].v), JSON.stringify(ready));
  t('plantAt 为 0(未下种) → 一条都不出', unplanted.length === 0, JSON.stringify(unplanted));
  t('三种输入给出三种不同结果(没有恒真)', growing.length === 1 && ready.length === 1 && unplanted.length === 0);

  // b) 篝火:lit 但燃料早已耗尽,不能还在报「还剩 N 分钟」
  setCamp({ lit: true, fuelEnd: T0 - 5 * MIN });
  const spent = LB.livebarItems(T0).find(i => i.k === '篝火');
  t('lit 但燃料已过 → 不报剩余分钟', !/燃料 \d+ 分钟/.test(spent.v), spent.v);
  t('lit 但燃料已过 → 说火只剩灰', /只剩灰/.test(spent.v), spent.v);
  t('火只剩灰 → 不算「正在推进」', spent.quiet === true, JSON.stringify(spent));

  // c) 未生火 vs 已生火:两个方向都要能翻
  cold();
  const off = LB.livebarItems(T0).find(i => i.k === '篝火');
  t('未生火 → 说此刻没有在烧', /此刻没有在烧/.test(off.v), off.v);
  t('未生火 → 不算「正在推进」', off.quiet === true, JSON.stringify(off));

  // d) 营地阶位:只在火真在烧时报(烧着的时候 totalSec 才会走)
  //    ⚠️ setCamp 是「在存档快照上打补丁」,不是叠加 —— 后一次调用会把前一次的
  //    lit/fuelEnd 冲回快照值(快照里是「没生火」)。所以这里一次把三个字段写全。
  setCamp({ lit: true, fuelEnd: T0 + 37 * MIN, totalSec: 0 });
  const tierHot = LB.livebarItems(T0).filter(i => i.k === '营地');
  cold(); setCamp({ totalSec: 0 });
  const tierCold = LB.livebarItems(T0).filter(i => i.k === '营地');
  t('火在烧 → 报距下一阶还差多少分钟', tierHot.length === 1 && /还需烧/.test(tierHot[0].v), JSON.stringify(tierHot));
  t('火灭了 → 不报阶位(那个数字不会再动)', tierCold.length === 0, JSON.stringify(tierCold));

  // e) 合成样本的完整性:每一条都必须有标签和话,不能有半截
  burning(T0 + 37 * MIN); field(T0 + 4 * MIN);
  const items = LB.livebarItems(T0);
  t('合成样本下每条都有标签与内容', items.length > 0 && items.every(i => i.k && i.v && i.v.length > 1),
    JSON.stringify(items.map(i => i.k)));
  t('至少有一条是会随时间变的(tick)', items.some(i => i.tick === true), JSON.stringify(items.map(i => i.tick)));

  // f) 渲染出口永远非空:ui.js 无条件把它拼在最前面,返回空串就是空白条
  cold(); setBuild({ placed: [] });
  t('livebarHTML 在零态下仍返回非空串', LB.livebarHTML('realm', T0).length > 20);
  t('livebarHTML 在燃烧态下仍返回非空串', (burning(T0 + 37 * MIN), LB.livebarHTML('camp', T0).length > 20));
}

restore();

// ─────────────────────────────────────────────────────────────
console.log(`\n${fail ? '❌' : '✅'} ${pass} 通过 / ${fail} 不通过`);
if (fail) { failed.forEach(f => console.log('   · ' + f)); process.exit(1); }
console.log('✅ XX-LIVE-001「当前正在发生」动态区:14 个页签都有、分钟数会走、零态开口。');
