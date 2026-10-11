// artstar-run-effect-regression.mjs —— XX-META-004「升星对局内战斗零影响」的回归门禁
//
// 病根:js/xiuxian/artstar.js 的 `ARTSTAR.effect(id)` 一直算得出
//       `{star, power, reach, extra}`,但**全仓零调用** ——
//       玩家花金币 + 传承书升的星,对局内战斗一点影响都没有(死功能)。
//       本门禁钉住接线后它**真的在生效**,并钉住接线方式不会悄悄退化。
//
// 本门禁只钉**结构性质**,不钉任何平衡数字:
//   · 「3 星时局内属性确实被放大」而不是「放大 36%」
//   · 期望倍率一律从 ARTSTAR.effect() **现取**,不在门禁里复写一遍公式
//     —— 复写一遍的话,改公式和改门禁会一起变,门禁就成了自证。
//
// 「度量工具自己出错比没有度量工具更危险」(本项目已连续栽 6 次),故本门禁自带:
//   ① 反向注入自检:把修复回退成临时副本,断言本门禁的核心判据**确实会变红**;
//   ② 空结果保护:读到 0 个节点 / 一条断言都没跑时 **exit 2**,明说「别信结论」;
//   ③ 实例身份门禁:artstar.js 必须注册到 main.js 真正使用的那**一个** upgrades 实例,
//      否则「看着接了、实际无效」(XX-AUDIT-027 栽过的坑)。
//
// 退出码:0 = 通过;1 = 不通过;2 = 门禁自身失效,**结论不可信**
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ `?v=17` 不能省:artstar.js 注册进去的、以及 main.js 用的都是这个 query 的实例。
//    这里若写成裸路径,node 会按**另一个实例**加载 upgrades.js,断言会空转。
//    (同一个坑见 xx-play-slot-composition-regression.mjs:25)
import { applyChoice, setArtStarSource, runArtSync, ART_FAMILY } from '../js/game/upgrades.js?v=17';
import { ARTS } from '../js/xiuxian/arts.js';
import { ARTSTAR } from '../js/xiuxian/artstar.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const src = f => readFileSync(join(REPO, f), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};
/** 门禁自身失效 → 退出码 2。这一格绝不能被当成「通过」。 */
const die = (...m) => { console.log(`\n🛑 ${m.join(' ')}`); console.log('   —— 别信结论:本次没有有效结论。'); process.exit(2); };

// 假 g / 假 p:字段严格按 applyChoice 真实读取的键来补。
// ⚠️ `stats.cd` / `stats.speed` 不能少 —— sword 系神通要 `p.stats.cd *= …`,
//    缺了会算出 NaN,而 NaN 的比较全是 false,门禁会「莫名其妙地红」而不是报真因。
// ⚠️ `bonuses: {}` 同样不能少(选被动时会 bon[b.key] 直接 TypeError)。
const mkG = () => ({
  player: {
    weapons: [], arts: {}, hp: 100,
    stats: { maxHp: 100, might: 1, areaMult: 1, armor: 0, cd: 1, speed: 100 },
    bonuses: {}, charBonus: { crit: 0.1 },
    recalc() {}, addShieldCapacity() {},
  },
  passiveLv: {}, stats: { gold: 0 },
  addParticles() {}, spawnText() {},
});

const FAMILY_OF = id => (ARTS[id] || {}).family;
// 真模块的引用(applyChoice + 取星源 setter 必须在同一个对象上)
const REAL = { applyChoice, setArtStarSource };

// ART_FAMILY 的键 → player.stats 上的**实际字段名**。
// area / hp 这两个键在 applyChoice 里是落到别的字段上的,直接拿 family 键去读
// stats 会读到 undefined —— 门禁会报「没被放大」这种假因(第一版就栽在这)。
const STAT_KEY = { area: 'areaMult', hp: 'maxHp' };
const sk = k => STAT_KEY[k] || k;

// 三个固定取样点(只决定「测哪门」,不参与任何平衡判断)
const TARGET = 'jianqi';   // sword:might + cd,两条通道
const WATER  = 'moyu';     // water:might + area —— reach 的落点
const FIRE   = 'fentian';  // fire:只有 might —— reach 无处可乘,用来验它不乱乘

