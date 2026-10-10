// ===== 装备 · 词条 · 槽位 —— 工单 XX-EQUIP-002 =====
//
// 本文件是**纯数据层**:只定义「有什么装备、每件带什么词条、装哪个槽」,
// **不碰任何战斗逻辑**。吸血/自愈怎么进伤害结算是 XX-EQUIP-004(桌面侧)的事。
//
// 为什么这么切:装备系统最容易出的事故是「加了件装备,把结算链改坏了」。
// 本项目历史上出过一次双写把存档金币 8888→30(工单 XX-AUDIT-006 批 2)。
// 所以先把数据定死、门禁跑绿,再让桌面侧碰结算 —— 两边互不阻塞。
//
// schema 沿用 upgrades.js 的 PASSIVES(name/icon/maxLv/desc)四字段,
// **故意不新造一套**:同一套 schema 才能让装备词条复用现成的词条表和 UI 渲染。
//
// 词条数值遵循 JOINT-DEV-PLAN 线 A 的硬约束:
//   · 强化**不降级**、不做耐久、不做套装 —— 降级会把玩家气走。
//   · 装备只走支线/副本结案掉落,**绝不进砍杀局普通池** —— 稀有度归零。
//
// 权威对照表(谁掉什么):docs/GEAR-TABLE.md
// 门禁(掉落来源真的存在吗):tests/lint-gear-table.mjs

/** 装备衰减系数:装备词条比局内被动弱一档,免得「打本」比「砍杀」划算。
 *  0.7 = 词条数值 × 0.7。设计意图是让装备**锦上添花**,不做主战力来源。 */
export const GEAR_POWER = 0.7;

/** 4 个槽位。刻意只有 4 个 —— 4 槽 × 已有词条已能产生足够多的组合,
 *  再多就变成纯数值竞赛;再叠套装就是第二层复杂度(线 A 硬约束 3)。 */
export const SLOTS = [
  { key: 'head', name: '额饰', icon: 'g_head', desc: '头上所戴' },
  { key: 'body', name: '衣袍', icon: 'g_body', desc: '身上所穿' },
  { key: 'hand', name: '法器', icon: 'g_hand', desc: '手中所持' },
  { key: 'foot', name: '履靴', icon: 'g_foot', desc: '脚下所踏' },
];
export const SLOT_KEYS = SLOTS.map(s => s.key);

/** 词条表 —— 沿用 PASSIVES 的四字段 schema。
 *
 *  刻意**只收 17 条里与战斗相关的那部分**,不把 magnet/xp/gold 这类
 *  「局内成长性」词条塞进装备:那些属于砍杀局的升级池,放进装备等于
 *  变相让装备替代局内成长,玩家会不去砍杀。 */
export const AFFIXES = {
  // —— 攻击向 ——
  might:      { name: '力道',     icon: 'p_might',  maxLv: 5, desc: '攻击伤害 +6%/级' },
  crit:       { name: '破绽',     icon: 'p_crit',   maxLv: 5, desc: '暴击率 +3%/级' },
  critDmg:    { name: '狠手',     icon: 'p_crit',   maxLv: 3, desc: '暴击伤害 +12%/级' },
  pierce:     { name: '穿骨',     icon: 'p_might',  maxLv: 3, desc: '无视目标 4% 护甲/级' },
  // —— 生存向 ——
  hp:         { name: '气血',     icon: 'p_hp',     maxLv: 5, desc: '生命上限 +14/级' },
  armor:      { name: '护体',     icon: 'p_armor',  maxLv: 5, desc: '护甲 +0.5/级' },
  fortify:    { name: '坚韧',     icon: 'p_hp',     maxLv: 5, desc: '受到伤害 -3%/级' },
  guard:      { name: '灵盾',     icon: 'p_armor',  maxLv: 3, desc: '护盾上限 +8/级并缓慢回复' },
  regen:      { name: '回春',     icon: 'p_hp',     maxLv: 3, desc: '每秒回复 +0.4/级' },
  lifesteal:  { name: '饮血',     icon: 'p_crit',   maxLv: 3, desc: '造成伤害的 2% 回血/级' },
  thorns:     { name: '反噬',     icon: 'p_crit',   maxLv: 3, desc: '受击反弹 5% 伤害/级' },
  // —— 机动向 ——
  speed:      { name: '轻身',     icon: 'p_speed',  maxLv: 3, desc: '移动速度 +5%/级' },
  cd:         { name: '疾手',     icon: 'p_cd',     maxLv: 3, desc: '武器冷却 -6%/级' },
  dashCd:     { name: '影遁',     icon: 'p_speed',  maxLv: 3, desc: '冲刺冷却 -8%/级' },
  // —— 场控/溅射向 ——
  area:       { name: '扩散',     icon: 'p_might',  maxLv: 3, desc: '攻击范围 +8%/级' },
  chain:      { name: '连锁',     icon: 'p_cd',     maxLv: 3, desc: '命中溅射相邻目标/级' },
  knockback:  { name: '震荡',     icon: 'p_might',  maxLv: 3, desc: '击退距离 +20%/级' },
};

