// 装备 · 词条 · 宝石 · 外观
// 目标：让「红衣女鬼爆肚兜」这类设计成立。
//
// 现状（本文件写于 2026-10-10，实测确认）：
//   · 装备系统     —— 全仓 0 处
//   · 词条/affix   —— 全仓 0 处
//   · 宝石         —— 有，但是 director.js:16 的「刷怪燃料」，不是装备宝石
//   · 传说妖掉落   —— 8 只传说妖在砍杀局里 0 掉落
//   · 但已有一整套可复用的词条骨架：upgrades.js 的 12 个 PASSIVE
//     （name / icon / maxLv / desc / mode），本文件直接沿用同一套 schema
//   · player.stats 已有 12 个属性，且 shieldMax + addShieldCapacity() 现成
//
// 硬约束：
//   · n0–n10 冻结（story.js / quest.js 硬编码）
//   · 零构建、原生 ESM、localStorage 键名 xx_<名字>_v0XX
//   · equipment.js:99

// 落到仓库时这两行改成：
//   import { STONES, SCROLLS, GOODS } from './items.js';
//   import { LEGEND } from './legend.js';
// 骨架目录里没有这两个文件（它们在 js/xiuxian/），故注释掉以便独立运行。
// import { STONES, SCROLLS, GOODS } from './items.js';
// import { LEGEND } from './legend.js';

// ═══════════════════════════════════════════════════════════════
// 一、装备槽 —— 少而精，不要 Diablo 那一套
// ═══════════════════════════════════════════════════════════════

/**
 * 槽位。**只设 4 个**。
 * 理由：现有 4 个角色 × 12 词条已经是 48 个组合，再乘槽位数玩家读不过来。
 * 6 槽以上会让「每局该穿什么」变成一道排列组合题，而不是一个决定。
 * @type {Object.<SlotId, {name:string, desc:string, accept:string[]}>}
 */
export const SLOTS = {
  weapon: { name:'兵刃', desc:'你的手。',            accept:['sword','blade','staff'] },
  robe:   { name:'衣袍', desc:'贴着皮的那层。',      accept:['cloth'] },
  relic:  { name:'法器', desc:'借来的力。',          accept:['relic'] },
  charm:  { name:'符佩', desc:'挂在腰上的。',        accept:['charm'] },
};

export const SLOT_LIST = Object.keys(SLOTS);

// ═══════════════════════════════════════════════════════════════
// 二、词条池 —— 直接对齐 upgrades.js 的 PASSIVE schema
// ═══════════════════════════════════════════════════════════════

/**
 * 一条词条。
 *  mods 里的 k **刻意与 player.stats 的键名一致**（might/cdMult/speed/
 *  armor/crit/...），这样 applyAffix 不需要任何映射表 —— 直接乘/加。
 *  少数需要动逻辑的走 hook 字段。
 *
 * @typedef {Object} Affix
 * @property {string} id
 * @property {string} name
 * @property {string} icon        走 sprite 键（upgrades.js 已有 p_* 全套）
 * @property {string} desc
 * @property {number} maxStacks   最大叠加层
 * @property {Array}  mods        [{k,mode:'mul'|'add',v}] —— 直接写进 p.stats 的键
 * @property {string} [hook]      需要改逻辑的:'lifesteal'|'autoHeal'|'shieldRegen'|'skillMod'|'size'
 * @property {number} [tier]      稀有度 1=常见 2=精良 3=珍奇 4=传说
 */

