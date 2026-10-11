// debt-and-nemesis-wiring.mjs —— 工单 XX-QA-066 的门禁
//
// 这条工单登记时写的是两条同型的洞,**都是「文案在承诺,机制没接上」**:
//
//   ① DEFEAT.settleDebt() 全仓**零调用点**。
//      玩家在战败面板点「暂缓」,DEFEAT.apply 真的把 s.debt 写进了存档,
//      面板也真的写着「欠下 300 道行,三年为期。到期不还,后果自负。」
//      —— 但「到期」这件事根本不存在:s.debt 只有 { total, left },没有到期日,
//      而那个唯一该来收账的函数一次都没被调用过。
//      结果:玩家背了一笔**永远不用还、也不能赖**的债。
//   ② Nemesis.battle('lose') 结构上不可达(见下面 [5] 段)。
//
// 这道门禁只钉 ①(债),② 只登记现状、不假装修好 —— 修它要动 duel.js,不是本工单的。
//
// 出处可复现:node tests/debt-and-nemesis-wiring.mjs
// 退出码:0 = 通过;非 0 = 不通过
//
// 【为什么要带反向注入自检】
//   本项目铁律:度量工具自己出错比没有度量工具更危险。这道门禁的核心断言
//   全靠「把实现改坏,看它会不会红」来证明自己不是恒真:
//   门禁在注入时没红,它就不存在(哪怕它平时全绿)。所以 [6] 段会在
//   relations.js 上真的注入三种缺陷、确认变红、再逐字节还原。
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join as _jn } from 'path';
import { codeMask, methodBody } from './lib-uimod.mjs';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const REL = 'js/xiuxian/relations.js';
const REL_PATH = _jn(ROOT, REL);
const R = p => readFileSync(_jn(ROOT, p), 'utf8');

// localStorage 要**真的存得住**,不能像有的门禁那样写成空壳:
// Nemesis.save() / Titles.save() 都要往里写,而 Nemesis 的 grudge 是
// 「债到期有没有被收」的一条直接证据 —— 桩存不住就等于没验证落盘。
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
  _mem: mem,
};
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null };
globalThis.window = { addEventListener() {} };

const mod = await import('../js/xiuxian/relations.js');
const { CLOCK, CLOCK_CONST } = await import('../js/xiuxian/clock.js');
const { REALMS } = await import('../js/xiuxian/realms.js');

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

// ---------- 共用夹具 ----------
const TERM = 3 * CLOCK_CONST.DAYS_PER_YEAR;   // 「三年为期」,与 relations.js 同口径
const BASE_IDX = Math.min(2, REALMS.length - 1);
const realmIdx = id => REALMS.findIndex(r => r.id === id);
/** 时间归零:债的到期日是从 CLOCK 推出来的,不同起点测就等于没测 */
const resetTime = () => { CLOCK.s = { ms: 0, totalMs: 0, actions: 0, lastSeen: 0, year: 1, day: 0 }; };
const advanceDays = n => CLOCK.advanceReal(n * CLOCK_CONST.DAY_MS);
const mkCult = M => ({ titles: M.Titles, commits: 0, commit() { this.commits++; } });
const freshState = (o = {}) => ({ realm: REALMS[BASE_IDX].id, layer: 5, exp: 500, dao: 1000, debt: null, ...o });
const demonOf = M => M.Titles.s.flags.demon || 0;

/**
 * 核心断言集 —— **同一份**同时喂给正常跑和反向注入跑。
 * 分成两个函数抄一遍的话,注入测的就不是真正在跑的那组断言了,
 * 那种「自检」证明不了任何事。
 * @returns {Array<{n:string, ok:boolean, d:string}>}
 */
