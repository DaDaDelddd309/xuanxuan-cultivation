// 灵伴变异体系测试 —— 工单 XX-MUTATION-001 / 002
// 运行: node tests/mutation-regression.mjs
//
// 验收依据(对着 docs/COMPANION-MUTATION.md 的判据断言,不是"跑通就行"):
//   稀有度驱动  低阶喂出来必须是骸族为主,不能直接给恶魔/仙 —— 这是"赌博"的底线
//   保底        连续 10 次没出良品族 → 第 11 次强制出,不许永远卡在骸族
//   部位正交    玩家选部位 + 随机定族,两者互不干扰
//   剧情专属    「有没有眼睛/几只眼」只能由剧情改,随机改不了
//   真身抉择    伸手 → 族由历史最高品阶确定性决定 + 跳过化形;收回 → 维持随机
//   老档兼容    V0.99 之前的老存档没有 mut 字段,load() 必须补默认值而不是炸
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

// ---- 环境 shim(Node 无 DOM/localStorage)----
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: { appendChild() {} }, getElementById: () => null,
};
globalThis.window = {};

const { MUTATION } = await import('../js/xiuxian/mutation.js');
const { COMPANION } = await import('../js/xiuxian/companion.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

/** 确定性随机源:mulberry32,同种子必同序列 —— 保证断言可复现 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 跑 n 次低阶投喂,统计各族出现次数 */
function census(tier, n, seed) {
  const rng = seeded(seed);
  const c = {};
  for (let i = 0; i < n; i++) {
    const f = MUTATION.rollFamily(tier, 0, rng);
    c[f] = (c[f] || 0) + 1;
  }
  return c;
}

// ————————————————— 1. 阶段机 —————————————————
{
  const m = MUTATION.defaultMut();
  ok('初始阶段=封印', m.stage === 0 && m.family === null);
  ok('初始进度 0/10', MUTATION.progress(m).feeds === 0 && MUTATION.progress(m).total === 10);

  const seen = [];
  const rng = seeded(7);
  const parts = ['skin','limb','eye','ear','horn'];
  for (let i = 0; i < 10; i++) {
    const r = MUTATION.feed(m, 1, parts[i % 5], rng);
    if (r.stageUp) seen.push(r.to);
  }
  ok('喂满 10 次必到真身', m.stage === 4, 'stage=' + m.stage);
  ok('阶段只在跨门槛时跳', seen.length <= 4 && seen.every(s => s >= 1 && s <= 4), JSON.stringify(seen));
  ok('10 次后无下一阶段', MUTATION.toNext(m) === 0);
}

// ————————————————— 2. 稀有度驱动(赌博底线) —————————————————
{
  const low = census(1, 4000, 42);
  const boneRate = (low.bone || 0) / 4000;
  ok('低阶(清)出骸族 ≥60%', boneRate >= 0.60, '实际 ' + (boneRate * 100).toFixed(1) + '%');
  ok('低阶几乎不给魔/妖/仙', !(low.demon || 0) && !(low.beast || 0) && !(low.celest || 0),
     JSON.stringify(low));

  const high = census(5, 4000, 43);
  const demonRate = (high.demon || 0) / 4000;
  ok('高阶(焦)出魔 ≥35%', demonRate >= 0.35, '实际 ' + (demonRate * 100).toFixed(1) + '%');

  // 太虚源石是唯一能强制转向的品阶:六族都要能出到
  const top = census(6, 6000, 44);
  ok('太虚阶六族全覆盖', Object.keys(top).length === 6, JSON.stringify(top));
}

// ————————————————— 3. 保底机制 —————————————————
{
  ok('未满 10 次不保底', MUTATION.rollFamily(1, 9, seeded(1)) === 'bone');
  // pity=10 强制:无论随机源吐什么,结果都必须在良品族里
  let allLucky = true;
  for (let s = 0; s < 300; s++) {
    if (!MUTATION.LUCKY.includes(MUTATION.rollFamily(1, 10, seeded(s)))) { allLucky = false; break; }
  }
  ok('pity=10 强制出良品族', allLucky);

  // 端到端:一路喂最低阶,连续没出良品族时 pity 必须涨,出良品族必须清零
  const m = MUTATION.defaultMut();
  const rng = seeded(99);
  let maxPity = 0, hitLucky = false;
  for (let i = 0; i < 60; i++) {
    const r = MUTATION.feed(m, 1, 'skin', rng);
    maxPity = Math.max(maxPity, m.pity);
    if (MUTATION.LUCKY.includes(r.family)) hitLucky = true;
  }
  ok('pity 会被记满(≥10 说明保底在跑)', maxPity >= 10, 'maxPity=' + maxPity);
  // ⚠️ 族每次重抽,所以不能断言"最后一次是良品族",要断言"这 60 次里出到过"。
  ok('60 次低阶内必出到良品族', hitLucky, 'family=' + m.family);

  // 族必须**每次投喂都重抽**。曾经写成 `mut.family || rollFamily(...)`,
  // 族在第 1 次后锁死 → 保底永远不触发 → 稀有度轴形同虚设。这条守住它。
  const r2 = seeded(1234);
  const seenFam = new Set();
  const x = MUTATION.defaultMut();
  for (let i = 0; i < 10; i++) { MUTATION.feed(x, 6, 'skin', r2); seenFam.add(x.family); }
  ok('族会随投喂变化(不是第一次锁死)', seenFam.size >= 2, '见过 ' + seenFam.size + ' 个族');

  // 同种子必须复现 —— 否则门禁自己就不稳定
  const s1 = (() => { const m = MUTATION.defaultMut(); const g = seeded(777);
    for (let i=0;i<10;i++) MUTATION.feed(m,3,'ear',g); return m.family + '/' + m.feeds; })();
  const s2 = (() => { const m = MUTATION.defaultMut(); const g = seeded(777);
    for (let i=0;i<10;i++) MUTATION.feed(m,3,'ear',g); return m.family + '/' + m.feeds; })();
  ok('同种子同结果(可复现)', s1 === s2, s1 + ' vs ' + s2);
}

// ————————————————— 4. 部位正交 —————————————————
{
  const m = MUTATION.defaultMut();
  const rng = seeded(5);
  for (let i = 0; i < 6; i++) MUTATION.feed(m, 3, 'ear', rng);
  ok('耳部点数只涨耳', m.parts.ear === 6 && m.parts.skin === 0 && m.parts.horn === 0);

  const f = MUTATION.derive(m);
  const base = MUTATION.derive({ ...MUTATION.defaultMut(), family: m.family, stage: 4, parts: { skin:0,limb:0,eye:0,ear:0,horn:0 } });
  ok('喂耳 → 耳变长', f.ear.len > base.ear.len, `${base.ear.len} → ${f.ear.len}`);
  ok('喂耳 → 耳角度变大', f.ear.angle > base.ear.angle);
  ok('耳长有封顶(不无限涨)', (() => {
    const x = MUTATION.defaultMut(); x.family = 'allure'; x.stage = 4;
    for (let i = 0; i < 40; i++) x.parts.ear++;
    return MUTATION.derive(x).ear.len <= 1.35 * 1.4 + 1e-9;
  })());

  ok('非法部位要报错', (() => {
    try { MUTATION.feed(MUTATION.defaultMut(), 1, '尾巴'); return false; } catch { return true; }
  })());
}

// ————————————————— 5. 剧情独占眼型 —————————————————
{
  const m = MUTATION.defaultMut();
  m.family = 'bone'; m.stage = 4;
  ok('骸族默认 2 只 Hollow 眼', MUTATION.derive(m).eye.count === 2);

  MUTATION.dramaGrant(m, 'third');
  const f = MUTATION.derive(m);
  ok('剧情授予第三只眼', f.eye.count === 3 && f.eye.fromDrama === true);

  MUTATION.dramaGrant(m, 'many');
  ok('剧情可授 4 只眼', MUTATION.derive(m).eye.count === 4);

  // 关键:族变了,剧情授予的眼型不能被覆盖回去
  m.family = 'celest';
  const f2 = MUTATION.derive(m);
  ok('换族不夺走剧情给的眼睛', f2.eye.count === 4 && f2.eye.fromDrama === true,
     `count=${f2.eye.count} family=${f2.family}`);

  ok('非法剧情眼型要报错', (() => {
    try { MUTATION.dramaGrant(MUTATION.defaultMut(), 'sixteen'); return false; } catch { return true; }
  })());
}

// ————————————————— 6. 真身抉择 —————————————————
{
  // ⚠️ stage 必须由 feeds 推导,不能写死 —— 写死的话"没到真身不能选"
  // 这条断言就自相矛盾了(夹具比被测对象更宽松,等于没测)。
  const mk = (feeds, best, fam) => {
    const m = MUTATION.defaultMut();
    m.feeds = feeds; m.best = best; m.family = fam;
    m.stage = MUTATION.stageOf(feeds);
    return m;
  };
  ok('stageOf(3)=显形而非真身', mk(3,1,'bone').stage === 2, 'stage=' + mk(3,1,'bone').stage);
  ok('没到真身不能选', !MUTATION.canChooseFinal(mk(3, 1, 'bone')));
  ok('到真身可选', MUTATION.canChooseFinal(mk(10, 1, 'bone')));
  ok('选过不能再选', (() => {
    const m = mk(10, 1, 'bone'); MUTATION.resolveFinal(m, true);
    return !MUTATION.canChooseFinal(m);
  })());

  const a = mk(10, 5, 'bone');
  const ra = MUTATION.resolveFinal(a, true);
  ok('伸手 → 族=最高品阶对应族(焦→妖)', ra.family === 'beast' && a.family === 'beast', ra.family);
  ok('伸手 → 记下 reach', a.reach === true);

  const b = mk(10, 5, 'bone');
  const rb = MUTATION.resolveFinal(b, false);
  ok('收回 → 维持抽出来的族', rb.family === 'bone' && b.family === 'bone');
  ok('收回 → 不跳阶段', b.skippedMorph === false);

  const c = mk(10, 6, 'bone');
  const rc = MUTATION.resolveFinal(c, true);
  ok('伸手 → 跳过化形过场', rc.skippedMorph === true && c.stage === 4);
  ok('伸手 → 太虚阶强制转仙族', c.family === 'celest', c.family);

  ok('重复结算要报错', (() => {
    const m = mk(10, 1, 'bone'); MUTATION.resolveFinal(m, true);
    try { MUTATION.resolveFinal(m, true); return false; } catch { return true; }
  })());
}

// ————————————————— 7. 量化参数完整性(出图要吃这个) —————————————————
{
  const m = MUTATION.defaultMut(); m.stage = 4; m.family = 'demon';
  MUTATION.feed(m, 4, 'limb', seeded(3));
  m.stage = 4;
  const f = MUTATION.derive(m);
  for (const k of ['stage','bg','family','ear','eye','skin','limb','horn','tail','ratio']) {
    ok('derive 必须给出 ' + k, f[k] !== undefined && f[k] !== null);
  }
  ok('bgStage 0~4', f.bg >= 0 && f.bg <= 4);
  ok('头身比随阶段递增', (() => {
    let prev = 0;
    for (let s = 0; s < 5; s++) {
      const x = MUTATION.defaultMut(); x.stage = s;
      const r = MUTATION.derive(x).ratio;
      if (r <= prev) return false;
      prev = r;
    }
    return true;
  })());
  ok('数值都在合法区间', f.skin.hue >= 0 && f.skin.hue <= 360
     && f.skin.sat >= 0 && f.skin.sat <= 1
     && f.skin.rough >= 0 && f.skin.rough <= 1);
}

// ————————————————— 8. 存档往返 + 老档兼容 —————————————————
{
  COMPANION.reset();
  COMPANION.init('宝宝');
  const rng = seeded(21);
  for (let i = 0; i < 4; i++) COMPANION.feed(2, ['skin','ear','eye','limb'][i], rng);
  ok('投喂后 feeds 累加', COMPANION.s.mut.feeds === 4);
  COMPANION.save();
  COMPANION.load();
  ok('重载后 feeds 保持', COMPANION.s.mut.feeds === 4);
  ok('重载后部位点数保持', COMPANION.s.mut.parts.ear === 1 && COMPANION.s.mut.parts.eye === 1);
  ok('重载后族保持', !!COMPANION.s.mut.family);

  // 老存档:完全没有 mut 字段(V0.99 之前就是这个形状)
  localStorage.setItem('xx_companion_v081', JSON.stringify({ name:'宝宝', log: [] }));
  COMPANION.load();
  ok('老存档缺 mut 不炸', !!COMPANION.s.mut && COMPANION.s.mut.feeds === 0);
  ok('老存档补全 parts 五部位', Object.keys(COMPANION.s.mut.parts).length === 5);
  ok('老存档能继续投喂', (() => {
    try { COMPANION.feed(3, 'horn', seeded(1)); return COMPANION.s.mut.feeds === 1; }
    catch (e) { return false; }
  })());

  // 半残存档:mut 存在但 parts 缺键(load 的补全逻辑要兜住)
  localStorage.setItem('xx_companion_v081',
    JSON.stringify({ name:'宝宝', mut: { feeds: 2, family: 'bone', parts: { ear: 1 } } }));
  COMPANION.load();
  ok('残缺 mut 的 parts 被补全', (() => {
    const p = COMPANION.s.mut.parts;
    return p.ear === 1 && p.skin === 0 && p.limb === 0 && p.eye === 0 && p.horn === 0;
  })());
  ok('残缺 mut 仍可 derive', (() => {
    try { COMPANION.form(); return true; } catch { return false; }
  })());

  COMPANION.reset();
}

// ————————————————— 9. 契约门禁:导出的东西不许悄悄改 —————————————————
{
  ok('五阶段齐全', MUTATION.STAGES.length === 5);
  ok('六族齐全', MUTATION.FAMILY_LIST.length === 6);
  ok('五部位齐全', MUTATION.PART_KEYS.length === 5);
  ok('每个族都有族徽与背景', MUTATION.FAMILY_LIST.every(f => f.sigil && f.bg));
  ok('良品族 = 4 个', MUTATION.LUCKY.length === 4);
  ok('品阶 1~6 都有倾向表', [1,2,3,4,5,6].every(t => MUTATION.FAMILY_TABLE[t]));
  ok('每档权重和 = 1', [1,2,3,4,5,6].every(t => {
    const s = Object.values(MUTATION.FAMILY_TABLE[t]).reduce((a,b) => a+b, 0);
    return Math.abs(s - 1) < 1e-9;
  }));
  ok('sw.js 已登记 mutation.js', readFileSync(ROOT + '/sw.js','utf8').includes("'js/xiuxian/mutation.js'"));
}

// ————————————————— 10. 接线契约(AGENTS.md §0A 三问) —————————————————
// 只测 mutation.js 等于自嗨:玩家可能根本走不到。这里断言 UI 真的调得到。
{
  // XX-AUDIT-005(ui.js 拆分)之后,行囊页的实现搬进了 js/xiuxian/ui/bag.js,
  // 但本断言原本只读 ui.js —— 于是「实现搬走了」和「实现被删了」在它眼里一样。
  // 扫整个修仙阁源码树:搬家不误报,真删除照样抓。
  const uiSrc = readdirSync(ROOT + '/js/xiuxian/ui')
    .filter(f => f.endsWith('.js'))
    .map(f => readFileSync(ROOT + '/js/xiuxian/ui/' + f, 'utf8'))
    .join('\n');
  const ui = readFileSync(ROOT + '/js/xiuxian/ui.js', 'utf8');
  const hall = ui + '\n' + uiSrc;
  ok('ui.js 引入 MUTATION', /import\s*\{[^}]*MUTATION[^}]*\}\s*from\s*'[^']*mutation\.js'/.test(hall));
  ok('ui.js 有 选石 动作', hall.includes("case 'feedpick'"));
  ok('ui.js 有 选部位 动作', hall.includes("case 'feedpart'"));
  ok('ui.js 有 投喂 动作', hall.includes("case 'feeddo'"));
  ok('ui.js 有 收手 动作', hall.includes("case 'feedstop'"));
  ok('投喂真的调用 COMPANION.feed', /COMPANION\.feed\(stone\.tier,\s*v2\)/.test(hall));
  ok('抉择真的调用 COMPANION.chooseFinal', /COMPANION\.chooseFinal\((true|false)\)/.test(hall));
  ok('投喂真的扣源石(消耗型动作)', /Bag\.take\(v,\s*1\)/.test(hall));
  ok('行囊渲染真的调了进度卡', /_vMutCard\(\)/.test(hall) && /_vMutCard/.test(ui), '既要有转发壳,也要有实现');

  // 谁调用 COMPANION.feed —— 必须有非测试调用点
  const comp = readFileSync(ROOT + '/js/xiuxian/companion.js', 'utf8');
  ok('COMPANION.feed 定义存在', comp.includes('feed(tier, part, rng)'));

  // 收口:定稿后不能再喂
  const done = MUTATION.defaultMut(); done.feeds = 10; done.stage = 4;
  MUTATION.resolveFinal(done, false);
  ok('定稿后 isDone=true', MUTATION.isDone(done));
  ok('未定稿时 isDone=false', !MUTATION.isDone(MUTATION.defaultMut()));
}

console.log(`\n灵伴变异体系: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项:\n  - ' + failed.join('\n  - ')); process.exit(1); }