export const AFFIXES = {
  // ── 数值型：直接乘 p.stats ──
  a_might:  { id:'a_might',  name:'锋锐', icon:'p_might', maxStacks:5, tier:1,
              desc:'攻击伤害 +8%/层', mods:[{k:'might',mode:'mul',v:0.08}] },
  a_speed:  { id:'a_speed',  name:'轻身', icon:'p_speed', maxStacks:5, tier:1,
              desc:'身法 +6%/层',   mods:[{k:'speed',mode:'mul',v:0.06}] },
  a_cd:     { id:'a_cd',     name:'疾息', icon:'p_cd',    maxStacks:4, tier:2,
              desc:'武器冷却 -6%/层', mods:[{k:'cdMult',mode:'mul',v:-0.06}] },
  a_area:   { id:'a_area',   name:'阔野', icon:'p_might', maxStacks:3, tier:2,
              desc:'攻击范围 +8%/层', mods:[{k:'areaMult',mode:'mul',v:0.08}] },
  a_armor:  { id:'a_armor',  name:'坚韧', icon:'p_armor', maxStacks:5, tier:1,
              desc:'护甲 +1/层',  mods:[{k:'armor',mode:'add',v:1}] },
  a_hp:     { id:'a_hp',     name:'厚生', icon:'p_hp',    maxStacks:4, tier:2,
              desc:'生命上限 +15/层', mods:[{k:'maxHp',mode:'add',v:15}] },
  a_crit:   { id:'a_crit',   name:'锐目', icon:'p_crit',  maxStacks:3, tier:3,
              desc:'暴击率 +4%/层', mods:[{k:'crit',mode:'add',v:0.04}] },
  a_magnet: { id:'a_magnet', name:'引灵', icon:'p_magnet',maxStacks:3, tier:2,
              desc:'拾取范围 +20%/层', mods:[{k:'magnet',mode:'add',v:20}] },
  a_gold:   { id:'a_gold',   name:'积财', icon:'p_gold',  maxStacks:3, tier:2,
              desc:'金币获取 +12%/层', mods:[{k:'goldMult',mode:'mul',v:0.12}] },
  a_xp:     { id:'a_xp',     name:'悟道', icon:'p_xp',    maxStacks:3, tier:2,
              desc:'经验获取 +10%/层', mods:[{k:'xpMult',mode:'mul',v:0.10}] },

  // ── 规则型：需要 hook，不走数值 ──
  a_lifesteal: { id:'a_lifesteal', name:'饮血', icon:'p_crit', maxStacks:3, tier:3,
              desc:'造成伤害的 3%/层 转为治疗', hook:'lifesteal', v:0.03 },
  a_autoHeal:  { id:'a_autoHeal',  name:'自愈', icon:'p_hp',   maxStacks:3, tier:2,
              desc:'每 6 秒回复 1.5% 生命/层', hook:'autoHeal', v:0.015, cd:6 },
  a_shield:    { id:'a_shield',    name:'玄甲', icon:'p_armor', maxStacks:4, tier:3,
              desc:'护盾上限 +10/层，并加速回复', hook:'shield', v:10 },
  a_reflect:   { id:'a_reflect',   name:'反震', icon:'p_crit', maxStacks:3, tier:3,
              desc:'受到伤害的 5%/层 反弹给近敌', hook:'retaliate', v:0.05 },
  a_skill:     { id:'a_skill',     name:'通玄', icon:'p_cd',   maxStacks:1, tier:4,
              desc:'随机一门神通 +1 级（局内）', hook:'skillUp', v:1 },
  a_style:     { id:'a_style',     name:'化形', icon:'p_might', maxStacks:1, tier:4,
              desc:'随机改变一门神通的形态表现', hook:'styleShift', v:1 },
  a_size:      { id:'a_size',      name:'魁伟', icon:'p_hp',   maxStacks:2, tier:2,
              desc:'攻击范围 +12%/层，冷却 -4%/层', mods:[{k:'areaMult',mode:'mul',v:0.12},{k:'cdMult',mode:'mul',v:-0.04}] },
};

/** 按稀有度分池 */
export const AFFIX_POOL = {
  1: ['a_might','a_speed','a_armor'],
  2: ['a_cd','a_hp','a_magnet','a_gold','a_xp','a_autoHeal','a_size'],
  3: ['a_area','a_crit','a_lifesteal','a_shield','a_reflect'],
  4: ['a_skill','a_style'],
};

