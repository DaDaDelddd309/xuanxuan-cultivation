// Duel 结局分支测试 —— 工单 XX-NET-002
// 运行: node tests/duel-echo-regression.mjs
//
// 背景:XX-NET-001 把「结案」变成了流言(放射状→网状),但真到单挑时
// 墨影依然只会说「你不该来」—— 他不会提起碑上多了什么。
// 台词只按「敌人是谁」分,完全不看玩家结过什么案。
//
// 本工单让 foeLine / heroLine 读 STORY.s.done。
// 断言的是「结案 → 台词真的变了」这条链,以及**不该被覆盖时确实没被覆盖**。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.document = { addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: { appendChild() {} }, getElementById: () => null };
globalThis.window = {};

const { STORY, ARCS } = await import('../js/xiuxian/story.js');
const { Duel } = await import('../js/xiuxian/duel.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

/** 真实走完一条线并结案,不留任何注入状态 */
function playArc(key, path) {
  const arc = ARCS[key];
  STORY.reset();
  STORY.start(key);
  for (const b of arc.beats) {
    if (b.room) STORY.arriveRoom(b.room);
    else STORY.arrive(b.node);
  }
  return STORY.finish(key, path, () => ({ text: [] }));
}

/**
 * 造一个与 start() 同构的 S。
 * ⚠️ story / arcNames 用的是**真** STORY.s 与真 ARCS —— 只有外形是夹具,
 * 结局状态是真的走出来的。start() 里那两行是否真的被赋值,另由源码契约断言兜住。
 */
function mkS(foeKey, opt = {}) {
  return {
    story: STORY.s,
    arcNames: Object.fromEntries(Object.keys(ARCS).map(k => [k, ARCS[k].name])),
    cfg: { foe: { key: foeKey, isNemesis: !!opt.nemesis, stronger: !!opt.stronger } },
    e: { realm: '结丹', line: '他动了。' },
  };
}

// ————— 1. 没结案时,台词一个字都不能变 —————
// ⚠️ 必须在**任何结案之前**把默认台词存下来。
//    早先的写法是打完结案再拿 mkS(k) 当对照组 —— 但 mkS 读的是同一个
//    STORY.s,两边都是回声版,永远相等。这条断言当时是废的。
let DEFAULTS = {};
{
  STORY.reset();
  DEFAULTS = Object.fromEntries(['moying', 'heifeng', 'shougu', 'youfang']
    .map(k => [k, { foe: Duel.foeLine(mkS(k)), hero: Duel.heroLine(mkS(k)) }]));
  ok('未结案 · 墨影台词是默认那句', DEFAULTS.moying.foe === '「你不该来。」', DEFAULTS.moying.foe);
  ok('未结案 · 主角台词是默认那句',
     DEFAULTS.moying.hero === '「……这名字,我不该记得。」', DEFAULTS.moying.hero);
  for (const k of Object.keys(DEFAULTS)) {
    ok(`未结案 · ${k} 有默认台词`, !!DEFAULTS[k].foe && !!DEFAULTS[k].hero);
  }
}

// ————— 2. 结案后,四个宿敌台词都要变 —————
{
  playArc('tomb', 1);
  for (const k of ['moying', 'heifeng', 'shougu', 'youfang']) {
    const S = mkS(k);
    const line = Duel.foeLine(S);
    const hero = Duel.heroLine(S);
    ok(`结案后 ${k} 敌人台词改写`, line !== DEFAULTS[k].foe, `${DEFAULTS[k].foe} → ${line}`);
    ok(`结案后 ${k} 主角台词改写`, hero !== DEFAULTS[k].hero, `${DEFAULTS[k].hero} → ${hero}`);
  }
}

// ————— 3. 两种结局 → 两套台词 —————
{
  playArc('tomb', 1); const p1 = Duel.foeLine(mkS('moying'));
  playArc('tomb', 2); const p2 = Duel.foeLine(mkS('moying'));
  ok('tomb 结局1 ≠ 结局2 的敌人台词', p1 !== p2, `${p1} vs ${p2}`);
  playArc('tomb', 1); const h1 = Duel.heroLine(mkS('moying'));
  playArc('tomb', 2); const h2 = Duel.heroLine(mkS('moying'));
  ok('tomb 结局1 ≠ 结局2 的主角台词', h1 !== h2, `${h1} vs ${h2}`);
}

// ————— 4. 宿敌 / 越级 那两句是调性骨架,不能被结局覆盖 —————
{
  playArc('tomb', 1);
  ok('宿敌开场白优先于结局分支',
     Duel.foeLine(mkS('moying', { nemesis: true })) === '断剑冢里又添一块碑。这一块,写的是你的名字。');
  ok('宿敌主角台词优先于结局分支',
     Duel.heroLine(mkS('moying', { nemesis: true })) === '墨影。我们又见面了。');
  ok('越级台词优先于结局分支',
     Duel.heroLine(mkS('heifeng', { stronger: true })) === '……差了一整个大境。但路是我自己选的。');
}

// ————— 5. 非宿敌不该被结局波及 —————
{
  playArc('tomb', 1);
  ok('普通小妖台词不受结局影响',
     Duel.foeLine(mkS('wanderer')) === '他动了。你退了半步,又站住了。');
  ok('普通小妖主角台词不受结局影响',
     Duel.heroLine(mkS('wanderer')) === '既然你要拦,那就别怪我不留情。');
}

// ————— 6. 没结 tomb 的线不该触发(剑骨线不算) —————
{
  playArc('hongyi', 1);
  const S = mkS('moying');
  const line = Duel.foeLine(S);
  ok('只结了红嫁衣不该惊动墨影', !line.includes('碑'), line);
}

// ————— 7. 台词仍然短句(守住 duel 的既有调性) —————
{
  playArc('tomb', 1);
  for (const k of ['moying', 'heifeng', 'shougu', 'youfang']) {
    ok(`${k} 敌人台词仍 < 40 字`, Duel.foeLine(mkS(k)).length < 40, Duel.foeLine(mkS(k)));
    ok(`${k} 主角台词仍 < 40 字`, Duel.heroLine(mkS(k)).length < 40, Duel.heroLine(mkS(k)));
  }
}

// ————— 8. 接线契约:S.story 真的在开打前抓了快照 —————
{
  const src = readFileSync(ROOT + '/js/xiuxian/duel.js', 'utf8');
  ok('duel.js 引入 STORY', /import\s*\{[^}]*STORY[^}]*\}\s*from\s*'\.\/story\.js'/.test(src));
  ok('start() 里给 S 赋了 story 快照', /story:\s*STORY\.s/.test(src));
  ok('start() 里给 S 赋了 arcNames', /arcNames:/.test(src));
}

console.log(`\nDuel 结局分支: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项:\n  - ' + failed.join('\n  - ')); process.exit(1); }