function coreChecks(M) {
  const res = [];
  const T = (n, c, d = '') => { res.push({ n, ok: !!c, d: c ? '' : d }); return !!c; };
  // 注入的缺陷**很可能让被测代码直接抛错**(反向写到期判断就会)。
  // 如果不兜住,一次注入就会把整道门禁带崩 —— 那不是"门禁报红",
  // 是"门禁中途死了",后面的注入一条也测不到。所以每个场景独立 try。
  const scene = (label, fn) => {
    try { fn(); }
    catch (e) { res.push({ n: `场景「${label}」能跑完`, ok: false, d: `抛错:${e.message}` }); }
  };

  // ── 三条分支:还清 / 部分还 / 一分没有,效果都要真落到存档 ──
  scene('还清', () => {
    resetTime(); M.Titles.reset(); M.Nemesis.reset();
    const cult = mkCult(M);
    const s = freshState({ dao: 300, debt: { total: 300, left: 300, dueDay: 0 } });
    const d0 = demonOf(M);
    const r = M.DEFEAT.settleIfDue(s, cult);
    T('还清:settleIfDue 给出 ok:true', r && r.ok === true, `返回 ${JSON.stringify(r)}`);
    T('还清:道行真被收走(300→0)', s.dao === 0, `s.dao=${s.dao} —— 「还了钱」如果没扣钱就是空话`);
    T('还清:债被销掉', s.debt === null, `s.debt=${JSON.stringify(s.debt)}`);
    T('还清:入魔 −10', demonOf(M) - d0 === -10, `delta=${demonOf(M) - d0}`);
    T('还清:授予「不逃」称号', M.Titles.s.active.includes('buniao'), `active=${JSON.stringify(M.Titles.s.active)}`);
  });
  scene('部分还', () => {
    resetTime(); M.Titles.reset(); M.Nemesis.reset();
    const cult = mkCult(M);
    const s = freshState({ dao: 120, debt: { total: 300, left: 300, dueDay: 0 } });
    const d0 = demonOf(M), g0 = M.Nemesis.s.grudge;
    const r = M.DEFEAT.settleIfDue(s, cult);
    T('部分还:ok:false(没还清就不算还清)', r && r.ok === false, `返回 ${JSON.stringify(r)}`);
    T('部分还:能掏的 120 全部扣掉', s.dao === 0, `s.dao=${s.dao}`);
    T('部分还:入魔 +12', demonOf(M) - d0 === 12, `delta=${demonOf(M) - d0}`);
    T('部分还:宿敌怨念 +10(不是塞进没人读的返回值)', M.Nemesis.s.grudge - g0 === 10, `grudge delta=${M.Nemesis.s.grudge - g0}`);
    T('部分还:债已销掉(不会下帧再收一次)', s.debt === null, `s.debt=${JSON.stringify(s.debt)}`);
  });
  scene('一分没有', () => {
    resetTime(); M.Titles.reset(); M.Nemesis.reset();
    const cult = mkCult(M);
    const before = realmIdx(REALMS[BASE_IDX].id);
    const s = freshState({ dao: 0, debt: { total: 300, left: 300, dueDay: 0 } });
    const d0 = demonOf(M);
    const r = M.DEFEAT.settleIfDue(s, cult);
    T('一分没有:ok:false', r && r.ok === false, `返回 ${JSON.stringify(r)}`);
    T('一分没有:真跌了一境(不是把方向写反的「升一境」)',
      realmIdx(s.realm) === before - 1, `${REALMS[before].id} → ${s.realm}`);
    T('一分没有:修为清零', s.exp === 0, `exp=${s.exp}`);
    T('一分没有:入魔 +20', demonOf(M) - d0 === 20, `delta=${demonOf(M) - d0}`);
    T('一分没有:债已销掉', s.debt === null, `s.debt=${JSON.stringify(s.debt)}`);
  });

  // ── 到期前不收 / 到期后收 / 只收一次(走真实的 apply() 建债路径)──
  scene('到期线', () => {
    resetTime(); M.Titles.reset(); M.Nemesis.reset();
    const cult = mkCult(M);
    const s = freshState({ dao: 1000 });
    M.DEFEAT.apply('installment', '石像守卫', s, cult);
    T('「暂缓」真的写进一笔带到期日的债',
      !!s.debt && s.debt.total === 300 && s.debt.left === 300 && s.debt.dueDay === TERM,
      `s.debt=${JSON.stringify(s.debt)}(TERM=${TERM})—— 没有 dueDay 就还是原来那个还不清的债`);

    advanceDays(TERM - 0.5);                       // 差半天到期
    const daoMid = s.dao, dMid = demonOf(M), gMid = M.Nemesis.s.grudge;
    const early = M.DEFEAT.settleIfDue(s, cult);
    T('到期前不会被收走', early === null, `提前 ${TERM - CLOCK.absoluteDay()} 天就被收了`);
    T('到期前存档一个字节都没动',
      s.debt !== null && s.dao === daoMid && demonOf(M) === dMid && M.Nemesis.s.grudge === gMid,
      `debt=${JSON.stringify(s.debt)} dao=${s.dao} demon=${demonOf(M)} grudge=${M.Nemesis.s.grudge}`);

    advanceDays(0.5);                             // 正好到期
    const due = M.DEFEAT.settleIfDue(s, cult);
    T('到期后真的被收走', due !== null && due.ok === true, `返回 ${JSON.stringify(due)}`);
    T('到期后债确实销掉了', s.debt === null, `s.debt=${JSON.stringify(s.debt)}`);

    // 只收一次:再调两次,存档必须纹丝不动
    const daoAfter = s.dao, dAfter = demonOf(M), gAfter = M.Nemesis.s.grudge, grAfter = REALMS[realmIdx(s.realm)].id;
    const again1 = M.DEFEAT.settleIfDue(s, cult);
    const again2 = M.DEFEAT.settleIfDue(s, cult);
    T('第二次调用不再收账', again1 === null, `又返回了 ${JSON.stringify(again1)}`);
    T('第三次调用同样不再收账', again2 === null, `又返回了 ${JSON.stringify(again2)}`);
    T('重复调用没有重复扣款(道行/入魔/怨念/境界全不变)',
      s.dao === daoAfter && demonOf(M) === dAfter && M.Nemesis.s.grudge === gAfter
      && REALMS[realmIdx(s.realm)].id === grAfter,
      `dao ${daoAfter}→${s.dao} demon ${dAfter}→${demonOf(M)} grudge ${gAfter}→${M.Nemesis.s.grudge} realm→${s.realm}`);

    // 再打一仗也不该把旧账又收一遍
    M.DEFEAT.apply('ransom', '石像守卫', s, cult);
    T('之后随便再战败一次也不会重复收旧账', s.debt === null && demonOf(M) === dAfter,
      `debt=${JSON.stringify(s.debt)} demon=${demonOf(M)}(应为 ${dAfter})`);
  });

  // ── 旧存档 / 残缺存档不崩 ──
  scene('旧存档', () => {
    resetTime(); M.Titles.reset(); M.Nemesis.reset();
    const cult = mkCult(M);
    const legacy = freshState({ dao: 300, debt: { total: 300, left: 300 } });   // 没有 dueDay 的老存档
    const d0 = demonOf(M);
    let threw = null, out = null;
    try { out = M.DEFEAT.settleIfDue(legacy, cult); } catch (e) { threw = e.message; }
    T('旧存档(无 dueDay)不崩', threw === null, `抛错:${threw}`);
    // 断言消息里不能直接解引用 legacy.debt —— 到期判断写反时它会当场被销成 null,
    // 那样门禁会「崩」而不是「红」,反而看不出是哪条不对。
    T('旧存档不被追溯判死 —— 补一个完整期限',
      out === null && !!legacy.debt && legacy.debt.dueDay === TERM,
      `返回 ${JSON.stringify(out)},dueDay=${legacy.debt ? legacy.debt.dueDay : '(债已被收走)'}(应为 ${TERM})`);
    T('旧存档补期限时不动玩家的任何数值', legacy.dao === 300 && demonOf(M) === d0,
      `dao=${legacy.dao} demon=${demonOf(M)}(应为 ${d0})`);

    // 一堆畸形存档:不许抛、不许凭空收账
    for (const [label, bad] of [
      ['debt 为 null', null],
      ['debt 为 {}', {}],
      ['total/left 是字符串、dueDay 是 NaN', { total: 'x', left: -5, dueDay: NaN }],
      ['left 是 null', { total: 300, left: null, dueDay: 0 }],
    ]) {
      resetTime();
      const s2 = freshState({ debt: bad });
      let err = null;
      try { M.DEFEAT.settleIfDue(s2, mkCult(M)); } catch (e) { err = e.message; }
      T(`畸形存档不崩:${label}`, err === null, `抛错:${err}`);
    }
  });
  return res;
}