// ═══════════════════════════════════════════════════════════════
// 三、装备实例
// ═══════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Gear
 * @property {string} uid        唯一 id（生成用，不进存档时也要稳定）
 * @property {string} defId      定义 id，见 GEAR_DEFS
 * @property {string} slot       槽位 key
 * @property {number} tier       稀有度 1-4
 * @property {number} ilvl       强化等级（工匠打出来的）
 * @property {Object<string,number>} affixes  词条 id → 层数
 * @property {string} [origin]   掉落来源（传说妖 key），用于图鉴联动
 */

let _seq = 0;
export function newUid() { return 'g' + (Date.now().toString(36)) + (_seq++).toString(36); }

/**
 * 词条的实际效果。**只读，不改装备。**
 * @param {Gear} gear
 * @returns {Object} 可直接喂给 applyGear 的 {mul:{}, add:{}, hooks:{}}
 */
export function gearEffects(gear) {
  const mul = {}, add = {}, hooks = {};
  for (const [aid, stacks] of Object.entries(gear.affixes || {})) {
    if (!stacks) continue;
    const a = AFFIXES[aid];
    if (!a) continue;
    if (a.hook) {
      hooks[a.hook] = (hooks[a.hook] || 0) + (a.v || 0) * stacks;
      if (a.hook === 'autoHeal') hooks.autoHealCd = a.cd;
    } else {
      // mods: [{k:'might', mode:'mul'|'add', v:数值}] —— 数组形式。
      // 不用 {k:'mul', v:0.08} 是因为那样 Object.entries 会把 'v' 也当属性名。
      for (const m of (a.mods || [])) {
        if (m.mode === 'mul') mul[m.k] = (mul[m.k] ?? 1) * Math.pow(1 + m.v, stacks);
        else add[m.k] = (add[m.k] || 0) + m.v * stacks;
      }
    }
  }
  // 强化等级：线性加伤
  if (gear.ilvl > 0) mul.might = (mul.might ?? 1) * (1 + gear.ilvl * 0.06);

  // 装备总系数：防止「装备词条 + 局内升级词条」双轨叠加后爆表。
  // 4 件 T4 的 might 约 1.47，叠加 12 局内被动满级(1.08^5≈1.47) 后是 2.16，
  // 再加 4 件强化 +8 就是 2.9 —— 敌人 HP 曲线跟不上。
  // 这里把装备的乘区整体压到 GEAR_POWER，再由未来实测调。
  const GEAR_POWER = 0.7;
  for (const k of Object.keys(mul)) mul[k] = Math.pow(mul[k], GEAR_POWER);

  return { mul, add, hooks };
}

// ═══════════════════════════════════════════════════════════════
// 四、把词条接到 player.stats 上
// ═══════════════════════════════════════════════════════════════

/**
 * 应用整套装备。**与 upgrades.js 的 applyChoice 同一套口径。**
 * @param {Object} p        player 实例
 * @param {Object<string,string|null>} equipped  slot → gear uid
 * @param {Object<string,Gear>} owned           uid → gear
 * @returns {Object} hooks 汇总，交给局内逻辑（吸血/自愈/反震）消费
 */
