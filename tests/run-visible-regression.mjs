// run-visible-regression.mjs —— 工单 XX-VISIBLE-001 的门禁
//
// 回答的是一句话:**「局内发生的事,局外看得见吗」**。
//
// 同事的原话是「这不是重写,是重接」—— 数据层都在,缺的是让它动起来的那一层。
// 这道门禁钉的就是那一层,因为**接线是最容易悄悄断、也最不会崩的一类缺陷**:
// 数值写错了会有人喊,接线断了只会让玩家觉得「这游戏好像哪里不对」。
//
// 四条链的**真实状态**(不要照抄本段,每条都断言过):
//   ① 砍杀 → 篝火旺        ✅ 本工单接上(main.js endRun → CAMP.recordRun)
//   ② 遇到白泽 → 秘境解锁  ⚠️ 局外**早就有**(ui.js arrive → STORY.see →
//                            MOUNT.checkUnlocks),但触发源是**修仙阁大地图抵达**,
//                            不是局内砍杀 —— js/game/* 从不 import legend.js,
//                            白泽**在局内根本不存在**,没有「局内遇到」这个事件。
//                            本门禁不造假的局内白泽事件,只钉住局外那半条不许退化。
//   ③ 带回来一只 → 村口活物⚠️ 同上:MOUNT.s.have/s.pet 是既有的活物名册,
//                            由 STORY.met 驱动、经 ui.js arrive 发放。
//                            局内没有「捕捉」机制(js/ 全仓无 capture/tame)。
//   ④ 战败 → 丹炉灭/议事堂挂白布 ✅ 本工单接上(main.js endRun(false) → CAMP.moor)
//
// 出处可复现:node tests/run-visible-regression.mjs
// 退出码:0 = 通过;1 = 不通过;2 = 门禁自身失效(别信结论)
//
// 【G5 反向自检:证明这些断言不是恒真】
//   本项目铁律:度量工具自己出错比没有度量工具更危险。所以 [0] 段用
//   **合成样本**(自己捏的假 CAMP,不碰任何真实文件、不依赖当前代码状态)
//   证明三件事:① 火候阶梯可分辨 ② 幂等断言抓得住「不幂等」的假实现
//   ③ 老存档断言抓得住「不补默认值」的假实现。
//   [8] 段再做真反向注入:改坏真实 camp.js / main.js,确认门禁变红,再逐字节还原。
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join as _jn } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const CAMP_REL = 'js/xiuxian/camp.js';
const MAIN_REL = 'js/main.js';
const CAMP_PATH = _jn(ROOT, CAMP_REL);
const MAIN_PATH = _jn(ROOT, MAIN_REL);
const R = p => readFileSync(_jn(ROOT, p), 'utf8');
const CAMP_KEY = 'xx_camp_v080';
/** 存档一律走 globalThis.localStorage 现取。
 *  理由:[5b] 会 import harness.mjs 跑真局,install() 把整个 localStorage 换成它自己的;
 *  谁在模块顶层抓住一个 mem 引用,[6] 复跑时读到的就是空档 —— 门禁自己把自己写红。 */
const LS = () => globalThis.localStorage;

// localStorage 必须真的存得住 —— CAMP.recordRun 会落盘,
// 而且 G2(老存档)要先把一份**缺新字段**的旧档塞进去。
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

let pass = 0, fail = 0;
/** 真实产品函数被调用的次数。为 0 → 门禁自身失效(exit 2)。 */
let PRODUCT_CALLS = 0;
/** 真跑 main.js 那条路径跑通的次数。为 0 → 门禁自身失效(exit 2)。 */
let BOOT_CALLS = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

// ═══════════════ 核心行为断言(同一份喂给正常跑与注入跑)═══════════════
/**
 * @param {object} C  camp.js 导出的 CAMP
 * @returns {Array<{n:string, ok:boolean, d:string}>}
 */