// ═══════════════════════ [0] 工具自检 ═══════════════════════
console.log('\n=== [0] 工具自检(证明下面的断言不是恒真) ===');
{
  // 方向性约定 ①:到期判定是「now < dueDay 才没到期」。
  //   如果我把方向写成「now > dueDay 才没到期」,下面 [2][3] 的结论会**正好相反** ——
  //   所以先证明两种判定在期中点上的结论确实不同(否则那些断言可能是恒真的)。
  const mid = TERM - 0.5;
  t('【自检】时间方向可分辨:「<」与「>」在期中点结论相反',
    (mid < TERM) !== (mid > TERM),
    '两种判定在测试点上结论相同 —— 说明我挑的测试点分辨不出方向,后面的到期断言无效');

  // 方向性约定 ②:代价轴「入魔值越大越糟」。用两条语义上无争议的分支反查方向。
  resetTime(); mod.Titles.reset(); mod.Nemesis.reset();
  const cult = mkCult(mod);
  const sPaid = freshState({ dao: 300, debt: { total: 300, left: 300, dueDay: 0 } });
  mod.DEFEAT.settleIfDue(sPaid, cult);
  const dClear = demonOf(mod);
  resetTime(); mod.Titles.reset(); mod.Nemesis.reset();
  const sNone = freshState({ dao: 0, debt: { total: 300, left: 300, dueDay: 0 } });
  mod.DEFEAT.settleIfDue(sNone, mkCult(mod));
  const dNone = demonOf(mod);
  t('【自检】代价方向对:还清降入魔、赖账升入魔(符号相反且都非零)',
    dClear < 0 && dNone > 0,
    `还清→${dClear},赖账→${dNone} —— 两者同号说明「入魔越大越糟」这个前提被写反了`);

  // 方向性约定 ③:钱是**减法**。守恒:收账后 dao 减少量恰等于本次还的 paid。
  resetTime(); mod.Titles.reset(); mod.Nemesis.reset();
  const sPart = freshState({ dao: 120, debt: { total: 300, left: 300, dueDay: 0 } });
  const before = sPart.dao;
  mod.DEFEAT.settleIfDue(sPart, mkCult(mod));
  t('【自检】钱的方向对:收账是减不是加(s.dao + 减少量 === 原值)',
    sPart.dao + (before - sPart.dao) === before && sPart.dao < before,
    `before=${before} after=${sPart.dao} —— 若 after > before,「还钱」是在给玩家发钱`);

  t('【自检】核心断言集本身非空', coreChecks(mod).length >= 20,
    `只有 ${coreChecks(mod).length} 条 —— 覆盖不到三条分支`);
}