/** 临时把某门神通置为指定星数,并封住懒加载(否则 load() 会把测试设的星冲掉) */
function withStar(id, star, fn) {
  const prevStars = ARTSTAR.s.stars, prevLoaded = ARTSTAR._loaded;
  ARTSTAR._loaded = true;
  ARTSTAR.s.stars = star > 0 ? { [id]: star } : {};
  try { return fn(); }
  finally { ARTSTAR.s.stars = prevStars; ARTSTAR._loaded = prevLoaded; }
}

/** 选中一门神通卡 → 返回 applyChoice 之后的 stats。
 *  register=false 时**不碰**取星源(用来验 artstar.js 那次模块级注册本身)。 */
function statsAfter(mod, id, star, register = true) {
  return withStar(id, star, () => {
    if (register) mod.setArtStarSource(a => ARTSTAR.effect(a));
    const g = mkG();
    mod.applyChoice(g, { kind: 'art', id, family: FAMILY_OF(id), name: '参悟' });
    return g.player.stats;
  });
}

// ───────────────────────────────────────────────────────────
// 空结果保护:一进来就确认「真的有节点可测」,否则后面全是恒真。
const artIds = Object.keys(ARTS || {});
if (artIds.length === 0) die('ARTS 是空的 —— 读到了 0 个节点。');

console.log('=== [0] 两套 id 空间是对齐的(整件事的前提) ===');
{
  // runArtSync 遍历局内 RUN_ARTS,把 p.arts 里 lv>0 的挑出来。
  // 反过来用:把 ARTS 全部当作已练到 1 级喂进去,返回的条目 = 两边都存在的 id。
  const got = runArtSync({ player: { arts: Object.fromEntries(artIds.map(k => [k, 1])) } });
  const runIds = new Set(got.map(([id]) => id));
  if (got.length === 0) die('runArtSync 返回 0 条 —— 局内神通表没读出来,别信结论。');
  const missing = artIds.filter(k => !runIds.has(k));
  t(`修仙阁 ${artIds.length} 门神通全部在局内神通表里有对应 id`,
    missing.length === 0, `局内缺:${missing.join(',')}`);
  console.log(`  ── 对齐 ${got.length}/${artIds.length} 门`);
}

console.log('\n=== [1] 端到端:artstar.js 的注册真的落到了游戏用的那个模块实例上 ===');
{
  // ⚠️ 本节必须排在任何 `setArtStarSource(...)` 调用**之前**。
  //    否则本文件自己装的源会掩盖「artstar.js 注册到了另一个实例」这个失败 ——
  //    那正是本节唯一要抓的东西。
  const up3 = statsAfter(REAL, TARGET, 3, false).might;
  const up0 = statsAfter(REAL, TARGET, 0, false).might;
  t(`★3 时 might 高于 ★0(实测 ${up0.toFixed(4)} → ${up3.toFixed(4)})`, up3 > up0,
    'artstar.js 的模块级注册没生效 —— 可能注册到了 upgrades.js 的另一个实例');

  // 实例身份的静态对照:两处 specifier 的「文件名 + query」必须一致。
  // ⚠️ artstar.js「压根没引用 upgrades.js」正是**没接线**本身(= 本门禁要抓的病),
  //    那是**判红**,不是门禁失效;只有 main.js 这边读不出来才是门禁自身的前提变了。
  const tail = s => String(s || '').split('/').pop();   // null 安全:没引用时返回 ''
  const specOf = s => (s.match(/from '([^']*upgrades\.js[^']*)'/) || [])[1] || null;
  const mainSpec = specOf(src('js/main.js'));
  const artSpec = specOf(src('js/xiuxian/artstar.js'));
  if (!mainSpec) die('main.js 里读不到 upgrades.js 的引用 —— 门禁前提变了,别信结论。');
  t(`artstar.js 注册进的就是 main.js 用的那个 upgrades.js 实例(${tail(mainSpec)} / ${tail(artSpec) || '未引用'})`,
    !!artSpec && tail(mainSpec) === tail(artSpec),
    'artstar.js 没引用 upgrades.js(= 没接线),或 query 不一致(= 两个模块实例)');
}

console.log('\n=== [2] 未注册时必须与接线前逐位相同(不改变老玩家的手感) ===');
{
  setArtStarSource(null);                       // 回到默认:没人升星
  const a = statsAfter(REAL, TARGET, 0, false).might;
  setArtStarSource(id => ARTSTAR.effect(id));   // 还原 artstar.js 那次注册
  const b = statsAfter(REAL, TARGET, 0, true).might;
  t(`默认取星源 ≡ 0 星(实测 ${a.toFixed(6)} vs ${b.toFixed(6)})`, a === b,
    '未升星玩家被接线影响了');
}