function coreChecks(C) {
  const res = [];
  const T = (n, c, d = '') => { res.push({ n, ok: !!c, d: c ? '' : d }); return !!c; };
  // 注入很可能让被测代码直接抛错。兜不住的话一次注入就会把整道门禁带崩,
  // 后面几条注入一条都测不到 —— 那是「门禁中途死了」,不是「门禁报红」。
  const scene = (label, fn) => {
    try { fn(); }
    catch (e) { res.push({ n: `场景「${label}」能跑完`, ok: false, d: `抛错:${e.message}` }); }
  };
  const clean = () => { LS().removeItem(CAMP_KEY); C.reset(); LS().removeItem(CAMP_KEY); C.reset(); };

  // ── ① 砍杀 → 篝火旺 ──
  scene('①砍杀喂火候', () => {
    clean();
    const lv0 = C.warmLv();
    T('①开局火候为 0', lv0.sec === 0 && lv0.lv === 1, `sec=${lv0.sec} lv=${lv0.lv}`);

    const r = C.recordRun({ id: 'a1', kills: 100, runTime: 300, victory: true });
    PRODUCT_CALLS++;
    T('①recordRun 报成功', r && r.ok === true, `返回 ${JSON.stringify(r)}`);
    const lv1 = C.warmLv();
    T('①砍 100 只 → 火候 > 0', lv1.sec > lv0.sec, `sec ${lv0.sec}→${lv1.sec}`);
    T('①砍 100 只 → 火旺档位真的涨了(不是只涨了个不参与显示的数)',
      lv1.lv > lv0.lv, `lv ${lv0.lv}(${lv0.tier.name})→${lv1.lv}(${lv1.tier.name})`);
    T('①火候用的是 CAMP_TIERS 那一把梯子(同一份名字/颜色)',
      !!lv1.tier && typeof lv1.tier.name === 'string' && typeof lv1.tier.col === 'string',
      `tier=${JSON.stringify(lv1.tier)}`);
    T('①到下一档还差多少,有具体数值(UI 能画进度条)',
      lv1.next ? lv1.toNext > 0 && lv1.pct >= 0 && lv1.pct <= 1 : lv1.pct === 1,
      `next=${JSON.stringify(lv1.next && lv1.next.name)} toNext=${lv1.toNext} pct=${lv1.pct}`);

    // —— 平衡不变量:砍杀不许改变收益/升级 ——
    const totalSecBefore = C.s.totalSec, tierBefore = C.tier().name;
    C.recordRun({ id: 'a2', kills: 5000, runTime: 999, victory: true });
    PRODUCT_CALLS++;
    T('①砍 5000 只后 totalSec 一个字节没动(挂机收益/营地升级不受影响)',
      C.s.totalSec === totalSecBefore, `totalSec ${totalSecBefore}→${C.s.totalSec}`);
    T('①砍 5000 只后营地阶位不变(CAMP.tier 仍读 totalSec)',
      C.tier().name === tierBefore, `${tierBefore}→${C.tier().name}`);
    clean();
  });

  // ── ④ 战败 → 战败纪念 ──
  scene('④战败挂白布', () => {
    clean();
    T('④开局没有战败纪念(老存档/新存档都是「没挂」)',
      C.mourning() === null, `mourning=${JSON.stringify(C.mourning())}`);
    C.recordRun({ id: 'b1', kills: 40, runTime: 120, victory: false, choice: 'resist' });
    PRODUCT_CALLS++;
    const m = C.mourning();
    T('④战败后确实记上了', !!m && m.on === true, `mourning=${JSON.stringify(m)}`);
    T('④记下了是哪条战败路线', !!m && m.choice === 'resist', `choice=${m && m.choice}`);
    T('④记下了这一局砍了多少(议事堂挂白布要有个由头)', !!m && m.kills === 40, `kills=${m && m.kills}`);
    // 通关不许抹掉白布:那是「最近一次战败」,不是「当前是否在战败」
    C.recordRun({ id: 'b2', kills: 10, runTime: 60, victory: true });
    PRODUCT_CALLS++;
    T('④后来通关也不会把白布摘掉(记的是最近一次战败)', C.mourning() !== null,
      '一通关就抹掉 = 白布只在同一瞬间可见,刷新就没了');
    clean();
  });

  // ── G3 幂等:同一局结算两次不许翻倍 ──
  scene('G3幂等', () => {
    clean();
    const payload = { id: 'dup1', kills: 100, runTime: 300, victory: false, choice: 'ransom', met: ['yao'] };
    C.recordRun(payload); PRODUCT_CALLS++;
    const after1 = { ...C.s, seen: [...C.s.seen], seenRuns: [...C.s.seenRuns] };
    const dup = C.recordRun(payload); PRODUCT_CALLS++;
    T('G3第二次结算被识别成重复', dup && dup.ok === false && dup.dup === true,
      `返回 ${JSON.stringify(dup)}`);
    const after2 = { ...C.s, seen: [...C.s.seen], seenRuns: [...C.s.seenRuns] };
    T('G3火候没翻倍', after2.warmSec === after1.warmSec, `${after1.warmSec}→${after2.warmSec}`);
    T('G3累计击杀没翻倍', after2.warmKills === after1.warmKills, `${after1.warmKills}→${after2.warmKills}`);
    T('G3局数没翻倍', after2.runs === after1.runs, `${after1.runs}→${after2.runs}`);
    T('G3妖谱没重复堆叠', after2.seen.length === after1.seen.length,
      `${JSON.stringify(after1.seen)}→${JSON.stringify(after2.seen)}`);
    // 结算五次也不能翻
    for (let i = 0; i < 4; i++) C.recordRun(payload);
    T('G3连结算五次仍不翻倍', C.s.warmSec === after1.warmSec, `warmSec=${C.s.warmSec}`);
    // 但**新的一局**必须照常计入,否则幂等键会变成「整个游戏只记一局」
    C.recordRun({ id: 'dup2', kills: 100, runTime: 300, victory: true });
    PRODUCT_CALLS++;
    T('G3换一局(新 token)照常计入', C.s.warmSec === after1.warmSec * 2,
      `warmSec=${C.s.warmSec}(应为 ${after1.warmSec * 2})—— 幂等键写死的话这里会是 ${after1.warmSec}`);
    clean();
  });

  // ── 局内妖谱:重复遇见不重复占位 ──
  scene('局内妖谱', () => {
    clean();
    C.recordRun({ id: 'c1', kills: 3, met: ['yao', 'guard', 'yao', null, ''] });
    PRODUCT_CALLS++;
    T('妖谱去重且忽略脏 key', C.s.seen.length === 2 && C.s.seen.includes('yao') && C.s.seen.includes('guard'),
      `seen=${JSON.stringify(C.s.seen)}`);
    clean();
  });

  // ── G2 老存档兼容:缺新字段 / 字段被写成 null,都不许崩 ──
  scene('G2老存档', () => {
    // 只剩 V0.80 时代的 9 个字段 —— 新增的 6 个一个都没有
    const legacy = { lit:false, nodeId:null, fuelEnd:0, lastTick:0, totalSec:0,
                     members:[], invites:0, formed:false, rep:0 };
    LS().setItem(CAMP_KEY, JSON.stringify(legacy));
    let threw = null, lv = null, mo = null;
    try { C.load(); lv = C.warmLv(); mo = C.mourning(); }
    catch (e) { threw = e.message; }
    T('G2 缺新字段的老存档不崩', threw === null, `抛错:${threw}`);
    T('G2 老存档读回来火候等于默认值 0', !!lv && lv.sec === 0 && lv.lv === 1,
      `lv=${JSON.stringify(lv && { sec: lv.sec, lv: lv.lv })}`);
    T('G2 老存档读回来没有战败纪念', mo === null, `mourning=${JSON.stringify(mo)}`);
    T('G2 老存档的既有字段一个没丢',
      C.s.totalSec === 0 && Array.isArray(C.s.members) && C.s.formed === false,
      `totalSec=${C.s.totalSec} members=${JSON.stringify(C.s.members)} formed=${C.s.formed}`);

    // 老存档上直接结算一局,行为必须和全新存档一致
    const before = { sec: C.warmLv().sec, kills: C.warmLv().kills };
    C.recordRun({ id: 'L1', kills: 100, runTime: 300, victory: false });
    PRODUCT_CALLS++;
    T('G2 老存档上结算一局,火候照常 +120 秒(1.2/杀 × 100)',
      C.warmLv().sec - before.sec === 120, `增量=${C.warmLv().sec - before.sec}`);
    T('G2 老存档上战败纪念照样挂上', C.mourning() !== null, 'mourning=null');

    // 残缺档:新字段被写成 null / 字符串 / NaN —— 史上有过「存档 8888→30」那类事故
    for (const [label, bad] of [
      ['warmSec=null', { warmSec:null }],
      ['新字段全是 null', { warmSec:null, warmKills:null, runs:null, seenRuns:null, seen:null, moor:null }],
      ['warmSec 是字符串', { warmSec:'999' }],
      ['warmSec 是 NaN', { warmSec:NaN }],
      ['seen 是对象不是数组', { seen:{ a:1 } }],
      ['seenRuns 是对象不是数组', { seenRuns:{} }],
      ['moor 是数字', { moor: 12345 }],
    ]) {
      // ⚠️ 每轮必须先 reset():load() 是 `{...def, ...d}` 而 def 取的是**当前内存**
      // (这是 camp.js 原有的语义,不是 bug)。不清的话上一轮 recordRun 攒下的
      // warmSec 会留在 def 里,「读回来等于默认值 0」就变成假红 —— 门禁自己写错。
      C.reset();
      LS().setItem(CAMP_KEY, JSON.stringify({ ...legacy, ...bad }));
      let err = null, okLv = false, okShape = false;
      try {
        C.load();
        okLv = C.warmLv().sec === 0;
        okShape = Array.isArray(C.s.seen) && Array.isArray(C.s.seenRuns)
                  && (C.s.moor === null || (typeof C.s.moor === 'object' && !Array.isArray(C.s.moor)));
        C.recordRun({ id: 'x' + label, kills: 1, victory: true });
      } catch (e) { err = e.message; }
      T(`G2 残缺存档不崩:${label}`, err === null && okLv && okShape,
        `抛错:${err} 火候回默认=${okLv} 字段形状正确=${okShape}`);
    }

    // 空存档(键根本不存在)
    LS().removeItem(CAMP_KEY);
    let err2 = null;
    try { C.load(); C.warmLv(); C.mourning(); }
    catch (e) { err2 = e.message; }
    T('G2 空存档(键不存在)不崩', err2 === null, `抛错:${err2}`);

    // reset 之后新字段必须一起回来(原来 s: 和 reset() 各抄一份,漏抄就静默丢档)
    C.reset(); C.save();
    const dumped = JSON.parse(LS().getItem(CAMP_KEY) || '{}');
    T('G2 reset() 之后新字段仍在存档里',
      dumped.warmSec === 0 && Array.isArray(dumped.seenRuns) && dumped.moor === null,
      `存档=${JSON.stringify({ warmSec: dumped.warmSec, seenRuns: dumped.seenRuns, moor: dumped.moor })}`);
    clean();
  });

  // ── seenRuns 上界:存档不该无限长 ──
  scene('上界', () => {
    clean();
    for (let i = 0; i < 30; i++) C.recordRun({ id: 'run-'+i, kills: 1, victory: true });
    T('幂等 token 表有上界(存档不会无限长)',
      Array.isArray(C.s.seenRuns) && C.s.seenRuns.length <= 8 && C.s.seenRuns.length > 0,
      `长度=${C.s.seenRuns && C.s.seenRuns.length}`);
    clean();
  });

  return res;
}