export function applyGear(p, equipped, owned) {
  const allMul = {}, allAdd = {}, hooks = {};
  for (const slot of SLOT_LIST) {
    const uid = equipped[slot];
    if (!uid || !owned[uid]) continue;
    const g = owned[uid];
    const eff = gearEffects(g);
    for (const [k, v] of Object.entries(eff.mul)) allMul[k] = (allMul[k] ?? 1) * v;
    for (const [k, v] of Object.entries(eff.add)) allAdd[k] = (allAdd[k] || 0) + v;
    for (const [k, v] of Object.entries(eff.hooks)) hooks[k] = (hooks[k] || 0) + v;
  }

  // 写进 stats —— 键名与 player.stats 一致，不需要映射
  for (const [k, v] of Object.entries(allMul)) {
    if (k === 'maxHp') p.stats.maxHp = (p.stats.maxHp || 100) * v;
    else p.stats[k] = (p.stats[k] ?? 1) * v;
  }
  for (const [k, v] of Object.entries(allAdd)) {
    if (k === 'maxHp') { p.stats.maxHp = (p.stats.maxHp || 100) + v; p.hp += v; }
    else if (k === 'armor') p.stats.armor = (p.stats.armor || 0) + v;
    else p.stats[k] = (p.stats[k] ?? 0) + v;
  }
  // 护盾走专用接口（player.js:119 addShieldCapacity）
  if (hooks.shield && p.addShieldCapacity) p.addShieldCapacity(Math.round(hooks.shield));
  if (hooks.retaliate) p.reflectRatio = Math.min(0.45, (p.reflectRatio || 0) + hooks.retaliate);
  // 吸血/自愈挂到 player 上，供 enemies.js 伤害结算读取
  if (hooks.lifesteal) p.lifestealRatio = (p.lifestealRatio || 0) + hooks.lifesteal;
  if (hooks.autoHeal) { p.autoHealRatio = (p.autoHealRatio || 0) + hooks.autoHeal; p.autoHealCd = hooks.autoHealCd || 6; }
  // 神通相关
  if (hooks.skillUp)   p.pendingArtBonus = (p.pendingArtBonus || 0) + hooks.skillUp;
  if (hooks.styleShift) p.pendingStyleShift = (p.pendingStyleShift || 0) + hooks.styleShift;

  p.recalc();
  return hooks;
}

// ═══════════════════════════════════════════════════════════════
// 五、传说妖专属装备 —— 「红衣爆肚兜」
// ═══════════════════════════════════════════════════════════════

/**
 * 8 只传说妖各自的招牌掉落。
 *
 * 设计原则：**每件装备的机制都能从这只妖的设定里读出来。**
 * 不是「红衣给的护甲 +10」，而是「她穿着嫁衣等了很多年 → 那件衣服会替你愈合」。
 * 玩家穿上时应该能想起她。
 *
 * @type {Object<string, GearDef>}
 */
export const LEGEND_GEAR = {
  // 红衣女鬼：嫁衣（你替她凑齐的那件）
  hongyi: {
    defId:'gear_hongyi', slot:'robe', tier:4,
    name:'红嫁衣', desc:'针脚很拙。她本来不用会这个。',
    art:'assets/legend/hongyi.jpg',
    fixed:{ autoHeal: 0.02 },
    flavor:'她想走。她只是不知道往哪儿走。',
  },
  // 黑山姥姥：愿牌（她替人实现的愿望）
  laolao: {
    defId:'gear_laolao', slot:'charm', tier:4,
    name:'碎愿牌', desc:'字丑是因为她不识字。',
    art:'assets/legend/laolao.jpg',
    fixed:{ lifesteal: 0.04 },
    flavor:'愿上写的名字,没有一个活着兑现。',
  },
  // 白泽：它问过你一个问题
  baize: {
    defId:'gear_baize', slot:'relic', tier:4,
    name:'白泽之问', desc:'它不评判答案。它只记着。',
    art:'assets/legend/baize.jpg',
    fixed:{ skillUp: 1 },
    flavor:'「你修这道,是为了什么?」',
  },
  // 当康：领路的牛
  dangkang: {
    defId:'gear_dangkang', slot:'weapon', tier:3,
    name:'当康角', desc:'它往山里的方向走,不停。',
    art:'assets/legend/dangkang.jpg',
    fixed:{ area: 0.15 },
    flavor:'它不是跑,它是领路。',
  },
  // 青穹：千年来第一次回头
  qingqiong: {
    defId:'gear_qingqiong', slot:'weapon', tier:4,
    name:'青穹之翼', desc:'回头的人活不下来。',
    art:'assets/legend/qingqiong.jpg',
    fixed:{ crit: 0.12, speed: 0.12 },
    flavor:'它说了三个字:「因为你。」',
  },
  // 剑骨：演了不知道多少年的那一招
  jiangu: {
    defId:'gear_jiangu', slot:'weapon', tier:4,
    name:'第三百零一柄', desc:'多出来的那一柄,没有主人的名字。',
    art:'assets/legend/jiangu.jpg',
    fixed:{ might: 0.25, styleShift: 1 },
    flavor:'他对你鞠了一躬,然后继续演。',
  },
  // 墓前石将：补完那半句话
  shijiang: {
    defId:'gear_shijiang', slot:'armor_placeholder', tier:4,
    name:'半句碑文', desc:'此生不悔,奈何无人共。',
    art:'assets/legend/shijiang.jpg',
    fixed:{ shield: 25, armor: 3 },
    flavor:'碰了,就得补完。',
    slot:'relic',
  },
  // 灯尸：不回头的灯
  dengshi: {
    defId:'gear_dengshi', slot:'charm', tier:3,
    name:'引路灯', desc:'灯不回头。',
    art:'assets/legend/dengshi.jpg',
    fixed:{ reflect: 0.08, autoHeal: 0.01 },
    flavor:'你走你的,它照你的。',
  },
};