// ═══════════════════════ [1]-[4] 债 ═══════════════════════
console.log('\n=== [1] 三条分支 / [2] 到期前 / [3] 只收一次 / [4] 旧存档 ===');
for (const r of coreChecks(mod)) t(r.n, r.ok, r.d);

// ═══════════════════════ [5] 静态接线 ═══════════════════════
console.log('\n=== [5] 静态接线:效果确实走的是那两条函数(不是各写各的) ===');
{
  const CODE = codeMask(R(REL)).code;
  const bodySettle = methodBody('settleIfDue', CODE);
  const bodyApply = methodBody('apply', CODE);
  const bodySettleDebt = methodBody('settleDebt', CODE);
  const bodyOpen = methodBody('_openDebt', CODE);

  t('settleIfDue 真的调 settleDebt', /this\.settleDebt\(\s*s\s*,\s*paid\s*\)/.test(bodySettle),
    '三段文案的判定被绕开了 —— settleDebt 又变回零调用点的死函数');
  t('settleIfDue 用销账(s.debt = null)保证「只收一次」', /s\.debt\s*=\s*null/.test(bodySettle),
    '没有销账,同一个存档会被反复收账');
  t('settleDebt 比的是 left 而不是 total',
    /\bleft\b/.test(bodySettleDebt) && !/paid\s*>=\s*s\.debt\.total/.test(bodySettleDebt),
    '拿本次付款比原始总额 → 分两次还的债永远还不清');
  t('_openDebt 给新债写死 dueDay', /dueDay\s*:/.test(bodyOpen),
    '新开的债没有到期日 —— 「三年为期」又是一句空话');
  t('apply 先清旧账再结算新选项', /this\.settleIfDue\(\s*s\s*,\s*cult\s*\)/.test(bodyApply),
    '战败面板点了「暂缓」之后,旧账永远没有结算入口');
  t('relations.js 依赖 CLOCK 取到期日(单一时间真源)',
    /from '\.\/clock\.js'/.test(R(REL)) && /CLOCK\.absoluteDay\(\)/.test(CODE),
    '债用了另一套计时 —— clock.js 刚把四套计时合并成一套,别再加第五套');
}

