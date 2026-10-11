// duel-echo-reachability.mjs —— 「墨影对结局作出的回应」能不能真的上屏
// 运行: node tests/duel-echo-reachability.mjs
// 退出码:0 = 通过;非 0 = 不通过
//
// ── 病 ────────────────────────────────────────────────────────────────────
// FOE_LINES_ECHO.moying / HERO_LINES_ECHO.moying 这四句
//   「空席。我刻了三百年的名字,最后自己坐上去了。」
//   「石将跪了。你替它把话说完了 —— 就没我什么事了。」
//   「……墨影。你的碑上,这次没有我的名字。」
//   「石将能下班了。你呢?」
// 是全项目里**唯一**让墨影对玩家结局作出反应的文本。
// 而墨影(key:'moying')是唯一 isNemesis 恒为 true 的敌人
// (ui.js:777 的 boss 池只有 [['墨影','宿 敌','foe',true,'moying']]),
// foeLine/heroLine 又把宿敌骨架句排在 echo 分支前面
// ⇒ 这四句一句都上不了屏。外部审计的原话:
//   「文本已经把答案写好了,机制让它到不了玩家眼前。」
//
// ── 本门禁钉的是**玩家实际看到的那段对白**,不是某一行源码 ──────────────────
// 判据 = 真跑 Duel.start() 把整段开场对白录下来,看四句在不在里面。
// 只比 foeLine 的返回值是不够的:那句话可能压根没人调用。
//
// ── 为什么不钉「foeLine 直接返回 echo 句」 ─────────────────────────────────
// 宿主那两句(「断剑冢里又添一块碑……」「墨影。我们又见面了。」)是 XX-ARCH-009
// 调性骨架的锚点,且被 tests/duel-echo-regression.mjs §4 钉成断言。
// 本轮采取的是**四拍**:骨架(敌)→ 骨架(我)→ 回声(敌)→ 回声(我)——
// 骨架一字未改,回声作为第二拍上屏。理由写在 duel.js introBeats 上方。
// 下面 [4] 专门钉「骨架还在」,确保这不是一次偷偷的顶替。
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

// ── 可控假时钟 ──────────────────────────────────────────────────────────────
// 必须响应 clearTimeout(打字机 finishType 靠它掐掉排队的 step),
// 否则回调被调两遍 —— 门禁会在一个不存在的世界里变绿(AUTONOMY.md §3.3)。
const timers = new Map();
let _tid = 0;
globalThis.setTimeout = fn => { const id = ++_tid; timers.set(id, fn); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
/** 把所有定时器跑到空;不收敛就抛错,而不是安静地转 */
const drain = (label, maxSteps = 4000) => {
  let guard = 0;
  while (timers.size) {
    if (++guard > maxSteps) throw new Error(`假时钟不收敛(${label}):还有 ${timers.size} 个定时器在排队`);
    const id = timers.keys().next().value;
    const fn = timers.get(id);
    timers.delete(id);
    fn();
  }
};
globalThis.requestAnimationFrame = fn => { fn(); return 0; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };

// ── DOM 桩 ─────────────────────────────────────────────────────────────────
// 性质 ①:同一 selector 永远返回**同一个**元素。paintHp 写到的和 hurt 读到的
//   必须是同一个,否则报出来的红全是假的。
// 性质 ②:querySelectorAll 每次返回**同一批活节点**(按 innerHTML 记忆化)。
//   现造新节点 ⇒ duel.js 挂的监听器挂在没人引用的对象上(AUTONOMY.md §3.4)。
const REG = new Map();
const reg = sel => { if (!REG.has(sel)) REG.set(sel, mkEl('div')); return REG.get(sel); };
const resetDom = () => { REG.clear(); timers.clear(); };
function parseFrom(host, attr) {
  const html = host.innerHTML;
  if (!host._cache || host._cache.html !== html) {
    const out = [];
    const re = new RegExp(`${attr}="([^"]+)"`, 'g');
    let m;
    while ((m = re.exec(html || ''))) { const b = mkEl('div'); b.dataset[attr === 'data-c' ? 'c' : 'art'] = m[1]; out.push(b); }
    host._cache = { html, nodes: out };
  }
  return host._cache.nodes;                       // ← 每次同一批引用
}
function mkEl(tag) {
  const el = {
    tagName: tag, className: '', _cls: new Set(), style: {}, dataset: {},
    _html: '', textContent: '', src: '', offsetWidth: 1, _kids: [], _h: {},
    onclick: null,
    classList: {
      add: (...c) => c.forEach(x => el._cls.add(x)),
      remove: (...c) => c.forEach(x => el._cls.delete(x)),
      contains: c => el._cls.has(c),
    },
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = String(v); },
    appendChild(c) { el._kids.push(c); return c; },
    append(...c) { el._kids.push(...c); },
    addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
    querySelector(sel) { return reg(sel); },
    querySelectorAll(sel) {
      if (sel === '.xx-chio') return parseFrom(el, 'data-c');
      if (sel === '[data-art]' || sel === 'button') return parseFrom(el, 'data-art');
      return [];
    },
  };
  return el;
}
const app = mkEl('div');
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: t => mkEl(t),
  body: mkEl('div'), getElementById: id => (id === 'app' ? app : null),
};
globalThis.window = {};

