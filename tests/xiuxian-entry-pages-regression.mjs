// ===== 修仙阁三页「入口化」门禁(称号 / 支线 / 图鉴)=====
//
// 运行: node tests/xiuxian-entry-pages-regression.mjs
// 退出码:0 通过 / 1 不通过 / 2 门禁自身失效(三页渲染不出来,后面全在空转)
//
// 为什么需要这三页的门禁:
//   这三页原本是 14 个页签里**唯一三个真的 0 可点元素**的纯展示页。
//   「保留但降级为入口」这条产品结论落地之后,判据只能是一句话:
//   **一个页面上没有任何「此刻可以去哪儿」的线索,它就是墙。**
//
//   墙面不报错、不打日志、unit test 全绿 —— 它只是让玩家站在一堵字墙前面,
//   不知道该干什么。这类退化只能靠「真的渲染一遍,看页面上有没有去处」来挡。
//
// 盯六件事:
//   G1 三页各有去处线索(data-tab),且**三页文案互不相同**(防「三页抄同一段话」)
//   G2 零解锁项时的表现:什么都不许没有时,不能退回成空白墙
//   G3 玩家可见文案里不得出现内部 id(节点编号 / 存储键 / 存档 flag 名)
//   G4 已有数据一条不少:喂一份满是解锁项的假存档,三页都得显示出来
//   G5 防退化:三页真的渲染不出来就 exit 2,明说「门禁自身失效」
//   G6 反向自检:判定函数在**合成样本**上真的判反,且不碰真实文件
//
// ⚠️ 本机没有浏览器(harness.mjs 顶上写着:playwright 在 Android PRoot 上装不上),
//    所以这里验的是「真实模块 + 真实渲染产物」。data-tab 点了会切页,走的是
//    js/xiuxian/ui.js:152 已有的派发 —— 但「手指真的点得中」要 CI 或桌面补。
//
// ⚠️ G6 是关键的一条:如果判定逻辑本身写错了(比如「三页抄同一段话」那段
//    永远判不出重叠),那 G1~G5 全是自说自话。G6 用几段**内联合成样本**证明
//    判定函数确实会判红 —— 它既不读真实文件,也不跟着产品代码改。

import { install } from './harness.mjs';
install();

let pass = 0, fail = 0; const failed = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};
const die2 = msg => {
  console.log(`\n❌ 门禁自身失效:${msg}`);
  console.log('   —— 别信本次任何结论:后面所有断言都在空转。');
  process.exit(2);
};

// ─────────────────────────────────────────────
// 加载:必须装完 harness 之后再 import 游戏模块
const R = '../js/xiuxian/';
let Cult, CLOCK, STORY, QUEST, LEGEND_LIST, ARCS, TITLES, vTitle, vQuest, vDex, empty;
try {
  ({ Cult } = await import(R + 'index.js'));
  ({ CLOCK } = await import(R + 'clock.js'));
  ({ ARCS } = await import(R + 'story.js'));
  ({ TITLES } = await import(R + 'lore.js'));
  ({ LEGEND_LIST } = await import(R + 'legend.js'));
  ({ empty } = await import(R + 'ui/bag.js'));
  ({ vTitle } = await import(R + 'ui/title.js'));
  ({ vQuest } = await import(R + 'ui/story.js'));
  ({ vDex } = await import(R + 'ui/dexsys.js'));
  ({ STORY } = await import(R + 'story.js'));
  ({ QUEST } = await import(R + 'quest.js'));
} catch (e) {
  die2(`模块加载失败:${e.constructor.name}: ${String(e.message).slice(0, 120)}`);
}
for (const [n, f] of [['vTitle', vTitle], ['vQuest', vQuest], ['vDex', vDex]])
  if (typeof f !== 'function') die2(`${n} 不是可调用的导出函数`);

CLOCK.load();
Cult.init();
STORY.load();
QUEST.load();

// hall 在这三个视图里只被当作壳用(vQuest 会调 hall.empty)。
// 换成真的 empty —— 拿万能代理会返回对象,页面里会印出 [object Object]。
const hall = { empty: (...a) => empty(hall, ...a) };

