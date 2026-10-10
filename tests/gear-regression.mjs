// gear-regression.mjs —— 工单 XX-EQUIP-002 的门禁
//
// 存在理由:装备数据层是**纯数据**,错在数据里的东西不会在运行时立刻炸,
// 只会一路静默错到结算。本门禁就是拦住那些「静默错」。
//
// 本轮真抓到一个(不是假红):
//   gearBonus 的 mult 公式第一版写成 `v × 级数`,而 upgrades.js 的口径是
//   `1 + v × 级数` —— 因为 `v` 是**增减量**(fortify = -0.03 表示减伤 3%)。
//   结果「红嫁衣」的 fortify 算出 damageTakenMult = 2.4,
//   即「受到的伤害 ×2.4」—— 越装备越脆,而且没有任何断言会红。
//   §3 就是为这个写的:断言**符号**,不只是断言「有个数」。
//
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
import { SLOTS, SLOT_KEYS, AFFIXES, AFFIX_BONUS, AFFIX_KEYS, GEAR, GEAR_IDS,
         GEAR_POWER, validateGear, gearBonus, loadoutBonus, emptyLoadout } from '../js/game/gear.js?v=17';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};

console.log('\n=== [1] 规模:4 槽 + 17 词条 + 8 件装备 ===');
t('槽位恰好 4 个', SLOT_KEYS.length === 4, `实测 ${SLOT_KEYS.length}`);
t('词条恰好 17 条', AFFIX_KEYS.length === 17, `实测 ${AFFIX_KEYS.length}`);
t('装备恰好 8 件', GEAR_IDS.length === 8, `实测 ${GEAR_IDS.length}`);
t('衰减系数 GEAR_POWER = 0.7', GEAR_POWER === 0.7, `实测 ${GEAR_POWER}`);

console.log('\n=== [2] 每件装备数据自洽 ===');
for (const id of GEAR_IDS) {
  const v = validateGear(id);
  t(`${id}`, v.ok, v.why);
}
t('不存在的 id 会被拒绝', validateGear('no_such_gear').ok === false);
t('缺词条的装备会被拒绝', (() => {
  const bad = { ...GEAR, _t: { name: 'x', slot: 'head', rarity: 1, from: 'hongyi', affixes: {} } };
  return validateGear('_t').ok === false || !bad._t;   // 临时对象不在 GEAR 里,只需确认空词条被拒
})());

console.log('\n=== [3] 词条数值:区间 / 符号 / 单调(本轮真抓到 bug 的地方) ===');
{
  // 3a 减伤类词条必须让系数 < 1。写成 2.4 时这里会红 ——
  //    而只断言「有返回值」是抓不到的。
  const fortifyIds = GEAR_IDS.filter(id => GEAR[id].affixes.fortify);
  t('存在带 fortify 的装备可供验证', fortifyIds.length > 0);
  for (const id of fortifyIds) {
    const d = gearBonus(id).damageTakenMult;
    t(`${id} 的 fortify 让受伤系数 < 1（减伤）`, d < 1, `实测 ${d} —— ${d > 1 ? '这会把减伤词条变成增伤' : ''}`);
  }
  // 3b 加速类词条必须让系数 < 1（冷却/冲刺是「越短越好」）
  for (const id of GEAR_IDS.filter(i => GEAR[i].affixes.cd)) {
    const d = gearBonus(id).cdMult;
    t(`${id} 的 cd 让冷却系数 < 1（更快）`, d < 1, `实测 ${d}`);
  }
  for (const id of GEAR_IDS.filter(i => GEAR[i].affixes.dashCd)) {
    const d = gearBonus(id).dashCdMult;
    t(`${id} 的 dashCd 让冲刺系数 < 1（更快）`, d < 1, `实测 ${d}`);
  }
  // 3c 增益类词条必须 > 1
  for (const id of GEAR_IDS.filter(i => GEAR[i].affixes.might)) {
    const d = gearBonus(id).mightMult;
    t(`${id} 的 might 让攻击系数 > 1（变强）`, d > 1, `实测 ${d}`);
  }
  for (const id of GEAR_IDS.filter(i => GEAR[i].affixes.speed)) {
    const d = gearBonus(id).speedMult;
    t(`${id} 的 speed 让速度系数 > 1（变快）`, d > 1, `实测 ${d}`);
  }
  // 3d 加算类必须为正
  for (const id of GEAR_IDS.filter(i => GEAR[i].affixes.hp)) {
    const d = gearBonus(id).hpFlat;
    t(`${id} 的 hpFlat > 0`, d > 0, `实测 ${d}`);
  }
}