const { STORY, ARCS } = await import('../js/xiuxian/story.js');
const { playArc } = await import('./helpers/play-arc.mjs');
const { Cult } = await import('../js/xiuxian/index.js');

let pass = 0, fail = 0; const RED = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; RED.push(n); console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

// 场景之间要拿到**全新的 Duel**:真实玩家刷新页面就是这个效果(cache-buster 让
// ESM 重新求值 duel.js,依赖走缓存)。只 resetDom() 的话 root 还指着上一个场景
// 的旧元素,监听器挂在没人引用的对象上 —— 那是假红,不是产品缺陷。
let _duelN = 0;
const loadDuel = async () => (await import(`../js/xiuxian/duel.js?n=${++_duelN}`)).Duel;

// 参照 duel-echo-regression:夹具只有外形是假的,结案状态是真的走出来的。
const mkS = (foeKey, opt = {}) => ({
  story: STORY.s,
  arcNames: Object.fromEntries(Object.keys(ARCS).map(k => [k, ARCS[k].name])),
  cfg: { foe: { key: foeKey, isNemesis: !!opt.nemesis, stronger: !!opt.stronger } },
  e: { realm: '结丹', line: '他动了。' },
});
/** 墨影的 boss 节点对手:与 ui.js:777 生产出来的 cfg 同形 */
const nemesisCfg = () => ({
  node: { type: 'boss' },
  hero: { name: '轩轩', img: 'h.jpg', realmIdx: 0 },
  foe: { key: 'moying', name: '墨影', title: '宿 敌', img: 'f.jpg', realmIdx: 2, stronger: false, isNemesis: true },
  onWin: () => {}, onLose: () => {},
});
/** 真跑一场,把**玩家实际看到的每一句开场对白**录下来 */
async function recordIntro(cfg, label) {
  resetDom();
  Cult.s.arts = { jianqi: 1 };                 // 有牌可打 ⇒ 开场跑完就停在技能栏,不往下打
  const Duel = await loadDuel();
  const seen = [];
  const orig = Duel.say;
  Duel.say = function (who, text, cb) {         // 录一手,再走真的 say(打字机/finishType 全是真跑)
    seen.push({ who, text });
    return orig.call(this, who, text, cb);
  };
  Duel.start(cfg);
  drain(label);
  Duel.say = orig;
  return { Duel, seen, lines: seen.map(x => x.text) };
}
const times = (arr, line) => arr.filter(x => x === line).length;

// 四句原文(与 duel.js 的 FOE/HERO_LINES_ECHO.moying 一一对应)
const NEM_FOE = `断剑冢里又添一块碑。这一块,写的是你的名字。`;
const NEM_HERO = `墨影。我们又见面了。`;
const ECHO = {
  1: { foe: `「空席。我刻了三百年的名字,最后自己坐上去了。」`, hero: `「……墨影。你的碑上,这次没有我的名字。」` },
  2: { foe: `「石将跪了。你替它把话说完了 —— 就没我什么事了。」`, hero: `「石将能下班了。你呢?」` },
};