/** 全部普通装备定义（工匠能做出来的） */
export const GEAR_DEFS = {
  // 兵刃
  g_sword:   { defId:'g_sword',  slot:'weapon', name:'铁剑',     desc:'没什么好说的。',   rarity:1, base:{ might:0.05 } },
  g_blade:   { defId:'g_blade',  slot:'weapon', name:'断刃',     desc:'砍卷了的。',       rarity:2, base:{ might:0.10, cdMult:-0.04 } },
  g_staff:   { defId:'g_staff',  slot:'weapon', name:'桃木杖',   desc:'雷击用。',         rarity:2, base:{ area:0.10 } },
  // 衣袍
  g_robe:    { defId:'g_robe',   slot:'robe',   name:'粗布袍',   desc:'能穿。',           rarity:1, base:{ armor:1 } },
  g_leather: { defId:'g_leather',slot:'robe',   name:'硝皮甲',   desc:'轻,但不挡刀。',   rarity:2, base:{ armor:2, speed:0.04 } },
  g_silk:    { defId:'g_silk',   slot:'robe',   name:'青云衣',   desc:'传闻修士都穿这个。', rarity:3, base:{ armor:2, cdMult:-0.06 } },
  // 法器
  g_talisman:{ defId:'g_talisman',slot:'relic', name:'桃木符',   desc:'贴在身上会痒。',   rarity:2, base:{ shield:8 } },
  g_mirror:  { defId:'g_mirror',  slot:'relic', name:'照妖镜',   desc:'照得出不该有的东西。', rarity:3, base:{ crit:0.06, shield:6 } },
  // 符佩
  g_charm:   { defId:'g_charm',  slot:'charm',  name:'平安符',   desc:'保平安,不保命。',  rarity:1, base:{ hp:10 } },
  g_bell:    { defId:'g_bell',   slot:'charm',  name:'惊魂铃',   desc:'响一下怪会顿一下。', rarity:3, base:{ area:0.12, cdMult:-0.05 } },
};

// ═══════════════════════════════════════════════════════════════
// 六、生成
// ═══════════════════════════════════════════════════════════════

/**
 * 掉落判定表：打倒什么出什么
 * @type {Object<string,{gearId?:string, affixTier?:number, chance?:number, qty?:number}>}
 */