// ═══════════════════════ [6] 宿敌 ═══════════════════════
console.log('\n=== [6] 宿敌:lose 半边的行为 + 调用点现状登记 ===');
{
  mod.Nemesis.reset();
  mod.Nemesis.battle('win');
  const afterWin = { ...mod.Nemesis.s };
  mod.Nemesis.battle('lose');
  const afterLose = { ...mod.Nemesis.s };

  t('battle("lose") 会让宿敌更恨(grudge +35)',
    afterLose.grudge - afterWin.grudge === 35,
    `delta=${afterLose.grudge - afterWin.grudge}`);
  t('battle("lose") 不算赢(wins 不动)', afterLose.wins === afterWin.wins,
    `wins ${afterWin.wins}→${afterLose.wins}`);
  t('battle 真的落盘了', JSON.parse(localStorage.getItem('xx_nemesis_v077') || '{}').grudge === afterLose.grudge,
    'grudge 只进了内存,重启就丢 —— powerBoost() 跨局读到的是旧值');
  t('【自检】方向对:打不过比打赢涨得更狠(35 > 20)',
    (afterLose.grudge - afterWin.grudge) > 20,
    '若「输」涨得比「赢」少,宿敌的怨恨模型就是反的');
  t('met/battles/wins/alive 仍留在默认存档里',
    ['met', 'battles', 'wins', 'alive'].every(k => k in mod.Nemesis.s),
    '删掉它们会让 tests/save-integrity-audit.mjs:84 的 CONTRACTS 报「缺字段」');

  // 已知缺口:**如实登记**,不假装修好。
  // ⚠️ 这里必须读**原文**而不是 codeMask():codeMask 会把字符串字面量整个抹掉,
  //   抹完 `battle('win')` 变成 `battle(     )`,正则永远匹配不上 —— 我第一版就栽在这儿,
  //   报了一条「片段提取失效」的假红。这里只剥 // 注释,保留字符串。
  const duelRaw = R('js/xiuxian/duel.js');
  const duelSrc = duelRaw.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  const args = [...duelSrc.matchAll(/nemesis\.battle\(\s*'([^']*)'\s*\)/g)].map(m => m[1]);
  t('【已知缺口登记】duel.js 目前只传 "win"', args.length > 0 && args.every(a => a === 'win'),
    args.length > 0
      ? `现在传的是 ${JSON.stringify(args)} —— duel.js 被改成传 'lose' 了,请同步把本门禁改成断言「lose 分支可达」并撤掉这句`
      : 'duel.js 里找不到 nemesis.battle( 调用点 —— 片段提取失效,本段结论不可信');
}

// ═══════════════════════ [7] 反向注入自检 ═══════════════════════
console.log('\n=== [7] 反向注入自检:注入缺陷 → 必须变红 → 逐字节还原 ===');
{
  const INJECTIONS = [
    { name: '删掉 settleDebt 调用', from: 'const r = this.settleDebt(s, paid);', to: "const r = { ok:false, text:'(注入)', effect:{} };" },
    { name: '把到期判断写反', from: 'if (now < s.debt.dueDay) return null;', to: 'if (now > s.debt.dueDay) return null;' },
    { name: '让它重复扣款(不销账)', from: 's.debt = null;', to: '/* 注入:故意不销账 */' },
  ];
  for (const inj of INJECTIONS) {
    const backup = readFileSync(REL_PATH, 'utf8');
    let msg = '', okAll = false;
    try {
      const polluted = backup.replace(inj.from, inj.to);
      if (polluted === backup) {
        msg = `注入锚点没命中(源码已变)—— 这一项的自检作废`;
      } else {
        writeFileSync(REL_PATH, polluted);
        const M = await import(`../js/xiuxian/relations.js?inj=${encodeURIComponent(inj.name)}`);
        const bad = coreChecks(M).filter(r => !r.ok);
        okAll = bad.length > 0;
        msg = okAll
          ? `红了 ${bad.length} 条,例如「${bad[0].n}」`
          : '❌ 注入后门禁全绿 —— 这道门禁测不到这个缺陷';
      }
    } finally {
      writeFileSync(REL_PATH, backup);
    }
    const restored = readFileSync(REL_PATH, 'utf8') === backup;
    t(`注入「${inj.name}」→ 必须红`, okAll, msg);
    t(`注入「${inj.name}」→ 已还原`, restored,
      '还原校验失败 —— 工作区被污染了,必须先修好再跑任何别的东西');
  }
}

if (fail === 0) {
  console.log(`\n✅ XX-QA-066 通过:${pass} 项(债到期会收、只收一次、旧档不崩、注入必红)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 债务仍是还不掉的死数据,或门禁自身失效`);
  process.exit(1);
}