console.log('\n=== [1] 实跑 foeLine/heroLine:非宿敌拿到的是 echo 句,不是骨架句也不是默认句 ===');
{
  playArc('tomb', 1);
  const S = mkS('heifeng');
  const Duel = await loadDuel();
  const foe = Duel.foeLine(S), hero = Duel.heroLine(S);
  console.log(`    heifeng 敌人台词 → ${foe}`);
  console.log(`    heifeng 主角台词 → ${hero}`);
  t('非宿敌的敌人台词就是 echo 句', foe === `「清路的不止我一个。但那条路,现在有人替我走了。」`, foe);
  t('非宿敌的主角台词就是 echo 句', hero === `「你清了那条路。现在轮到我走。」`, hero);
  t('拿到 echo 句而不是宿敌句', foe !== NEM_FOE && hero !== NEM_HERO);
  t('拿到 echo 句而不是敌人默认句',
    foe !== `「这条道是我清出来的。想走?先问我的剑。」` &&
    hero !== `「清路的不止你一个。」`);
  playArc('tomb', 2);
  t('path=2 换一套 echo 句', Duel.foeLine(mkS('heifeng')) !== foe, Duel.foeLine(mkS('heifeng')));
}

console.log('\n=== [2] 实跑:墨影宿敌 —— 结过 tomb 之后,四句真的进了玩家的屏幕 ===');
for (const path of [1, 2]) {
  playArc('tomb', path);
  const { Duel, seen, lines } = await recordIntro(nemesisCfg(), `墨影·tomb·path${path}`);
  console.log(`    path=${path} 玩家看到的开场:`);
  seen.forEach((b, i) => console.log(`      ${i + 1}. [${b.who}] ${b.text}`));
  t(`path=${path} · 宿敌骨架敌句仍在场(没被顶替)`, times(lines, NEM_FOE) === 1, `出现 ${times(lines, NEM_FOE)} 次`);
  t(`path=${path} · 宿敌骨架我句仍在场`, times(lines, NEM_HERO) === 1, `出现 ${times(lines, NEM_HERO)} 次`);
  t(`path=${path} · echo 敌句上屏且只说一次`, times(lines, ECHO[path].foe) === 1, `出现 ${times(lines, ECHO[path].foe)} 次`);
  t(`path=${path} · echo 我句上屏且只说一次`, times(lines, ECHO[path].hero) === 1, `出现 ${times(lines, ECHO[path].hero)} 次`);
  t(`path=${path} · 另一套 path 的 echo 句**没有**混进来`,
    !lines.includes(ECHO[path === 1 ? 2 : 1].foe) && !lines.includes(ECHO[path === 1 ? 2 : 1].hero));
  t(`path=${path} · 整段开场就是四拍(敌骨架/我骨架/敌回声/我回声)`,
    JSON.stringify(lines) === JSON.stringify([NEM_FOE, NEM_HERO, ECHO[path].foe, ECHO[path].hero]),
    JSON.stringify(lines));
  // 真跑出来的第二拍,必须就是 foeEchoLine/heroEchoLine 吐出来的那句
  const SS = { cfg: nemesisCfg(), story: STORY.s,
               arcNames: Object.fromEntries(Object.keys(ARCS).map(k => [k, ARCS[k].name])),
               e: { realm: '结丹', line: 'x', title: '墨影', hpMax: 100, hp: 100, dmg: 10 } };
  t(`path=${path} · foeEchoLine/heroEchoLine 返回的正是上屏那两句`,
    Duel.foeEchoLine(SS) === ECHO[path].foe && Duel.heroEchoLine(SS) === ECHO[path].hero,
    `${Duel.foeEchoLine(SS)} / ${Duel.heroEchoLine(SS)}`);
  t(`path=${path} · 骨架句仍然由 foeLine/heroLine 负责(第二拍不越权)`,
    Duel.foeLine(SS) === NEM_FOE && Duel.heroLine(SS) === NEM_HERO);
}

console.log('\n=== [3] 结 jiangu(另一条 watcher 线)也要能上屏 ===');
{
  playArc('jiangu', 2);
  const { lines } = await recordIntro(nemesisCfg(), '墨影·jiangu·path2');
  console.log(`    玩家看到的开场:${JSON.stringify(lines, null, 0)}`);
  t('jiangu 线也能把回声送进开场对白', lines.includes(ECHO[2].foe) && lines.includes(ECHO[2].hero));
}