/** 词条数值 —— 与 AFFIXES 一一对应,缺一条 gear-regression 会报。
 *  mode 与 upgrades.js 的 PASSIVE_BONUS 保持一致:
 *   mult = 乘算(0.06 表示 +6%),add = 加算 */
export const AFFIX_BONUS = {
  might:     { key: 'mightMult',       mode: 'mult', v:  0.06 },
  crit:      { key: 'crit',            mode: 'add',  v:  0.03 },
  critDmg:   { key: 'critDmg',         mode: 'add',  v:  0.12 },
  pierce:    { key: 'piercePct',       mode: 'add',  v:  0.04 },
  hp:        { key: 'hpFlat',          mode: 'add',  v: 14 },
  armor:     { key: 'armorFlat',       mode: 'add',  v:  0.5 },
  fortify:   { key: 'damageTakenMult', mode: 'mult', v: -0.03 },
  guard:     { key: 'shieldFlat',      mode: 'add',  v:  8 },
  regen:     { key: 'regenFlat',       mode: 'add',  v:  0.4 },
  lifesteal: { key: 'lifestealPct',    mode: 'add',  v:  0.02 },
  thorns:    { key: 'thornsPct',       mode: 'add',  v:  0.05 },
  speed:     { key: 'speedMult',       mode: 'mult', v:  0.05 },
  cd:        { key: 'cdMult',          mode: 'mult', v: -0.06 },
  dashCd:    { key: 'dashCdMult',      mode: 'mult', v: -0.08 },
  area:      { key: 'areaMult',        mode: 'mult', v:  0.08 },
  chain:     { key: 'chainLv',         mode: 'add',  v:  1 },
  knockback: { key: 'knockbackMult',   mode: 'mult', v:  0.20 },
};
export const AFFIX_KEYS = Object.keys(AFFIXES);

/** 装备定义表。
 *
 *  ⚠️ `from` 字段的值必须**逐字**出现在 docs/GEAR-TABLE.md 批次 B 里 ——
 *  那 8 只传说妖(`legend.js` 的 LEGEND)。lint-gear-table.mjs 会核对。
 *  批次 A(图鉴 8 妖)**暂不作为装备来源**:它们每天刷得到,是砍杀局主力,
 *  让它们掉装备等于开了线 A 硬约束 1 明令禁止的那条路(装备被刷爆、稀有度归零)。
 *
 *  rarity 1~4 沿用 legend.js 的 rarity 档位,便于玩家一眼看出这件货有多难搞。
 */
export const GEAR = {
  // —— 4 档各 2 件,共 8 件 ——
  hongyi_garment: {
    name: '红嫁衣', slot: 'body', rarity: 4, from: 'hongyi',
    desc: '大旱那年她没等到轿。这件衣裳后来自己走了回来。',
    affixes: { lifesteal: 2, fortify: 2, hp: 2 },
  },
  laolao_hairpin: {
    name: '姥姥的簪', slot: 'head', rarity: 4, from: 'laolao',
    desc: '黑山姥姥不戴簪。她把簪子给了你,意思是别回来。',
    affixes: { pierce: 2, crit: 2, cd: 2 },
  },
  baize_claw: {
    name: '白泽之爪', slot: 'hand', rarity: 4, from: 'baize',
    desc: '白泽知万物之情。它临死前把爪子递过来,像是要你替它记着。',
    affixes: { area: 2, chain: 2, might: 2 },
  },
  dangkang_ring: {
    name: 'dang kang 环', slot: 'hand', rarity: 3, from: 'dangkang',
    desc: '取名者早已不记得自己取的是什么名。',
    affixes: { thorns: 2, armor: 2, hp: 2 },
  },
  qingqiong_robe: {
    name: '青穹履', slot: 'foot', rarity: 3, from: 'qingqiong',
    desc: '穿上就能走得很远。代价是走得太远就不想回来了。',
    affixes: { speed: 2, dashCd: 2, critDmg: 1 },
  },
  jiangu_blade: {
    name: 'jian gu 刃', slot: 'hand', rarity: 3, from: 'jiangu',
    desc: '剑不该有名字。有了名字,就有人会叫它回来。',
    affixes: { knockback: 2, might: 2, pierce: 1 },
  },
  shijiang_seal: {
    name: '石将印', slot: 'head', rarity: 2, from: 'shijiang',
    desc: '石头人不会动,但你按下去的时候,它会看你一眼。',
    affixes: { guard: 2, regen: 1, fortify: 1 },
  },
  dengshi_lamp: {
    name: '灯柿', slot: 'foot', rarity: 2, from: 'dengshi',
    desc: '照不远的灯。够看清脚下就行 —— 传说里它照的是回去的路。',
    affixes: { cd: 2, speed: 1, regen: 1 },
  },
};
export const GEAR_IDS = Object.keys(GEAR);