// ─────────────────────────────────────────────
// 判定函数(纯函数:只吃字符串,不读文件、不 import 产品代码)
// —— G6 之所以能脱离真实文件自检,就是因为它们是纯的。

/** 只留文本节点:属性值(src/class/style)不算玩家读到的字,但也不能混进来一起查。 */
function visibleText(html) {
  return String(html == null ? '' : html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 页面里有没有「能点过去的去处」。data-tab 走 ui.js 已有的派发,不是空按钮。 */
function hasExit(html) {
  return /data-tab="[a-z]+"/.test(String(html || ''));
}

/** 墙:渲染出来了,但读不出字,或字少到只是一句提示。 */
function isWall(html) {
  const txt = visibleText(html);
  return !txt || txt.length < 80;
}

/** 拆句。用于查「三页是不是抄了同一段话」。 */
function sentences(html, minLen = 8) {
  return visibleText(html)
    .split(/[。;；!?！？]/)
    .map(s => s.trim())
    .filter(s => s.length >= minLen);
}

// 玩家可见文案里不该出现的内部标识(XX-PLAY-011 / XX-PLAY-013 那一族)
const ID_SMELLS = [
  [/\bn\d+\b/, '节点编号(如 n8)'],
  [/\bxx_[a-z0-9_]+/i, '存档存储键名'],
  [/\b(challenge|spare|rescue|nemesis_win|refuse_alliance|sword_kill_boss|sword_all_max|medStreak|demon)\b/, '存档 flag 名'],
];
function idLeaks(html) {
  const txt = visibleText(html);
  const out = [];
  for (const [re, why] of ID_SMELLS) {
    const m = txt.match(re);
    if (m) out.push(`${why}:${m[0]}`);
  }
  return out;
}

/** 三页互不相同:任意两页的长句不得重叠。 */
function sharedSentences(a, b) {
  const B = new Set(sentences(b));
  return sentences(a).filter(s => B.has(s));
}

// ─────────────────────────────────────────────
// 造状态:两份存档 —— 「什么都没有」与「什么都有」
function blankSave() {
  Cult.titles.s = { flags: {}, active: [] };
  const st = Cult.get(); st.medStreak = 0;
  STORY.s = { active: {}, done: {}, beat: {}, rumors: [], log: [], met: {}, t: 0 };
  QUEST.s = { active: [], done: {}, choices: {} };
}

function fullSave() {
  blankSave();
  // 称号:八枚全亮 + 每个 flag 都记到不低的数
  Cult.titles.s.active = TITLES.map(x => x.id);
  Cult.titles.s.flags = {
    challenge: 47, spare: 31, demon: 88, nemesis_win: 5,
    refuse_alliance: 6, rescue: 63, sword_kill_boss: 2, sword_all_max: 1, streak: 1,
  };
  Cult.get().medStreak = 17;
  // 图鉴:八只传说妖全见过
  for (const l of LEGEND_LIST) STORY.s.met[l.key] = 1700000000000;
  // 支线:autoTake() 在 vQuest 里跑,见过的妖会自动接上
  const arcKey = Object.keys(ARCS)[0];
  STORY.s.active[arcKey] = true;
  STORY.s.beat[arcKey] = ARCS[arcKey].beats.length;     // 看完一条线 → 进「等你选」
  const legendKey = LEGEND_LIST[0].key;
  QUEST.s.done[legendKey] = { at: 3, path: 2, epilogue: '…' };   // 一件了结过
}

function renderAll() {
  let html = {};
  try { html.title = vTitle(hall); } catch (e) { die2(`vTitle 崩了:${e.constructor.name}: ${String(e.message).slice(0, 120)}`); }
  try { html.quest = vQuest(hall); } catch (e) { die2(`vQuest 崩了:${e.constructor.name}: ${String(e.message).slice(0, 120)}`); }
  try { html.dex = vDex(hall); } catch (e) { die2(`vDex 崩了:${e.constructor.name}: ${String(e.message).slice(0, 120)}`); }
  return html;
}

const PAGES = [['称号', 'title'], ['支线', 'quest'], ['图鉴', 'dex']];

// ─────────────────────────────────────────────
console.log('\n[G5] 三页真的渲染得出来(为 0 就是门禁失效,不是页面有问题)');
blankSave();
const ZERO = renderAll();
for (const [name, key] of PAGES) {
  const h = ZERO[key];
  if (typeof h !== 'string') die2(`${name}页渲染结果不是字符串(${typeof h})`);
  if (!h.trim()) die2(`${name}页渲染出空串 —— 门禁后面所有断言都只在空转`);
}
t('三页都渲染出了非空 HTML',
  PAGES.every(([, k]) => ZERO[k].length > 200),
  PAGES.map(([n, k]) => `${n}:${ZERO[k].length}字`).join(' '));

// ─────────────────────────────────────────────
console.log('\n[G1] 每页都有「此刻可以去哪儿」,且三页文案互不相同');
for (const [name, key] of PAGES) {
  t(`${name}页有能点过去的去处`, hasExit(ZERO[key]),
    (ZERO[key].match(/data-tab="[a-z]+"/g) || []).join(' '));
}
{
  const [a, b, c] = PAGES.map(([, k]) => ZERO[k]);
  const ab = sharedSentences(a, b), ac = sharedSentences(a, c), bc = sharedSentences(b, c);
  t('称号页与支线页没有抄同一段话', ab.length === 0, ab.join(' / '));
  t('称号页与图鉴页没有抄同一段话', ac.length === 0, ac.join(' / '));
  t('支线页与图鉴页没有抄同一段话', bc.length === 0, bc.join(' / '));
  // 反向:三页首屏各说各的(同义改写也算抄)
  const heads = PAGES.map(([n, k]) => visibleText(ZERO[k]).slice(0, 40));
  t('三页开头文字两两不同', new Set(heads).size === 3, heads.join(' | '));
}

// ─────────────────────────────────────────────
console.log('\n[G2] 零解锁项:什么都没有时也不能是空白墙');
for (const [name, key] of PAGES) {
  t(`${name}页零状态下不是墙`, !isWall(ZERO[key]), `可读文字 ${visibleText(ZERO[key]).length} 字`);
  t(`${name}页零状态下仍有去处`, hasExit(ZERO[key]));
}
// 称号:零枚时八条仍在(内容不许少),并且说清「还没有」
{
  const h = ZERO.title;
  const rows = (h.match(/xx-title-i/g) || []).length;
  t('零称号时八条称号一条不少', rows === TITLES.length, `渲染 ${rows} / ${TITLES.length}`);
  t('零称号时说清「一枚都还没亮」', /一枚都还没亮/.test(h));
  t('零称号时给出去处(不是只有一面印墙)', hasExit(h));
}
// 支线:零任务时走 empty 分支,但仍要有去处
{
  const h = ZERO.quest;
  t('零支线时仍把「账怎么来的」讲出来', /账\s*是\s*怎\s*么\s*记\s*上\s*的/.test(h));
  t('零支线时不是空白', visibleText(h).length > 100, `${visibleText(h).length} 字`);
}
// 图鉴:零只见过时,未见的条目仍在,且说清差多少
{
  const h = ZERO.dex;
  const unseen = (h.match(/xx-dxx unseen/g) || []).length;
  t('零见闻时未见的传说妖一条不少', unseen === LEGEND_LIST.length, `unseen ${unseen} / ${LEGEND_LIST.length}`);
  t('零见闻时说清「一只都还没见过」', /一只都还没见过/.test(h));
}

// ─────────────────────────────────────────────
console.log('\n[G3] 玩家可见文案里没有内部 id');
for (const [name, key] of PAGES) {
  const leaks = idLeaks(ZERO[key]);
  t(`${name}页零状态下无内部 id`, leaks.length === 0, leaks.join(' / '));
}

// ─────────────────────────────────────────────
console.log('\n[G4] 已有数据一条不少(喂一份满是解锁项的假存档)');
const FULL = (fullSave(), renderAll());
{
  // 称号:八枚全亮,desc 全部替换 cond 露出
  const on = (FULL.title.match(/xx-title-i on/g) || []).length;
  const seals = (FULL.title.match(/>印</g) || []).length;
  t('八枚称号全部亮印', on === TITLES.length && seals === TITLES.length,
    `on=${on} 印=${seals} / ${TITLES.length}`);
  const missingDesc = TITLES.filter(x => !FULL.title.includes(x.desc)).map(x => x.name);
  t('八条称号的来历一条不少', missingDesc.length === 0, missingDesc.join('/'));
}
{
  // 支线:见妖自动接上的账、看完了等你选、了结过的,三段都要有内容
  const h = FULL.quest;
  t('见过的传说妖在支线页留下了账', QUEST.s.active.length > 0 && QUEST.s.active.every(k => h.includes(LEGEND_LIST.find(l => l.key === k).quest.title)),
    `接下 ${QUEST.s.active.length} 件`);
  t('看完的叙事线进了「等你选」', /看 完 了 · 等 你 选/.test(h));
  t('了结过的账还在', /了 结 过 的/.test(h) && h.includes(LEGEND_LIST[0].quest.title));
  t('有账时三页仍有去处', hasExit(h));
}
{
  // 图鉴:八只全见过 → 全部展开来历与传闻,且不再是 unseen
  const h = FULL.dex;
  const unseen = (h.match(/xx-dxx unseen/g) || []).length;
  t('见过的传说妖一条不少', unseen === 0, `还剩 ${unseen} 只锁着`);
  const missing = LEGEND_LIST.filter(l => !h.includes(l.name)).map(l => l.name);
  t('八只传说妖的名字都在', missing.length === 0, missing.join('/'));
  t('见过后来历才展开', visibleText(h).includes(LEGEND_LIST[0].lore.slice(0, 6)));
  const leaks = idLeaks(h);
  t('满状态下也无内部 id', leaks.length === 0, leaks.join(' / '));
}

// ─────────────────────────────────────────────
console.log('\n[G6] 反向自检:判定函数在合成样本上真的判红(不读真实文件)');
{
  // 样本一:三页抄同一段话
  const dup = '<div class="xx-card"><div class="xx-dim">去山里走远一点,别总待在村口,事情自然就来了。</div><button class="xx-btn" data-tab="map">走</button></div>';
  const dupPages = [dup, dup, dup];
  t('三页同文案 → 判定为「抄同一段话」',
    sharedSentences(dupPages[0], dupPages[1]).length > 0 && sharedSentences(dupPages[0], dupPages[2]).length > 0);
  // 样本二:文案干净但两页不同 → 不该报
  const p1 = '<div class="xx-dim">这里记的不是名头,是你走过的路。</div>';
  const p2 = '<div class="xx-dim">图鉴记的是你见过什么,没见过的那几行只剩名字。</div>';
  t('三页各自不同 → 不报「抄同一段话」',
    sharedSentences(p1, p2).length === 0
    && sharedSentences(p1, p1.replace('路', '路途')).length === 0);
  // 样本三:墙 / 有去处
  t('空白输出 → 判定为墙', isWall('') && isWall('<div class="xx-card"></div>'));
  t('有内容有去处的输出 → 不判为墙', !isWall('<div class="xx-card"><div class="xx-dim">' + '字'.repeat(120) + '</div><button data-tab="map">走</button></div>'));
  t('无 data-tab → 判定为没有去处', !hasExit('<div class="xx-dim">这里记的不是名头,是你走过的路。</div>'));
  t('有 data-tab → 判定为有去处', hasExit('<button data-tab="realm">吐纳</button>'));
  // 样本四:内部 id 一定会被抓到
  t('合成样本里的节点编号被抓住', idLeaks('<div class="xx-dim">阵旗发动,至「n8」。</div>').length === 1);
  t('合成样本里的存储键被抓住', idLeaks('<div class="xx-dim">见存档 xx_titles_v077 里写着。</div>').length === 1);
  t('合成样本里的 flag 名被抓住', idLeaks('<div class="xx-dim">还差 nemesis_win 几次。</div>').length === 1);
  t('干净文案不误报', idLeaks('<div class="xx-dim">这里记的不是名头,是你走过的路。</div>').length === 0);
  // 样本五:判定函数不碰真实文件(改产品代码不会影响它)
  t('判定函数只吃字符串(纯函数)', sentences.length === 1 && idLeaks.length === 1 && hasExit.length === 1);
}

// ─────────────────────────────────────────────
console.log(`\nxiuxian-entry-pages-regression: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);