export const DROP_TABLE = {
  // 普通怪
  trash:   { chance:0.03, affixTier:1, qty:[1,1] },
  elite:   { chance:0.22, affixTier:2, qty:[1,1] },
  // Boss 必掉普通装备
  boss:    { chance:1.00, affixTier:3, qty:[1,2] },
  // 秘窟
  secret:  { chance:0.40, affixTier:2, qty:[1,2] },
};

/**
 * 传说妖专属掉落。它们**不在砍杀局的普通池里**，
 * 只能通过修仙阁的支线/副本结算获得 —— 所以拿到就是拿到了，不会被刷爆。
 * @type {Object<string, {gearDefId:string, chance:number, alsoRoll:number}>}
 */
export const LEGEND_DROP = {
  hongyi:    { gearDefId:'gear_hongyi',  chance:1.0, alsoRoll:0.5 },
  laolao:    { gearDefId:'gear_laolao',  chance:1.0, alsoRoll:0.5 },
  baize:     { gearDefId:'gear_baize',   chance:1.0, alsoRoll:0.5 },
  dangkang:  { gearDefId:'gear_dangkang', chance:1.0, alsoRoll:0.4 },
  qingqiong: { gearDefId:'gear_qingqiong',chance:1.0, alsoRoll:0.5 },
  jiangu:    { gearDefId:'gear_jiangu',  chance:1.0, alsoRoll:0.6 },
  shijiang:  { gearDefId:'gear_shijiang',chance:1.0, alsoRoll:0.5 },
  dengshi:   { gearDefId:'gear_dengshi', chance:1.0, alsoRoll:0.4 },
};

/**
 * 掉落一件装备。
 * @param {string} sourceKey  怪物/来源 key：普通怪走 DROP_TABLE，传说妖走 LEGEND_DROP
 * @param {() => number} rng  可注入的随机源（便于确定性测试）
 * @returns {Gear|null}
 */
export function rollDrop(sourceKey, rng = Math.random) {
  // 1) 先看是不是传说妖专属
  const lg = LEGEND_DROP[sourceKey];
  if (lg && rng() < lg.chance) {
    const g = fromLegendGear(sourceKey);
    if (g) return g;
  }
  // 2) 普通掉落表
  const dt = DROP_TABLE[sourceKey];
  if (!dt || rng() > dt.chance) return null;
  const defs = Object.values(GEAR_DEFS);
  const def = defs[Math.floor(rng() * defs.length)];
  return rollGear(def, dt.affixTier, rng);
}

/** 构造一件随机装备 */
export function rollGear(def, affixTier = 1, rng = Math.random) {
  const affixes = {};
  const pool = AFFIX_POOL[affixTier] || AFFIX_POOL[1];
  const n = 1 + Math.floor(rng() * 2);           // 1-2 条
  for (let i = 0; i < n; i++) {
    const aid = pool[Math.floor(rng() * pool.length)];
    const stacks = 1 + Math.floor(rng() * (AFFIXES[aid].maxStacks > 2 ? 2 : 1));
    affixes[aid] = Math.min(AFFIXES[aid].maxStacks, (affixes[aid] || 0) + stacks);
  }
  return {
    uid:newUid(), defId:def.defId, slot:def.slot, tier:def.rarity || 1,
    ilvl:0, affixes,
  };
}

/** 构造传说妖专属装备（固定机制 + 少量随机词条） */
export function fromLegendGear(legendKey) {
  const spec = LEGEND_GEAR[legendKey];
  if (!spec) return null;
  const affixes = {};
  // 固定机制映射到对应词条，满层
  const MAP = {
    lifesteal:'a_lifesteal', autoHeal:'a_autoHeal', shield:'a_shield',
    reflect:'a_reflect', skillUp:'a_skill', styleShift:'a_style',
    might:'a_might', crit:'a_crit', speed:'a_speed', area:'a_area',
  };
  for (const [k, v] of Object.entries(spec.fixed || {})) {
    const aid = MAP[k];
    if (aid && AFFIXES[aid]) affixes[aid] = AFFIXES[aid].maxStacks;
  }
  return {
    uid:newUid(), defId:spec.defId, slot:spec.slot, tier:4,
    ilvl:0, affixes, origin:legendKey,
    name:spec.name, desc:spec.desc, flavor:spec.flavor, art:spec.art,
  };
}