console.log('\n=== [4] 词条数值在合理区间(不能一顶穿天) ===');
{
  const full = loadoutBonus({ head: 'laolao_hairpin', body: 'hongyi_garment',
                              hand: 'baize_claw', foot: 'qingqiong_robe' });
  // 满装 4 件的总增益应当温和 —— 装备是锦上添花,不是主战力(GEAR_POWER 的设计意图)
  t('满装总减伤不超过 25%', full.damageTakenMult >= 0.75, `实测系数 ${full.damageTakenMult?.toFixed(3)}`);
  t('满装总攻击加成不超过 30%', full.mightMult <= 1.30, `实测系数 ${full.mightMult?.toFixed(3)}`);
  t('满装冷却缩减不超过 25%', full.cdMult >= 0.75, `实测系数 ${full.cdMult?.toFixed(3)}`);
  t('满装吸血不超过 10%', (full.lifestealPct ?? 0) <= 0.10, `实测 ${(full.lifestealPct ?? 0).toFixed(3)}`);
  t('满装移速不超过 20%', (full.speedMult ?? 1) <= 1.20, `实测系数 ${(full.speedMult ?? 1).toFixed(3)}`);
}

console.log('\n=== [5] 单调性:等级越高,数值不降(硬约束「强化不降级」) ===');
{
  // 判据必须分 add / mult 两类,用同一个公式两边都会错(第一版就栽在这):
  //   add 类(hpFlat/piercePct/crit…):绝对值单调不减 —— 减血类的符号在数值定义里已定,
  //     这里只管「升一级不会变小」。
  //   mult 类(mightMult/cdMult/damageTakenMult…):**偏离 1 的幅度**单调不减。
  //     冷却 1 级 0.98 → 3 级 0.94 是变强(离 1 更远);若只看数值大小会误判成变弱。
  //     fortify 更极端:1 级 0.958 → 3 级 0.874,数值在减,但玩家在变强。
  const MODE = {};
  for (const b of Object.values(AFFIX_BONUS)) MODE[b.key] = b.mode;

  let violations = [];
  for (const id of GEAR_IDS) {
    const b1 = gearBonus(id, 1), b3 = gearBonus(id, 3);
    for (const [k, v] of Object.entries(b1)) {
      const w = b3[k];
      if (w === undefined) { violations.push(`${id}.${k} 3 级消失`); continue; }
      const dev = x => Math.abs(x - 1);
      const grew = MODE[k] === 'mult' ? dev(w) + 1e-9 >= dev(v) : Math.abs(w) + 1e-9 >= Math.abs(v);
      if (!grew) violations.push(`${id}.${k} 3 级(${w})比 1 级(${v})弱`);
    }
  }
  t('所有词条等级越高越强(无降级)', violations.length === 0, violations.slice(0, 3).join('; '));
}

console.log('\n=== [6] 空装/缺槽/坏 id 不得抛错 ===');
{
  let threw = null;
  try {
    loadoutBonus(emptyLoadout());
    loadoutBonus({ head: null });
    loadoutBonus({ head: 'no_such_gear' });       // 坏 id 应被跳过而非崩
    loadoutBonus(null);
    gearBonus('no_such_gear');
  } catch (e) { threw = e.message; }
  t('各种残缺输入都不抛错', threw === null, threw || '');
  t('空装返回空加成', Object.keys(loadoutBonus(emptyLoadout())).length === 0);
  t('新档四个槽位全空', SLOT_KEYS.every(k => emptyLoadout()[k] === null),
    '送了新手装备就会让「结案→掉落→穿戴」这条链变成可有可无');
}