console.log('\n=== [4] 没结过案的人:一句回声都不许多 ===');
{
  STORY.reset();
  const { Duel, lines } = await recordIntro(nemesisCfg(), '墨影·未结案');
  const SS = { cfg: nemesisCfg(), story: STORY.s,
               arcNames: Object.fromEntries(Object.keys(ARCS).map(k => [k, ARCS[k].name])),
               e: { realm: '结丹', line: 'x', title: '墨影', hpMax: 100, hp: 100 } };
  console.log(`    未结案的玩家看到的开场:${JSON.stringify(lines)}`);
  t('未结案 · 开场仍然只有骨架两句', JSON.stringify(lines) === JSON.stringify([NEM_FOE, NEM_HERO]), JSON.stringify(lines));
  t('未结案 · 第二拍返回 null(不硬塞)',
    Duel.foeEchoLine(SS) === null && Duel.heroEchoLine(SS) === null);
  t('未结案 · 骨架句没变', Duel.foeLine(SS) === NEM_FOE && Duel.heroLine(SS) === NEM_HERO);
}

console.log('\n=== [5] 去重:非宿敌的开场白已经说了 echo,第二拍不许再说一遍 ===');
{
  playArc('tomb', 1);
  const cfg = {
    node: { type: 'elite' }, hero: { name: '轩轩', img: 'h.jpg', realmIdx: 0 },
    foe: { key: 'heifeng', name: '黑风散修', title: '炼气中期', img: 'f.jpg', realmIdx: 0, stronger: false, isNemesis: false },
    onWin: () => {}, onLose: () => {},
  };
  const { lines } = await recordIntro(cfg, '黑风散修·tomb·path1');
  console.log(`    黑风散修的开场:${JSON.stringify(lines)}`);
  t('非宿敌的 echo 句只出现一次', times(lines, `「清路的不止我一个。但那条路,现在有人替我走了。」`) === 1,
    `出现 ${times(lines, `「清路的不止我一个。但那条路,现在有人替我走了。」`)} 次`);
  t('非宿敌不因为这次修复多出一拍', lines.length === 2, `拍了 ${lines.length} 句`);
}

console.log('\n=== [6] 门禁自检:判据在方向写反时必须报红 ===');
{
  // 6a 反事实:只喂「骨架两句」的对白流( = 把第二拍拿掉的旧世界)。
  //    「echo 上了屏」这个判据必须判它红 —— 否则本门禁会被两句骨架糊弄过去。
  const counterfactual = [NEM_FOE, NEM_HERO];
  t('6a·自检:只有骨架两句时,「echo 上屏」判据必须为 false',
    counterfactual.filter(l => l === ECHO[1].foe || l === ECHO[1].hero).length === 0 &&
    counterfactual.includes(NEM_FOE) && counterfactual.includes(NEM_HERO));
  // 6b 反事实:echo 说两遍时,「只说一次」判据必须为红
  const doubled = [NEM_FOE, NEM_HERO, ECHO[1].foe, ECHO[1].foe, ECHO[1].hero];
  t('6b·自检:同一句 echo 说两遍时,「恰好一次」判据必须为 false',
    times(doubled, ECHO[1].foe) === 2 && doubled.filter(l => l === ECHO[1].foe).length !== 1);
  // 6c 桩自检:querySelectorAll 必须每次返回同一批**活**节点。
  //    现造新节点 ⇒ duel.js 挂的监听器挂在没人引用的对象上(AUTONOMY.md §3.4)。
  const host = reg('#xd-defeat');
  host.innerHTML = '<div class="xx-chio" data-c="resist"></div><div class="xx-chio" data-c="ruin"></div>';
  t('6c·自检:DOM 桩的 querySelectorAll 每次返回同一批节点引用',
    host.querySelectorAll('.xx-chio')[0] === host.querySelectorAll('.xx-chio')[0]);
  // 6d 桩自检:clearTimeout 必须真的生效,否则回调会被调两遍
  let fired = 0;
  const id = setTimeout(() => { fired++; }, 10);
  clearTimeout(id);
  drain('6d');
  t('6d·自检:假时钟响应 clearTimeout(否则测的是一个不存在的世界)', fired === 0, `回调触发了 ${fired} 次`);
}

console.log('');
if (fail === 0) {
  console.log(`✅ 墨影回声可达性通过:${pass} 项(四句真的上屏,骨架一字未改)`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} 项不达标 —— 回声仍然到不了玩家眼前`);
  for (const r of RED) console.log(`   - ${r}`);
  process.exit(1);
}