console.log('\n=== [3] 每条 family:有星时局内属性确实被放大 ===');
{
  const perFam = {};
  for (const id of artIds) (perFam[FAMILY_OF(id)] ||= []).push(id);
  const uncovered = Object.keys(perFam).filter(f => !ART_FAMILY[f]);
  if (uncovered.length) die(`这些 family 在 ART_FAMILY 里没有映射:${uncovered.join(',')}`);

  for (const [fam, ids] of Object.entries(perFam)) {
    const id = ids[0];
    const s0 = statsAfter(REAL, id, 0);
    const s3 = statsAfter(REAL, id, 3);
    // family 里每个有值的通道,在 3 星时都必须**严格变大**(只放大、不缩小)
    const weak = Object.keys(ART_FAMILY[fam])
      .filter(k => !(s3[sk(k)] > s0[sk(k)]))
      .map(k => `${sk(k)} ${s0[sk(k)]}→${s3[sk(k)]}`);
    t(`${fam}(${id}):3 星时该 family 的每个通道都被放大`, weak.length === 0, `没被放大:${weak.join(' / ')}`);
  }
}

console.log('\n=== [4] 星数越多放大越多(单调),且 0 星 = 1 星以下无加成 ===');
{
  const id = TARGET;
  const m = [0, 1, 3, 5].map(st => statsAfter(REAL, id, st).might);
  const mono = m.every((x, i) => i === 0 || x > m[i - 1]);
  t(`might 随星数单调递增(实测 ${m.map(x => x.toFixed(4)).join(' → ')})`, mono,
    '不单调说明倍率被套错了层或方向反了');
}

console.log('\n=== [5] reach 是独立于 power 的一路:只放大范围,不乱乘 ===');
{
  // 期望值一律现取自 ARTSTAR.effect,门禁里不复写公式
  const eff3 = withStar(WATER, 3, () => ARTSTAR.effect(WATER));
  const vArea = ART_FAMILY[FAMILY_OF(WATER)].area;
  const s0 = statsAfter(REAL, WATER, 0), s3 = statsAfter(REAL, WATER, 3);
  const expect = (1 + vArea * eff3.reach) / (1 + vArea);
  const real = s3.areaMult / s0.areaMult;
  t(`water 系:areaMult 放大倍数 == 1+v*reach(实测 ${real.toFixed(6)} / 期望 ${expect.toFixed(6)})`,
    Math.abs(real - expect) < 1e-9, 'reach 没接到 areaMult 上,或套到了别的通道');

  // fire 系没有 area 通道 → reach 无处可乘,areaMult 必须**原封不动**
  const f0 = statsAfter(REAL, FIRE, 0), f3 = statsAfter(REAL, FIRE, 3);
  t(`fire 系(无 area 通道):areaMult 不被 reach 顺带放大(实测 ${f0.areaMult} → ${f3.areaMult})`,
    f3.areaMult === f0.areaMult, 'reach 泄漏到了不该乘的通道上');
}

console.log('\n=== [6] 神通分支没被接线改坏(等级/回写/提示仍在) ===');
{
  const id = TARGET;
  let text = '', lv = 0, back = [];
  setArtStarSource(a => ARTSTAR.effect(a));
  withStar(id, 3, () => {
    const g = mkG();
    g.spawnText = (_x, _y, s) => { text = s; };
    applyChoice(g, { kind: 'art', id, family: FAMILY_OF(id), name: '参悟 剑气' });
    lv = g.player.arts[id];
    back = runArtSync(g);
  });
  t('局内神通等级 +1', lv === 1, `实测 ${lv}`);
  t('局末 runArtSync 仍能回写该门', back.some(([bid, , l]) => bid === id && l === 1), JSON.stringify(back));
  t('选卡提示文案仍在', text.includes('参悟 剑气'), `实测 ${JSON.stringify(text)}`);
}