/**
 * 「结案对象 → 掉哪件装备」的唯一真源(XX-EQUIP-005)。
 * gear 表用 `from` 字段声明来源,这里反查 —— 调用方不硬编码支线名。
 * ⚠️ 纯函数,不写任何存档;发放由 core/save.js 的 Save.ownGear() 负责。
 * @param {string} source 支线/妖的 key(如 'hongyi')
 * @returns {string|null} 装备 id;没有就 null
 */
export function gearFromSource(source) {
  if (!source) return null;
  return GEAR_IDS.find(id => GEAR[id].from === source) || null;
}

/** 空装备栏(新档的初始值)。
 *  四个槽位全 null —— **不送新手装备**:
 *  送了就把「结案 → 掉装备 → 穿戴」这条链变成可有可无,而那正是 XX-EQUIP-005 要验的。 */
export function emptyLoadout() {
  const o = {};
  for (const k of SLOT_KEYS) o[k] = null;
  return o;
}

/** 校验一件装备的数据是否自洽(纯函数,不改任何状态)。
 *  gear-regression 和 lint 都会调它 —— 宁可让门禁红,不要带着坏数据进结算。 */
export function validateGear(id) {
  const g = GEAR[id];
  if (!g) return { ok: false, why: `不存在的装备 id:${id}` };
  if (!SLOT_KEYS.includes(g.slot)) return { ok: false, why: `${id} 的槽位 ${g.slot} 不在 4 槽内` };
  if (!AFFIXES[g.affixes && Object.keys(g.affixes)[0]]) { /* 逐条查 */ }
  for (const [k, lv] of Object.entries(g.affixes || {})) {
    const a = AFFIXES[k];
    if (!a) return { ok: false, why: `${id} 引用了不存在的词条 ${k}` };
    if (!AFFIX_BONUS[k]) return { ok: false, why: `${id} 的词条 ${k} 没有数值定义` };
    if (!Number.isInteger(lv) || lv < 1) return { ok: false, why: `${id} 的词条 ${k} 等级非法:${lv}` };
    if (lv > a.maxLv) return { ok: false, why: `${id} 的词条 ${k} 等级 ${lv} 超过上限 ${a.maxLv}` };
  }
  if (Object.keys(g.affixes || {}).length === 0) return { ok: false, why: `${id} 没有任何词条` };
  if (![1, 2, 3, 4].includes(g.rarity)) return { ok: false, why: `${id} 的 rarity=${g.rarity} 不在 1~4` };
  return { ok: true };
}

/** 把一件装备的词条折算成实际数值(已乘 GEAR_POWER 衰减)。
 *  纯函数,不写玩家状态 —— XX-EQUIP-004 才用它去改 p.stats。
 *
 *  ⚠️ mult 的口径必须与 upgrades.js 的 PASSIVE_BONUS 一致:
 *     `v` 是**增减量**不是倍率 —— fortify 的 v 是 -0.03(减伤 3%),
 *     所以实际系数是 `1 + v×级数`,不是 `v×级数`。
 *     (第一版写成了后者,算出来 `damageTakenMult = 2.4` ——
 *      减伤词条变成了「受到的伤害 ×2.4」,越装备越脆。
 *      这种错在纯数据层不会报错,只会一路错到结算,所以 gear-regression 必须断言符号。)
 */
export function gearBonus(id, lv = 1) {
  const g = GEAR[id];
  if (!g) return {};
  const out = {};
  for (const [k, baseLv] of Object.entries(g.affixes || {})) {
    const b = AFFIX_BONUS[k];
    if (!b) continue;
    const scaled = baseLv * lv * GEAR_POWER;           // 先按等级与衰减缩放
    if (b.mode === 'mult') {
      const factor = 1 + b.v * scaled;                  // v 是增减量
      out[b.key] = (out[b.key] ?? 1) * factor;
    } else {
      out[b.key] = (out[b.key] ?? 0) + b.v * scaled;
    }
  }
  return out;
}

/** 一整套装备的合计加成。槽位空着就跳过,不报错。 */
export function loadoutBonus(loadout) {
  const acc = {};
  for (const slot of SLOT_KEYS) {
    const id = loadout && loadout[slot];
    if (!id || !GEAR[id]) continue;
    for (const [k, v] of Object.entries(gearBonus(id))) {
      // 乘算类系数相乘,加法类数值相加 —— 与 upgrades.js 同口径
      acc[k] = AFFIX_MODE_OF(k) === 'mult' ? (acc[k] ?? 1) * v : (acc[k] ?? 0) + v;
    }
  }
  return acc;
}

/** 反查某个 player.stats 字段是乘算还是加算(由 AFFIX_BONUS 推导,单一真源)。
 *  没有这张表就只能靠字段名带不带 Mult 去猜 —— 那正是第一版算错的原因。 */
const AFFIX_MODE_OF = (() => {
  const m = {};
  for (const b of Object.values(AFFIX_BONUS)) m[b.key] = b.mode;
  return k => m[k] ?? 'add';
})();

