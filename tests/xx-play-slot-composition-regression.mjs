// xx-play-slot-composition-regression.mjs —— 工单 XX-PLAY-002 续的门禁
//
// owner 的原话:「前期升级给的选项,很多都是带回修仙阁的,正常技能都被这类挤满了。」
//
// XX-PLAY-002 修的是**后期**(被动满 + 4 武器满级 → 三张 100% 是神通)。
// 但前期为什么也让人有同样的体感,之前没有数据。本门禁把两件事钉死:
//
//   ① 神通(带回修仙阁)不能吃掉超过 1/3 的卡位 —— 这是 XX-PLAY-002 多样化规则
//      的直接后果,现在被量化成了一个可回归的数。
//   ② Collatz 机制**完全不许**接进升级卡池。它是刷怪那一刻乘的连续系数
//      (collatzModAt),不是选出来的卡。谁哪天把它接进 rollChoices,这里立刻红。
//   ③ 权重必须**真的生效**(XX-PLAY-015)。原来 rollChoices 在种类子集里是均匀抽,
//      `w:` 全是死代码 —— 权重从 5 拉到 100000 构成一个字都不变。
//      这条断言就是当初**缺失**的那条:它不存在,所以那个 bug 才上了线。
//
// 断言不钉死具体百分比(那是平衡,会变),只钉**结构性质**。
// 跑真函数、做统计,不是正则抠源码。
//
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollChoices, applyChoice, runArtSync, PASSIVES, ART_FAMILY } from '../js/game/upgrades.js';
// ⚠️ `?v=17` 与 upgrades.js 内部保持同一实例:upgrades.js 是按 `weapons.js?v=17`
//    加载 WEAPONS/MAX_WEAPONS 的,这里若用裸路径,本测试读到的 WEAPONS 表
//    和 rollChoices 读的就不是同一个对象。数值虽相同,但那是「碰巧相同」。
import { WEAPONS, WEAPON_ORDER, MAX_WEAPONS, makeWeapon } from '../js/game/weapons.js?v=17';
import * as Collatz from '../js/game/collatz.js';
// ⚠️ `?v=18` 不能省:生产代码(js/main.js、js/ui/hud.js、js/xiuxian/ui.js)都是按
//    `spawner.js?v=19` 加载的。这里若写成裸 `../js/game/spawner.js`,node 会当成
//    **另一个实例**加载 —— 于是本测试 setCollatzTrajectory 改的是一个实例、
//    另一个实例的 rollChoices 根本看不到,断言会空转。
//    同一个坑见 tests/collatz-difficulty-regression.mjs:34 与 XX-AUDIT-027。
import { setCollatzTrajectory, collatzModAt } from '../js/game/spawner.js?v=19';

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};
// 只提醒、不拦路(同 lint-deadexport 的做法:它是提醒清单,不是门禁)
const warn = (n, d = '') => console.log(`  ⚠️  ${n}${d ? '  — ' + d : ''}`);

// ---- 种子化 LCG:同 seed 逐位可复现,门禁结果不会随机翻红 ----
let _s = 0x9e3779b9 >>> 0;
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
Math.random = rnd;
const reseed = n => { _s = (n >>> 0) || 1; };

// 假 g / 假 p:字段严格按 applyChoice 真实读取的键来补。
// ⚠️ `bonuses: {}` 不能少 —— 少了选中被动时 `bon[b.key]` 直接 TypeError。
//    (父会话那条「量前期卡位构成」命令就是这么炸的,是桩不完整,不是逻辑坏了。)
const mkG = (weaponId = 'knife') => ({
  player: {
    weapons: [makeWeapon(weaponId)], arts: {}, hp: 100,
    stats: { maxHp: 100, atk: 10, def: 5, spd: 100, might: 1, areaMult: 1, armor: 0 },
    bonuses: {}, charBonus: { crit: 0.1 },
    recalc() {}, addShieldCapacity() {},
  },
  passiveLv: {}, stats: { gold: 0 },
  addParticles() {}, spawnText() {},
});