// ═══════════════════════════════════════════════════════════════
// 七、宝石 —— 与 director.js 的「燃料宝石」是两回事
// ═══════════════════════════════════════════════════════════════

/**
 * 装备宝石。**与 director.js:16 的刷怪燃料宝石是同名不同物**，
 * 这里不改那个（改了会破坏难度曲线），只在新系统里用 GEMS 这个名字。
 */
export const GEMS = {
  gem_might:  { name:'赤玉',   stat:'might',  v:0.06, desc:'攻击 +6%' },
  gem_hp:     { name:'碧玉',   stat:'maxHp',  v:20,   desc:'生命上限 +20' },
  gem_shield: { name:'玄玉',   stat:'shield', v:6,    desc:'护盾上限 +6' },
  gem_cd:     { name:'素玉',   stat:'cdMult', v:-0.05,desc:'冷却 -5%' },
  gem_luck:   { name:'白纹玉', stat:'crit',   v:0.03, desc:'暴击 +3%' },
};

/** 宝石槽：只在「法器」和「符佩」上开，避免每件都镶导致数值爆炸 */
export function socketsOf(gear) {
  const base = { weapon:0, robe:0, relic:1, charm:1 };
  return base[gear?.slot] ?? 0;
}

/** 镶嵌 */
export function socketGem(gear, gemId) {
  if (!gear) return { ok:false, msg:'没有装备' };
  const cap = socketsOf(gear);
  gear.sockets = gear.sockets || [];
  if (gear.sockets.length >= cap) return { ok:false, msg:'槽位已满' };
  if (!GEMS[gemId]) return { ok:false, msg:'无此玉' };
  gear.sockets.push(gemId);
  return { ok:true, msg:`镶入${GEMS[gemId].name}` };
}