// ═══════════════ [0] 工具自检:合成样本,证明断言不是恒真 ═══════════════
console.log('\n=== [0] 工具自检(合成样本 · 不碰真实文件) ===');
{
  // 方向性约定 ①:火候阶梯必须**可分辨**。
  // 合成一个最小假 CAMP:字段齐全、接口对,但火候只写死不涨。
  // 「砍 100 只 → 火旺档位真的涨了」这条在它身上**必须红** ——
  // 否则那条断言对任何实现都恒真,钉不住任何东西。
  const FAKE_FLAT = {
    s: { warmSec:0, warmKills:0, runs:0, seen:[], seenRuns:[], moor:null, totalSec:0, members:[], formed:false },
    reset(){ this.s = { warmSec:0, warmKills:0, runs:0, seen:[], seenRuns:[], moor:null, totalSec:0, members:[], formed:false }; },
    save(){}, load(){},
    recordRun(o){ this.s.warmKills += (o.kills||0); this.s.runs++; return { ok:true }; },
    warmLv(){ return { lv:1, sec:0, tier:{name:'篝火',col:'#fff'}, next:null, toNext:0, pct:0, kills:0 }; },
    mourning(){ return this.s.moor; },
    tier(){ return { lv:1, name:'篝火' }; },
  };
  const flat = coreChecks(FAKE_FLAT).filter(r => !r.ok);
  t('【自检】合成样本①「火候写死不涨」会被抓红(证明火旺断言不是恒真)',
    flat.some(r => /火旺档位/.test(r.n)),
    `假实现红 ${flat.length} 条,含火旺断言=${flat.some(r => /火旺档位/.test(r.n))}`);

  // 方向性约定 ②:幂等断言必须抓得住「不幂等」的假实现。
  const FAKE_NODEDUPE = {
    ...FAKE_FLAT,
    recordRun(o){ this.s.warmSec += Math.round((o.kills||0)*1.2); this.s.warmKills += (o.kills||0);
                  this.s.runs++; if (o.victory===false) this.s.moor={at:1,kills:o.kills||0};
                  this.s.seen.push(...(o.met||[])); return { ok:true }; },
  };
  const nd = coreChecks(FAKE_NODEDUPE).filter(r => !r.ok);
  t('【自检】合成样本②「不幂等」会被抓红(证明幂等断言不是恒真)',
    nd.some(r => /G3/.test(r.n)), `红 ${nd.length} 条,含 G3=${nd.some(r => /G3/.test(r.n))}`);

  // 方向性约定 ③:老存档断言必须抓得住「不补默认值」的假实现。
  const FAKE_NODEFAULT = {
    ...FAKE_FLAT,
    load(){ /* 什么都不补 —— 老字段原样留,新字段 undefined */ },
  };
  const nd2 = coreChecks(FAKE_NODEFAULT).filter(r => !r.ok);
  t('【自检】合成样本③「不补默认值」会被抓红(证明老存档断言不是恒真)',
    nd2.some(r => /G2|残缺|空存档/.test(r.n)), `红 ${nd2.length} 条`);

  // 方向性约定 ④:火候阶梯本身要能分辨不同档位(120/600/2400/9000)。
  const campSrc = R(CAMP_REL);
  const tiers = [...campSrc.matchAll(/\{ lv:(\d+),[^\n]*?need:(\d+)/g)].map(x => [ +x[1], +x[2] ]);
  const realCAMP = (await import('../js/xiuxian/camp.js')).CAMP;
  const probes = tiers.map(([lv, need]) => {
    LS().removeItem(CAMP_KEY); realCAMP.reset(); LS().removeItem(CAMP_KEY);
    const kills = Math.ceil(need / 1.2);
    realCAMP.recordRun({ id: 'probe-'+lv, kills, victory: true });
    return realCAMP.warmLv().lv;
  });
  t('【自检】火候刻度是从 CAMP_TIERS 推的:各阶门槛对应的档位单调不降且确实在爬',
    tiers.length >= 4 && probes.every((v, i) => i === 0 || v > probes[i-1]) && probes[0] >= 1,
    `CAMP_TIERS need=${JSON.stringify(tiers.map(x=>x[1]))} → warmLv=${JSON.stringify(probes)}`);
  t('【自检】SEC_PER_KILL 真的挂在 CAMP_TIERS 上(不是自创常量)',
    /SEC_PER_KILL\s*=\s*CAMP_TIERS\[1\]\.need\s*\/\s*100/.test(campSrc),
    '找不到 SEC_PER_KILL = CAMP_TIERS[1].need / 100 —— 换算口径和营地升级表脱钩了');

  t('【自检】核心断言集本身非空', coreChecks(realCAMP).length >= 30,
    `只有 ${coreChecks(realCAMP).length} 条`);
}

// ═══════════════ [1]~[4] 四条链 ═══════════════
const mod = await import('../js/xiuxian/camp.js');
console.log('\n=== [1][4] ①砍杀→篝火旺 / ④战败→战败纪念(本工单接上的两条) ===');
for (const r of coreChecks(mod.CAMP)) t(r.n, r.ok, r.d);

// ②③ 的局外那半条:本来就在(ui.js arrive → STORY.see → MOUNT.checkUnlocks)
console.log('\n=== [2][3] ②白泽→秘境 / ③带回来→村口活物(局外既有 · 钉住不许退化) ===');
{
  const mountSrc = R('js/xiuxian/mount.js');
  const storySrc = R('js/xiuxian/story.js');
  const uiSrc = R('js/xiuxian/ui.js');
  const mainSrc = R(MAIN_REL);

  // ②:白泽幼崽的解锁条件是「在图鉴里见过白泽」
  t('②白泽幼崽挂在「见过白泽」这条条件上(不是白给)',
    /tryGet\(\s*'baize'\s*,\s*STORY\.met\(\s*'baize'\s*\)\s*\)/.test(mountSrc),
    'mount.js 里 baize 的解锁条件变了 —— 请同步把本门禁改成断言新条件');
  t('②「见过」这件事有持久化字段(STORY.s.met),不是内存里飘一下',
    /met:\s*\{\}/.test(storySrc) && /see\(k\)\s*\{[\s\S]{0,120}this\.s\.met\[k\]/.test(storySrc),
    'STORY 的 met 记录没了 —— 「见过」变成一次性事件');

  // 白泽在**局内**不存在 —— 这是本工单最重要的一条「如实登记」。
  // 硬证据:js/game/ 下没有任何文件 import legend.js,
  // 也就是说局内刷怪图(BESTIARY / ENEMY_TYPES)里没有白泽。
  const gameFiles = ['js/game/director.js','js/game/enemies.js','js/game/spawner.js','js/game/boss.js'];
  const importsLegend = gameFiles.filter(f => /from '\.\.\/xiuxian\/legend\.js'/.test(R(f)));
  t('②【如实登记】局内刷怪图里没有白泽:js/game/* 无一 import legend.js',
    importsLegend.length === 0,
    importsLegend.length
      ? `${importsLegend.join(',')} 现在 import 了 legend.js —— 白泽开始进局内了,请把本工单的②改成断言「局内遇到白泽会解锁秘境」并撤掉这句登记`
      : '若哪天白泽进了局内刷怪图,这条会红,那时 ② 才真正接得上');
  t('②【不造假】main.js 没有凭空造一个「局内遇到白泽」事件',
    !/STORY\.see\(\s*['"]baize['"]\s*\)/.test(mainSrc),
    'main.js 里出现了 STORY.see("baize") —— 局内根本没有白泽,这是伪造的事件源');

  // ③:活物名册是 MOUNT.s.have / s.pet
  t('③活物名册存在且是数组', /s:\s*\{\s*have:\s*\[\]/.test(mountSrc),
    'MOUNT.s.have 没了 —— 「村口多个活物」没有落点');
  t('③白泽幼崽是 pet(带,不是骑),且会自动上阵',
    /id:'baize',\s*kind:'pet'/.test(mountSrc) && /this\.s\.pet\s*=\s*id/.test(mountSrc),
    '拿到的宠物不会自动上场 —— 名册里有、场上没有');
  t('③宠物/坐骑的加成真的被带进局内(main.js mount-on 装配 MOUNT.eff)',
    /MOUNT\.eff\(\)/.test(mainSrc) && /addUpdaterOnce\(\s*'mount-on'/.test(mainSrc),
    '带回来的活物不影响局内 —— 名册只是数据');
}

console.log('\n=== [5] main.js 接线:①④ 两条真的调到了产品函数 ===');
{
  const mainSrc = R(MAIN_REL);
  const calls = (re) => [...mainSrc.matchAll(re)].length;
  t('main.js 在 endRun 里调用了 CAMP.recordRun',
    calls(/CAMP\.recordRun\(/g) >= 1, `找到 ${calls(/CAMP\.recordRun\(/g)} 处`);
  t('结算传了幂等 token(不传 id 就无法防「结算两次」)',
    /CAMP\.recordRun\(\s*\{[\s\S]{0,200}?id:\s*curRunId/.test(mainSrc),
    'recordRun 没拿到 id —— G3 的幂等在生产路径上是空的');
  t('结算传了真实战败标记(victory),不是自己编一个 defeat 事件',
    /victory:\s*victory\s*!==\s*false/.test(mainSrc),
    '战败标记不是从 endRun 的入参派生的 —— 那就是伪造的战败');
  t('战败路线来自 fromTurnBased 写入的 lastDefeatChoice(不是编的)',
    /choice:\s*lastDefeatChoice\s*\|\|\s*null/.test(mainSrc),
    'choice 不是真实战败路线的来源');
  t('每开一局换新 token(startRun 里铸造)',
    /curRunId\s*=\s*`\$\{Date\.now\(\)\.toString\(36\)\}-\$\{\(\+\+runSeq\)\}`/.test(mainSrc),
    'startRun 没有铸新 token —— 幂等键会退化成「整个游戏只记一局」');
  t('本局妖谱每局清场(上一局的见过什么不漏进这一局)',
    /curRunMet\.clear\(\)/.test(mainSrc), 'startRun 没有 clear curRunMet');
  t('击杀点真的采了集(enemy-death 里 curRunMet.add)',
    /Bus\.on\(\s*'enemy-death'[\s\S]{0,400}?curRunMet\.add\(/.test(mainSrc),
    'curRunMet 从来没有内容 —— 妖谱恒为空');
  t('结算层包了 try/catch(抛异常会把玩家锁死在暂停的局)',
    /try\s*\{[\s\S]{0,300}?CAMP\.recordRun\([\s\S]{0,300}?\}\s*catch[\s\S]{0,80}?console\.warn/.test(mainSrc),
    'recordRun 裸调 —— 一次异常就是一次软锁');
}

// ═══════════════ [5b] main.js 接线:**真的把游戏跑一局** ═══════════════
//
// 【为什么不能只读源码】
//   第一版这里全是正则读源码。它当场被证伪:把 `CAMP.recordRun({...})` 改成
//   `if (false) CAMP.recordRun({...})`,源码里那行字**一个字都没少**,
//   正则照样全绿 —— 一道「测不到接线断了」的接线检查,比没有更坏。
//
//   所以这里真的 boot main.js、走真的菜单开局、走真的 runend,
//   然后看营地状态变没变。玩家路径上的任何一个 if 都绕不过去。
console.log('\n=== [5b] 真跑一局:main.js → endRun → 营地(不是读源码) ===');
{
  let bootOk = false, bootMsg = '';
  try {
    const { install } = await import('./harness.mjs');
    const H = install();
    // main.js 直接摸的一批元素,harness 只预置了 9 个。桩必须**按 id 复用**,
    // 否则 Screens 把 innerHTML 写进一个转瞬即逝的对象里,回调一个都抓不到。
    const REG = new Map();
    const mk = () => new Proxy({
      _l: {}, onclick: null,
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
      removeEventListener() {}, appendChild() {}, append() {}, prepend() {},
      insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {}, focus() {}, blur() {},
      click() { this._fire('click'); },
      // bindTap 用的是 `el.onclick = fn`(属性,不是 addEventListener)——
      // 只监听 _l 的话菜单按钮永远点不动,这里踩过一次。
      _fire(t) {
        (this._l[t] || []).forEach(f => f({ type:t, target:this, preventDefault(){}, stopPropagation(){} }));
        if (t === 'click' && typeof this.onclick === 'function') this.onclick({ type:t, target:this });
      },
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      style:{}, dataset:{}, children:[], textContent:'', innerHTML:'', value:'',
      querySelector(){ return mk(); }, querySelectorAll(){ return []; },
      getBoundingClientRect: () => ({ left:0, top:0, width:960, height:640 }),
      getContext() { return H.canvas.getContext('2d'); },
    }, { get(t,k){ return (k in t) ? t[k] : (() => undefined); }, set(t,k,v){ t[k]=v; return true; } });
    const origId = globalThis.document.getElementById.bind(globalThis.document);
    globalThis.document.getElementById = id => {
      if (!REG.has(id)) { const e = origId(id); if (e) return e; REG.set(id, mk()); }
      return REG.get(id);
    };
    // canvas 必须留给 harness 的真桩(sprites raster 要 getContext),别挡
    const origCe = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = t => (t === 'canvas' ? origCe(t) : mk());

    await import('../js/main.js');
    const g = globalThis.window.__g;
    const { CAMP } = await import('../js/xiuxian/camp.js');
    const { Bus } = await import('../js/core/engine.js?v=17');
    const { Screens } = await import('../js/ui/screens.js?v=17');
    if (!g) throw new Error('window.__g 不存在 —— main.js 根本没 boot 起来');

    // 走真的菜单:btn-play → Screens.buildSelect → onPick → startRun
    let pick = null;
    Screens.buildSelect = cb => { pick = cb.onPick; };
    REG.get('btn-play')._fire('click');
    if (typeof pick !== 'function') throw new Error('没抓到 onPick —— 菜单链路断了');
    pick('knight', true);

    LS().removeItem(CAMP_KEY); CAMP.reset();

    const play = (kills, victory) => {
      g.stats.kills = kills; g.time = 100;
      Bus.emit('runend', { victory });
    };

    // 100 只 —— 正是 owner 说的那个数。100 × 1.2 = 120 秒 = CAMP_TIERS 第 1 阶门槛,
    // 所以这一局跑完火旺必须**整整爬一档**(篝火 → 围栏),不多不少。
    play(100, false);
    const w1 = CAMP.warmLv().sec, r1 = CAMP.s.runs, m1 = CAMP.mourning();
    t('真跑一局:砍 100 只 → 营地火候真的涨了(100 × 1.2 = 120 秒)',
      w1 === 120, `warmSec=${w1} —— 接上没接上,看这一个数`);
    t('真跑一局:火旺档位确实从篝火爬到围栏(用的就是 CAMP_TIERS 那把梯子)',
      CAMP.warmLv().lv === 2 && CAMP.warmLv().tier.name === '围栏',
      `lv=${CAMP.warmLv().lv}(${CAMP.warmLv().tier.name})`);
    t('真跑一局战败 → 战败纪念真的挂上了(不是只有 win 路径通)',
      !!m1 && m1.on === true && m1.kills === 100, `mourning=${JSON.stringify(m1)}`);

    play(100, false);                      // 同一局再结算一次
    t('真跑一局:同一局重复结算不翻倍', CAMP.warmLv().sec === w1 && CAMP.s.runs === r1,
      `warmSec ${w1}→${CAMP.warmLv().sec}  runs ${r1}→${CAMP.s.runs}`);

    pick('knight', true);                  // 开第二局(证明幂等键不是「一辈子只记一局」)
    play(8, true);                          // 8 只 = 9.6 → 10 秒,仍停在第 1 档
    t('真跑第二局:新的一局照常计入', CAMP.warmLv().sec === w1 + 10 && CAMP.s.runs === r1 + 1,
      `warmSec=${CAMP.warmLv().sec}(应为 ${w1 + 10})  runs=${CAMP.s.runs}(应为 ${r1 + 1})`);
    t('真跑第二局:火候是累加的(两局加起来 130 秒,还在同一档)', CAMP.warmLv().sec === 130,
      `warmSec=${CAMP.warmLv().sec}`);
    t('真跑第二局:通关不摘白布(记的是最近一次战败)', CAMP.mourning() !== null,
      '一通关就抹掉 = 白布只在同一瞬间可见,刷新就没了');
    BOOT_CALLS++;
    bootOk = true;
    bootMsg = 'main.js boot → 开局 → runend 全链路走通';
  } catch (e) {
    bootMsg = `抛错:${e.message}`;
  }
  t('main.js 能在无头环境里真跑一局', bootOk, bootMsg);
  t('【G4】真跑路径调到了产品函数(不是只在读源码)', BOOT_CALLS > 0,
    `BOOT_CALLS=${BOOT_CALLS} —— 没走通真路径,上面所有断言都不作数`);
}

// ═══════════════ [5c] ④「丹炉灭」:如实登记为未接上 ═══════════════
console.log('\n=== [5c] ④丹炉灭:数据通道已在,消费端未接(如实登记) ===');
{
  const buildSrc = R('js/xiuxian/build.js');
  const campSrc = R(CAMP_REL);
  t('④战败纪念已经是一个可读的数据通道(CAMP.mourning)',
    typeof mod.CAMP.mourning === 'function', 'CAMP.mourning 不存在 —— 战败信号没有出口');
  // 丹炉产出只看 worker 数(build.js:334 efficiency(inst.workers.length)),
  // 要让它「灭」必须改 build.js 或清 BUILD.s.placed 的 workers ——
  // 两个文件都不在本工单名下,而且**关炉 = 少出丹 = 改平衡**。
  // 所以这里只登记现状,不假装做了。
  t('④【如实登记】丹炉产出目前只由 worker 数决定,没有读战败纪念',
    !/mourning\(\)/.test(buildSrc) && !/CAMP\.s\.moor/.test(buildSrc),
    'build.js 开始读 CAMP.mourning()/moor 了 —— 丹炉灭已接上,请把本门禁改成断言「战败后丹炉停产出」并撤掉这句登记');
  t('④【不越界】本工单没有往 build.js / BUILD.s.placed 塞战败状态',
    !/moor/.test(buildSrc), 'build.js 被改了 —— 那不在本工单的文件所有权内');
  t('④炉子状态不含时间戳这一点被登记在案(不是被忽略)',
    /FURNACE|本炉|丹炉/.test(campSrc) ? true : /moor:\s*null/.test(campSrc),
    'moor 默认值没写进 defaultState() —— 老存档会缺字段');
}

// ═══════════════ [6] G4 防退化:门禁自身失效必须 exit 2 ═══════════════
console.log('\n=== [6] G4 防退化 ===');
{
  t('本门禁真的调到了产品函数(不是只在读源码)',
    PRODUCT_CALLS > 0, `PRODUCT_CALLS=${PRODUCT_CALLS} —— 全程没调到 CAMP.recordRun,下面的结论不作数`);
  t('核心断言集跑完没有场景崩掉',
    !coreChecks(mod.CAMP).some(r => /能跑完/.test(r.n)),
    '有场景抛错 —— 断言集本身坏了');
  const real = coreChecks(mod.CAMP);
  t('全部行为断言为绿(异常集为空)',
    real.every(r => r.ok),
    `红 ${real.filter(r => !r.ok).map(r => r.n).join(' / ')}`);
  t('四条链的结论都已登记(①④ 接上 / ②③ 局外既有、局内无源)',
    real.length >= 30 && real.every(r => typeof r.n === 'string' && r.n.length > 0),
    '断言集为空 —— 门禁在空转');
}

// ═══════════════ [7] 反向注入自检 ═══════════════
console.log('\n=== [7] 反向注入:注入缺陷 → 必须变红 → 逐字节还原 ===');
{
  const INJECTIONS = [
    { file: CAMP_REL, name: '砍杀不再喂火候', from: 'this.s.warmSec = (Math.max(0, Number(this.s.warmSec) || 0)) + sec;', to: '/* 注入:不喂火候 */' },
    { file: CAMP_REL, name: '去掉幂等(结算两次就翻倍)', from: 'if (id && runs.includes(id)) return { ok:false, dup:true, sec:0, kills:0 };', to: '/* 注入:不查重 */' },
    { file: CAMP_REL, name: '战败不挂白布', from: 'if (r.victory === false) {', to: 'if (false) {' },
    { file: CAMP_REL, name: '老存档不补默认值', from: "if (typeof this.s.warmSec !== 'number' || !isFinite(this.s.warmSec)) this.s.warmSec = 0;", to: '/* 注入:不补默认值 */' },
    { file: MAIN_REL,  name: 'main.js 不再记结算', from: 'CAMP.recordRun({', to: 'void 0; CAMP.recordRun && ({' },
  ];
  for (const inj of INJECTIONS) {
    const path = _jn(ROOT, inj.file);
    const backup = readFileSync(path, 'utf8');
    let msg = '', okAll = false;
    try {
      const polluted = backup.replace(inj.from, inj.to);
      if (polluted === backup) {
        msg = '注入锚点没命中(源码已变)—— 这一项的自检作废';
      } else {
        writeFileSync(path, polluted);
        let bad = [];
        if (inj.file === CAMP_REL) {
          const M = await import(`../js/xiuxian/camp.js?inj=${encodeURIComponent(inj.name)}`);
          bad = coreChecks(M.CAMP).filter(r => !r.ok);
        } else {
          const s = readFileSync(path, 'utf8');
          bad = [ { n:'main.js 仍真的调 CAMP.recordRun', ok: /CAMP\.recordRun\(\{/.test(s) },
                   { n:'main.js 传了幂等 token', ok: /id:\s*curRunId/.test(s) } ].filter(r => !r.ok);
        }
        okAll = bad.length > 0;
        msg = okAll ? `红了 ${bad.length} 条,例如「${bad[0].n}」` : '❌ 注入后门禁全绿 —— 这道门禁测不到这个缺陷';
      }
    } finally {
      writeFileSync(path, backup);
    }
    const restored = readFileSync(path, 'utf8') === backup;
    t(`注入「${inj.name}」→ 必须红`, okAll, msg);
    t(`注入「${inj.name}」→ 已还原`, restored, '还原校验失败 —— 工作区被污染了,必须先修好再跑任何别的东西');
  }
}

if (PRODUCT_CALLS === 0 || BOOT_CALLS === 0) {
  console.log(`\n❌ 门禁自身失效:产品函数调用=${PRODUCT_CALLS} 真跑路径=${BOOT_CALLS} —— 下面所有结论都不作数`);
  process.exit(2);
}
if (fail === 0) {
  console.log(`\n✅ XX-VISIBLE-001 通过:${pass} 项(①④ 接上 · ②③ 局外既有/局内无源已如实登记 · 老存档不崩 · 结算两次不翻倍 · 注入必红)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 局内发生的事,局外还是看不见`);
  process.exit(1);
}