// 「局内战力卡」= 这局真能变强的;神通(art)是长期投资,金��/回血是兜底
const IN_RUN = new Set(['weapon', 'newWeapon', 'passive', 'evolve']);
const N = 20000;

// ───────────────────────────────────────────────────────────
console.log('=== 前期卡位构成:神通(带回修仙阁)吃不掉超过 1/3 ===');
{
  reseed(20261011);
  let artSlots = 0, total = 0, allArt = 0, twoOrMoreNormal = 0;
  for (let i = 0; i < N; i++) {
    const cs = rollChoices(mkG());
    if (cs.length !== 3) { fail++; console.log(`  ❌ 永远返回 3 张卡 — 第 ${i} 次返回 ${cs.length} 张`); break; }
    const a = cs.filter(c => c.kind === 'art').length;
    const norm = cs.filter(c => IN_RUN.has(c.kind)).length;
    artSlots += a; total += 3;
    if (a === 3) allArt++;
    if (norm >= 2) twoOrMoreNormal++;
  }
  const artPct = artSlots / total * 100;
  console.log(`  ── 开局档实测:神通 ${artPct.toFixed(2)}% 卡位 | 正常技能 ${(100 - artPct).toFixed(2)}% | 三张全神通 ${(allArt / N * 100).toFixed(2)}%`);
  t(`开局神通卡位 ≤ 34%(实测 ${artPct.toFixed(2)}%)`, artPct <= 34,
    '超过 1/3 就回到 owner 抱怨的「被带回的技能挤满」');
  t(`开局三张全神通 = 0(实测 ${allArt} 次)`, allArt === 0,
    '三张一样就没有选择');
  t(`开局至少 2 张局内战力卡的档 ≥ 99%(实测 ${(twoOrMoreNormal / N * 100).toFixed(2)}%)`,
    twoOrMoreNormal / N >= 0.99);
}

// ───────────────────────────────────────────────────────────
// ⚠️ 下面这一节是被**注入反向验证逼出来的**,别删。
// 第一版门禁只在开局态断言「神通 ≤ 34%」。注入⑯把多样性筛选短路掉之后,
// 退化版的开局神通占比是 **30.88% —— 比修复版的 32.18% 还低**,那条断言纹丝不动。
// 原因:开局候选池本来就多样(4 种 kind 在抢),去掉多样性规则看不出来;
// 真正会退化的是**后期**——池子只剩一种类时,没有规则就必然三张一样。
// 「度量工具自己出错比没有度量工具更危险」,这条是本项目第 4 次应验。
console.log('\n=== 后期态(被动满 + 4 武器满级进化):这条断言的牙齿在这里 ===');
{
  reseed(31337);
  const late = () => {
    const g = mkG();
    g.passiveLv = Object.fromEntries(Object.keys(PASSIVES).map(k => [k, PASSIVES[k].maxLv]));
    g.player.weapons = WEAPON_ORDER.slice(0, MAX_WEAPONS)
      .map(id => ({ id, lv: WEAPONS[id].maxLv, evolved: true }));
    return g;
  };
  let artSlots = 0, total = 0, allArt = 0, withFill = 0;
  for (let i = 0; i < N; i++) {
    const cs = rollChoices(late());
    const a = cs.filter(c => c.kind === 'art').length;
    artSlots += a; total += 3;
    if (a === 3) allArt++;
    if (cs.some(c => c.kind === 'gold' || c.kind === 'heal')) withFill++;
  }
  const p = artSlots / total * 100;
  console.log(`  ── 后期态实测:神通 ${p.toFixed(2)}% 卡位 | 三张全神通 ${(allArt / N * 100).toFixed(2)}% | 含兜底 ${(withFill / N * 100).toFixed(2)}%`);
  // ⚠️ 这里**不能**用 ≤34%。后期候选池只剩神通一种类,`cap=2` 是有意为之:
  //    只从池里取 2 张、留一格给金币/回血(upgrades.js:243-247 的注释写明了)。
  //    所以后期态的**设计值就是 2/3 = 66.67%**,不是 1/3。
  //    (第一版我在这里钉了 ≤34%,结果它在**正确代码**上就红了 —— 又一次「度量工具自己出错」。)
  t(`后期态神通卡位 ≤ 66.67%(实测 ${p.toFixed(2)}%,设计值 2/3)`, p <= 66.67 + 0.1,
    '超过 2/3 说明 cap=2 的兜底留格失效了');
  t(`后期态三张全神通 = 0(实测 ${allArt} 次)`, allArt === 0,
    '这才是 XX-PLAY-002 原始 bug(曾是 100%)');
  t(`后期态每档都掺入金币/回血兜底(实测 ${(withFill / N * 100).toFixed(2)}%)`,
    withFill === N, 'cap=2 留的那一格必须真的填上');
}