console.log('\n=== [7] 单向依赖没被破(game/ 不许 import xiuxian/) ===');
{
  const upSrc = src('js/game/upgrades.js');
  t('upgrades.js 不 import 局外 xiuxian/(保住 test-runcfg.mjs 的单向门禁)',
    !/from '\.\.\/xiuxian\//.test(upSrc), '出现了反向依赖');
  t('upgrades.js 不直接读 localStorage(存档归局外管)',
    !/localStorage\./.test(upSrc));
}

console.log('\n=== [8] extra(3 星多一次):如实钉住「未接线」 ===');
{
  // extra 在局内**没有对应钩子**:投射物数量只由武器自己的等级表决定
  // (weapons.js 的 `n`,进化态是写死的常量),player.stats 上没有乘到
  // 投射物数量上的字段。要接就得改 weapons.js 十几处开火点 —— 那是臆造。
  const upSrc = src('js/game/upgrades.js');
  t('局内没有消费 effect.extra(它确实还没接,别误以为已生效)',
    !/\beff\.extra\b/.test(upSrc) && !/\.extra\b(?!\w)/.test(upSrc.replace(/extraShot|extraProjectile/g, '')),
    'extra 被消费了 —— 若已实现,请同步更新本断言与 artstar.js 的注释');
  console.log('  ── 依据:weapons.js 的投射物数量来自 `b.n[L]` / 写死的进化常量,');
  console.log('     player.stats 上不存在可乘该数量的字段 → extra 无处可接,未臆造钩子。');
}

console.log('\n=== [9] 本门禁自身的反向注入自检:回退修复后必须判红 ===');
{
  // 把 pw / reach 强制回 1(等价于「修复前的 upgrades.js」),其余原样。
  const ANCHORS = [
    ["const pw = eff && Number.isFinite(eff.power) ? eff.power : 1;",
     "const pw = 1; // ← 反向注入:回退到接线前"],
    ["const reach = eff && Number.isFinite(eff.reach) ? eff.reach : 1;",
     "const reach = 1; // ← 反向注入:回退到接线前"],
  ];
  const mk = () => {
    let s = src('js/game/upgrades.js');
    for (const [from, to] of ANCHORS) {
      if (!s.includes(from)) return null;            // 锚点变了 → 老实认输
      s = s.replace(from, to);
    }
    // ⚠️ 查询串必须一起搬,否则变体文件里会变成 '...js'?v=17' 拼接错乱
    s = s.replace(/from '\.\.\/core\/([\w.]+)(\?[^']*)?'/g,
        (_m, n, q) => `from '${join(REPO, 'js/core', n)}${q || ''}'`)
      .replace(/from '\.\/(weapons|enemies)\.js(\?[^']*)?'/g,
        (_m, n, q) => `from '${join(REPO, 'js/game', n + '.js')}${q || ''}'`);
    const f = join(dir, 'reverted.mjs');
    writeFileSync(f, s);
    return f;
  };

  const dir = mkdtempSync(join(tmpdir(), 'xxartstar-'));
  try {
    const f = mk();
    if (!f) die('反向注入的锚点变了(upgrades.js 的 pw / reach 那两行)—— 本节无法执行。');
    const v = await import(f + '?t=' + Date.now());
    // ⚠️ ★3 与 ★0 必须在**两个不同的 withStar 作用域**里各跑一次 ——
    //    第一版把两次 applyChoice 都塞进同一个 withStar(..., 3),等于 ★3 比 ★3,
    //    差恒为 0,反向自检就会「两条都绿」地空转过去。
    const mightOnce = (mod, star) => withStar(TARGET, star, () => {
      mod.setArtStarSource(a => ARTSTAR.effect(a));
      const g = mkG();
      mod.applyChoice(g, { kind: 'art', id: TARGET, family: FAMILY_OF(TARGET), name: '参悟' });
      return g.player.stats.might;
    });
    const amp = mod => mightOnce(mod, 3) - mightOnce(mod, 0);   // 3 星比 0 星多拿的 might
    const real = amp(REAL);
    const rev = amp({ applyChoice: v.applyChoice, setArtStarSource: v.setArtStarSource });
    console.log(`  ── 真模块:3 星带来的额外 might ${real.toFixed(6)} | 回退后:${rev.toFixed(6)}`);
    t('反向自检:真模块下 3 星确实放大 might', real > 0);
    t('反向自检:把修复回退后,同一判据必须归零(门禁会红)', rev === 0,
      '回退了修复门禁还判绿 → 这条断言是恒真的,没有牙齿');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 收口:一条都没跑 = 门禁自己坏了 ────────────────────────
if (pass + fail === 0) die('一条断言都没执行 —— 门禁自身失效,别信结论。');

if (fail === 0) {
  console.log(`\n✅ XX-META-004 升星接线门禁 通过:${pass} 项(升星对局内战斗不再零影响)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 升星对局内战斗的影响退化了`);
  process.exit(1);
}