/** 把宝石效果并进 gearEffects */
export function gemEffects(gear) {
  const out = { mul:{}, add:{}, hooks:{} };
  for (const gid of (gear?.sockets || [])) {
    const g = GEMS[gid];
    if (!g) continue;
    if (g.stat === 'cdMult') out.mul.cdMult = (out.mul.cdMult ?? 1) * (1 + g.v);
    else if (g.stat === 'maxHp') out.add.maxHp = (out.add.maxHp || 0) + g.v;
    else if (g.stat === 'shield') out.hooks.shield = (out.hooks.shield || 0) + g.v;
    else if (g.stat === 'crit') out.add.crit = (out.add.crit || 0) + g.v;
    else out.mul[g.stat] = (out.mul[g.stat] ?? 1) * (1 + g.v);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// 八、外观 —— 纯装饰，不影响数值
// ═══════════════════════════════════════════════════════════════

/**
 * 外观。**属性全为 0**，只换贴图。
 * 存在的理由：搜打撤的「带出来」如果没有「带出来的是什么」会很空。
 * 玩家会想把那件红嫁衣穿出去。
 * @type {Object<string,{name:string, slot:string, art:string, note:string}>}
 */
export const COSMETICS = {
  cos_hongyi:  { name:'红嫁衣', slot:'robe',   art:'assets/legend/hongyi.jpg', note:'见阿禾' },
  cos_laolao:  { name:'姥姥的褂',slot:'robe',   art:'assets/legend/laolao.jpg', note:'打了很多补丁' },
  cos_baize:   { name:'白泽角',  slot:'relic',  art:'assets/legend/baize.jpg',  note:'它不评判你' },
  cos_qingqiong:{name:'青翎',    slot:'weapon', art:'assets/legend/qingqiong.jpg',note:'回头那次的' },
  cos_jiangu:   { name:'断剑鞘',  slot:'weapon', art:'assets/legend/jiangu.jpg',  note:'第三百零一柄' },
};

// ═══════════════════════════════════════════════════════════════
// 九、工匠 —— 地图上找谁强化
// ═══════════════════════════════════════════════════════════════

/**
 * 工匠。**挂在地图节点上**（这正是你要的「去地图找工匠」）。
 * 复用 nodes.js 的 facet 思路：工匠不是一种节点类型，是节点的一个身份。
 * @type {Object<string,{name:string, nodeId:string, can:string[], cost:number, desc:string}>}
 */
export const SMITHS = {
  smith_iron: {
    name:'铁匠 老周', nodeId:'n9', can:['ilvl'], cost:0.15,
    desc:'落云镇口那家。锤子抡了三百年,没抡坏过一把剑。',
  },
  smith_seam: {
    name:'绣娘 阿禾', nodeId:'n0', can:['reforge','cosmetic'], cost:0.20,
    desc:'针脚很拙。但她拆过很多件不该拆的衣服。',
  },
  smith_jade: {
    name:'琢玉人',   nodeId:'n4', can:['socket'], cost:0.10,
    desc:'青岚秘境里住着。他只收源石,不收别的。',
  },
};

/**
 * 强化。**不降级**（降级会把玩家气走），只涨不跌。
 * @param {Gear} gear
 * @param {number} n 要打几级
 * @param {string} smithId
 * @param {number} purse 玩家源石
 * @returns {{ok:boolean, msg:string, cost:number}}
 */
export function reinforce(gear, n, smithId, purse) {
  const sm = SMITHS[smithId];
  if (!sm) return { ok:false, msg:'无此工匠', cost:0 };
  if (!sm.can.includes('ilvl')) return { ok:false, msg:sm.name+'不干这个', cost:0 };
  const cap = 8;
  if (gear.ilvl + n > cap) return { ok:false, msg:`最高 ${cap} 级`, cost:0 };
  let cost = 0;
  for (let i = 0; i < n; i++) cost += Math.ceil((gear.ilvl + i + 1) * 20 * sm.cost * gear.tier);
  if (purse < cost) return { ok:false, msg:`需 ${cost} 源石`, cost };
  gear.ilvl += n;
  return { ok:true, msg:`强化至 +${gear.ilvl}`, cost };
}

/** 重铸词条：洗掉全部，重新随机 */
export function reforge(gear, n, smithId, purse) {
  const sm = SMITHS[smithId];
  if (!sm || !sm.can.includes('reforge')) return { ok:false, msg:sm.name+'不干这个', cost:0 };
  const cost = 40 * n;
  if (purse < cost) return { ok:false, msg:`需 ${cost} 源石`, cost };
  gear.affixes = {};
  return { ok:true, msg:'已重铸', cost };
}

// ═══════════════════════════════════════════════════════════════
// 十、存档
// ═══════════════════════════════════════════════════════════════

const K = 'xx_gear_v100';

export const GEAR = {
  s: { owned:{}, equipped:{ weapon:null, robe:null, relic:null, charm:null }, bag:[] },
  unlockedCos:{},

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) { const d = JSON.parse(r) || {};
        const def = { owned:{}, equipped:{weapon:null,robe:null,relic:null,charm:null}, bag:[] };
        this.s = { ...def, ...d };
        if (!Array.isArray(this.s.bag)) this.s.bag = [];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  add(gear) {
    this.s.owned[gear.uid] = gear;
    this.s.bag.push(gear.uid);
    this.save();
    return gear;
  },
  equippedList() {
    return SLOT_LIST.map(s => this.s.equipped[s] ? this.s.owned[this.s.equipped[s]] : null)
                     .filter(Boolean);
  },
  reset() { this.s = { owned:{}, equipped:{weapon:null,robe:null,relic:null,charm:null}, bag:[] }; this.save(); },
};