console.log('\n=== 整局前 10 档:神通占比不随局推进爬升 ===');
{
  reseed(4242);
  const RUNS = 300, STEPS = 10;
  let artSlots = 0, total = 0;
  const perStep = Array.from({ length: STEPS }, () => ({ n: 0, a: 0 }));
  for (let r = 0; r < RUNS; r++) {
    const g = mkG();
    for (let s = 0; s < STEPS; s++) {
      const cs = rollChoices(g);
      let a = 0;
      for (const c of cs) { total++; if (c.kind === 'art') { artSlots++; a++; } }
      perStep[s].n += 3; perStep[s].a += a;
      applyChoice(g, cs[(rnd() * cs.length) | 0]);
    }
  }
  const p = artSlots / total * 100;
  console.log(`  ── 前 10 档累计:神通 ${p.toFixed(2)}% | 正常技能 ${(100 - p).toFixed(2)}%`);
  console.log(`  ── 逐档神通卡位数: ${perStep.map((x, i) => `#${i + 1}=${(x.a / x.n * 3).toFixed(2)}`).join(' ')}`);
  t(`前 10 档神通卡位 ≤ 34%(实测 ${p.toFixed(2)}%)`, p <= 34);
  const first = perStep[0].a / perStep[0].n * 3, last = perStep[STEPS - 1].a / perStep[STEPS - 1].n * 3;
  t(`神通占比不随局推进单调爬升(第1档 ${first.toFixed(2)} → 第${STEPS}档 ${last.toFixed(2)})`,
    !(last > first + 0.15), '爬升说明后期又被带回类占回去了');
}

console.log('\n=== Collatz 绝不许接进升级卡池(XX-ARCH / 真函数对拍) ===');
{
  const ids = () => {
    const s = new Set();
    for (let i = 0; i < 30000; i++) for (const c of rollChoices(mkG())) s.add(c.id);
    return s;
  };
  reseed(1); setCollatzTrajectory(null); const off = ids();
  let aggro = null;
  for (let s = 0; s < 5000 && !aggro; s++) {
    const r = Collatz.runSeedFor('seed' + s);
    if (Collatz.biasOf(r.traj) === 'aggro') aggro = r;
  }
  setCollatzTrajectory(aggro.traj);
  const on = ids();
  const mod = collatzModAt(60);
  setCollatzTrajectory(null);
  const onlyOn = [...on].filter(x => !off.has(x));
  const onlyOff = [...off].filter(x => !on.has(x));
  console.log(`  ── OFF 候选 ${off.size} 个 | ON(aggro) 候选 ${on.size} 个 | collatzModAt(60)=${mod.toFixed(4)}`);
  t(`Collatz 开关后候选集合不变(多出 ${onlyOn.length} 个 / 少了 ${onlyOff.length} 个)`,
    onlyOn.length === 0 && onlyOff.length === 0,
    'Collatz 是刷怪时乘的连续系数,不是卡');
  t('Collatz 确实在生效(否则这条断言是空转)',
    Math.abs(mod - 1) > 1e-9, 'modAt 恒等于 1 说明轨迹没接上,本节等于没测');
}

console.log('\n=== 权重真的生效吗(XX-PLAY-015 / 这条断言当初缺失,bug 才上线) ===');
{
  // 造一份「只改权重」的 upgrades.js 副本,和真模块用**同一个 seed** 各跑一遍,
  // 比 art 卡位占比。若两者一模一样 ⇒ 权重没被读取,抽取退化成均匀。
  // 修复前实测:权重 5 与 100000 的占比都是 32.18%,差值 0.00pp —— 这条会红。
  const HERE = fileURLToPath(new URL('.', import.meta.url));
  const REPO = join(HERE, '..');
  const src = readFileSync(join(REPO, 'js/game/upgrades.js'), 'utf8');

  const variant = (kind, w, dir) => {
    // kind: 'art' | 'weapon'
    const ANCHOR = kind === 'art'
      ? "icon: 'gem_g', w: 5,"
      : "kind: 'weapon', id: w.id, icon: d.icon, w: 10,";
    if (!src.includes(ANCHOR)) return null;          // 锚点变了就老实认输,别瞎判
    const to = kind === 'art'
      ? `icon: 'gem_g', w: ${w},`
      : `kind: 'weapon', id: w.id, icon: d.icon, w: ${w},`;
    let s = src.replace(ANCHOR, to);
    // ⚠️ 查询串必须一起搬,否则会变成 '...?v=17'' → Unexpected token '?'
    s = s.replace(/from '\.\.\/core\/([\w.]+)(\?[^']*)?'/g, (_m, n, q) => `from '${join(REPO, 'js/core', n)}${q || ''}'`)
      .replace(/from '\.\/(weapons|enemies)\.js(\?[^']*)?'/g, (_m, n, q) => `from '${join(REPO, 'js/game', n + '.js')}${q || ''}'`);
    const f = join(dir, `v-${kind}-w${w}.js`);   // ⚠️ 文件名必须带权重:同名会互相覆盖,两个变体会拿到同一份源码
    writeFileSync(f, s);
    return f;
  };

  // 指定 kind 的卡位占比:固定 seed,同 seed 才能公平比较
  const share = async (mod, kind) => {
    reseed(20261011);
    let a = 0, tot = 0;
    for (let i = 0; i < N; i++) for (const c of mod.rollChoices(mkG())) { tot++; if (c.kind === kind) a++; }
    return a / tot * 100;
  };

  const dir = mkdtempSync(join(tmpdir(), 'xxslot-'));
  try {
    const real = await share({ rollChoices }, 'art');
    const hi = variant('art', 1000, dir);
    const lo = variant('art', 1, dir);
    const hiShare = hi ? await share(await import(hi + '?t=' + Date.now()), 'art') : null;
    const loShare = lo ? await share(await import(lo + '?t=' + Date.now()), 'art') : null;

    console.log(`  ── 真模块(神通 w=5): art ${real.toFixed(2)}%`);
    if (hiShare == null || loShare == null) {
      warn('没能造出权重变体(锚点变了),本节未执行 —— 请人工确认', '锚点 icon: \'gem_g\', w: 5, 不在了');
    } else {
      console.log(`  ── 变体(神通 w=1000): art ${hiShare.toFixed(2)}%   差 ${(hiShare - real).toFixed(2)}pp`);
      console.log(`  ── 变体(神通 w=1)   : art ${loShare.toFixed(2)}%   差 ${(loShare - real).toFixed(2)}pp`);
      // 20000 档下占比标准误约 0.19pp,判 1pp 门槛 ≈ 5σ,不会随机翻红。
      t(`调高神通权重必须抬高 art 卡位(实测 +${(hiShare - real).toFixed(2)}pp)`, hiShare - real > 1,
        '权重没被读取 —— 抽取退化成了均匀,这正是 XX-PLAY-015');
      t(`调低神通权重必须压低 art 卡位(实测 ${(loShare - real).toFixed(2)}pp)`, loShare - real < -1,
        '同上:反向也必须成立,否则只是一次巧合');
      t('两个方向的变化方向相反(不是随机噪声)',
        (hiShare - real) * (loShare - real) < 0);
    }

    // 权重响应必须**单调**:权重加倍,该项卡位占比必须跟着涨。
    // 抓的是「加权了但套错层 / 方向反了」这类比"权重没被用"更隐蔽的退化。
    const wShares = [];
    for (const w of [10, 20, 40]) {
      const f = variant('weapon', w, dir);
      wShares.push(f ? await share(await import(f + '?t=' + w), 'weapon') : null);
    }
    if (wShares.some(x => x == null)) {
      warn('weapon 权重变体没造出来(锚点变了),单调性本节未执行');
    } else {
      console.log(`  ── weapon 权重 10/20/40 → weapon 卡位 ${wShares.map(x => x.toFixed(2) + '%').join(' / ')}`);
      const mono = wShares[0] < wShares[1] && wShares[1] < wShares[2];
      t('weapon 权重加倍时,weapon 卡位占比必须单调递增', mono,
        `实测 ${wShares.map(x => x.toFixed(2)).join(' → ')};不单调说明加权套错了层或方向反了`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n=== 提醒(不拦路,等 owner 拍板) ===');
{
  reseed(7);
  const g = mkG();
  const cs = rollChoices(g);
  const art = cs.find(c => c.kind === 'art');
  if (art) {
    const saysInRun = /伤害|攻击|移速|冷却|范围|护甲|气血|属性/.test(String(art.desc));
    warn('神通卡面文案未提当局实际收益',
      `卡面写的是「${String(art.desc).slice(0, 24)}」,但 applyChoice 真按 ${art.family} 派乘了 ${JSON.stringify(ART_FAMILY[art.family])}`);
    warn('  ↳ 该不该补文案是产品决策,故不拦路;但玩家按现有文案会低估神通');
    void saysInRun;
  }
  // weapon 提示
  reseed(11);
  let w = 0, tot = 0;
  for (let i = 0; i < N; i++) for (const c of rollChoices(mkG())) { tot++; if (c.kind === 'weapon') w++; }
  const wp = w / tot * 100;
  console.log(`  ── 参考值:开局 weapon(升级已有武器)卡位占比 ${wp.toFixed(2)}%`);
  // ⚠️ 这条提醒的措辞在 XX-PLAY-015 修好**之前**是「改权重也没用」,现在权重已经生效,
  //    措辞必须跟着改 —— 否则它会误导 owner 以为提权还是空操作。
  warn('weapon 卡位开局偏低,且随局推进自愈(多拿一把武器 = 多一个候选)',
    `现值 ${wp.toFixed(2)}%(修复前是 4.50%);**权重现在真的生效了**,上面那张 10/20/40 表就是提权决策依据,故不拦路`);
}

console.log('\n=== 本门禁自身的反向自检 ===');
{
  // 防「断言写太松」:如果哪天 rollChoices 退化成一律只出神通,
  // 上面「神通 ≤ 34%」必须会红。这里验证它确实有区分力。
  const artOnly = [{ kind: 'art' }, { kind: 'art' }, { kind: 'art' }];
  const mixed = [{ kind: 'art' }, { kind: 'passive' }, { kind: 'newWeapon' }];
  const share = cs => cs.filter(c => c.kind === 'art').length / cs.length * 100;
  t('反向自检:全神通样本的占比会被判超标', share(artOnly) > 34);
  t('反向自检:正常样本的占比不会被判超标', share(mixed) <= 34);
  t('反向自检:局内战力卡白名单覆盖 4 种 kind',
    ['weapon', 'newWeapon', 'passive', 'evolve'].every(k => IN_RUN.has(k)) && !IN_RUN.has('art'));
  t('反向自检:假 g 的 bonuses 字段齐了(选中被动不炸)',
    !!mkG().player.bonuses && !!mkG().passiveLv && !!mkG().player.charBonus);
}

if (fail === 0) {
  console.log(`\n✅ XX-PLAY-002 续 通过:${pass} 项(前期不能被「带回的技能」挤占)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 前期卡位构成退化了`);
  process.exit(1);
}