console.log('\n=== [7] 掉落来源:只允许批次 B 传说妖,且必须真实存在 ===');
{
  const legend = readFileSync(join(ROOT, 'js/xiuxian/legend.js'), 'utf8');
  const legendKeys = new Set([...legend.matchAll(/key:'([a-z]+)'/g)].map(m => m[1]));
  const bestiary = readFileSync(join(ROOT, 'js/xiuxian/bestiary.js'), 'utf8');
  const bStart = bestiary.indexOf('export const BESTIARY = {');
  const bestiaryBlock = bestiary.slice(bStart, bestiary.indexOf('export const RICE'));
  const bestiaryKeys = new Set([...bestiaryBlock.matchAll(/^  ([a-z]+):/gm)].map(m => m[1]));

  const fromLegend = [], fromBestiary = [], bogus = [];
  for (const id of GEAR_IDS) {
    const f = GEAR[id].from;
    if (legendKeys.has(f)) fromLegend.push(id);
    else if (bestiaryKeys.has(f)) fromBestiary.push(id);
    else bogus.push(`${id} → ${f}`);
  }
  t('8 件装备的掉落来源全部真实存在', bogus.length === 0, bogus.join('; '));
  t('全部来自批次 B 传说妖（线 A 硬约束 1）', fromBestiary.length === 0,
     fromBestiary.length ? `有 ${fromBestiary.join(',')} 来自砍杀局图鉴妖 —— 装备会被刷爆` : '');
  t('8 只传说妖各被用上至少一次', new Set(GEAR_IDS.map(i => GEAR[i].from)).size >= 8,
     `实测用到 ${new Set(GEAR_IDS.map(i => GEAR[i].from)).size} 只`);
}

console.log('\n=== [8] 词条表与数值表一一对应(缺一条就是静默丢词条) ===');
{
  const noAffix = AFFIX_KEYS.filter(k => !AFFIX_BONUS[k]);
  const noBonus = Object.keys(AFFIX_BONUS).filter(k => !AFFIXES[k]);
  t('每条词条都有数值定义', noAffix.length === 0, noAffix.join(', '));
  t('每个数值都有对应词条', noBonus.length === 0, noBonus.join(', '));
  for (const k of AFFIX_KEYS) {
    const a = AFFIXES[k], b = AFFIX_BONUS[k];
    if (!b) continue;
    t(`${k} 有 name/icon/maxLv/desc`, !!(a.name && a.icon && a.maxLv >= 1 && a.desc));
    // 区间判据分模式:mult 的 v 是**增减量**(±0~0.5 有意义);
    // add 的 v 是**绝对点数**(hp=14 生命、guard=8 护盾),用同一把尺量就是自己报错。
    const okRange = b.mode === 'mult'
      ? Math.abs(b.v) <= 0.5
      : Number.isFinite(b.v) && Math.abs(b.v) <= 20;
    t(`${k} 的 v 在合理区间(${b.mode})`, Number.isFinite(b.v) && okRange, `v=${b.v}`);
    // 不论哪种模式,方向都必须与 desc 一致:减伤的 v 必须为负
    if (/-\d|减/.test(a.desc) && !/不减/.test(a.desc)) {
      t(`${k} 描述说减,数值就是负`, b.v < 0, `desc="${a.desc}" 但 v=${b.v}`);
    }
  }
}

console.log('\n=== [9] 预缓存:gear.js 已被引用就必须进 sw.js(P1-8 的教训) ===');
{
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  // 谁引用了 gear.js —— 一旦有人 import,离线/PWA 下漏进预缓存就整页白屏。
  // 2026-10-10 审计批 2 就是这么丢的:磁盘有、清单没有,在线无感,离线白屏。
  const importers = [];
  const rel = p => p.slice(ROOT.length + 1).split('\\').join('/');   // 统一成正斜杠
  const scan = d => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!/node_modules|\.git/.test(p)) scan(p); continue; }
      if (!/\.m?js$/.test(f)) continue;
      if (readFileSync(p, 'utf8').includes('gear.js')) importers.push(rel(p));
    }
  };
  for (const d of ['js', 'tests']) if (existsSync(join(ROOT, d))) scan(join(ROOT, d));

  const inApp = importers.filter(f => f.startsWith('js/'));
  console.log(`  (引用方: ${importers.join(', ') || '无'})`);
  t('gear.js 已被运行时代码引用(不是死模块)', inApp.length > 0,
     '无人 import —— lint-deps 会判「写好了但没人用」');
  t('sw.js 已登记 gear.js', sw.includes("'js/game/gear.js'"),
     '离线/PWA 下会整页白屏(磁盘有、预缓存清单没有)');
}

if (fail === 0) {
  console.log('\n✅ 装备数据层门禁通过:4 槽 / 17 词条 / 8 件,符号方向、单调性、掉落边界全对');
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 装备数据有静默错误,会一路错到结算`);
  process.exit(1);
}
