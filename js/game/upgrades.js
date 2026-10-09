// ===== ⚔️ 战斗agent 名下:局内升级池(水墨江湖版 + 进化选项 + 组合推荐) =====
// rollChoices 只读不改等级;applyChoice 落实加成(被动写 p.bonuses 后 p.recalc())。
// 进化(CONTRACT v2):武器 Lv5 + 绑定被动 Lv5 → 金色 evolve 选项必占一档,每武器仅一次。
// 组合推荐(CONTRACT v2.2 §8):输出项可带 rec 字符串标记——
//   ① '可进化·绝学名':选项是满级未进化武器的绑定心法;或新武器/武器升级的绑定心法已 ≥4 级
//   ② '联动·阴阳相激':已有焚天系,选项含墨雨/墨染乾坤
//   ③ '联动·感电连锁':已有五雷↔墨雨系任一侧,选项为另一侧
//   rec 项排序置前;evolve 卡依旧最高优先(与 rec 共存时 evolve 在前);抽取概率逻辑不变。
import { WEAPONS, WEAPON_ORDER, MAX_WEAPONS, makeWeapon } from './weapons.js?v=17';
import { PAL } from '../core/palette.js';
import { combatState } from './enemies.js?v=17';
import { Bus } from '../core/engine.js?v=17';

// 9 种局内被动(数值更强);crit 暴击之眼只进升级池
export const PASSIVES = {
  might:  { name: '力量',     icon: 'p_might',  maxLv: 5, desc: '内力浑厚,攻击伤害 +10%/级' },
  cd:     { name: '沙漏',     icon: 'p_cd',     maxLv: 5, desc: '心如止水,武器冷却 -8%/级' },
  speed:  { name: '疾风靴',   icon: 'p_speed',  maxLv: 5, desc: '身法 +8%/级,冲刺冷却 -4%/级' },
  hp:     { name: '生命之心', icon: 'p_hp',     maxLv: 5, desc: '气血充盈,生命上限 +20/级' },
  magnet: { name: '磁石',     icon: 'p_magnet', maxLv: 5, desc: '摄物摘星,拾取范围 +25/级' },
  xp:     { name: '贤者帽',   icon: 'p_xp',     maxLv: 5, desc: '悟性超绝,经验获取 +10%/级' },
  gold:   { name: '聚宝袋',   icon: 'p_gold',   maxLv: 5, desc: '财气随身,金币获取 +15%/级' },
  armor:  { name: '铁甲',     icon: 'p_armor',  maxLv: 5, desc: '金钟罩体,护甲 +1/级' },
  crit:   { name: '暴击之眼', icon: 'p_crit',   maxLv: 5, desc: '慧眼窥破绽,暴击率 +6%/级' },
  guard:  { name: '玄武盾',   icon: 'p_armor',  maxLv: 5, desc: '玄武护体,护盾上限 +12/级并缓慢回复' },
  fortify:{ name: '金刚体',   icon: 'p_hp',     maxLv: 5, desc: '金刚淬骨,受到伤害 -5%/级' },
  retaliate:{ name: '反震诀', icon: 'p_crit',   maxLv: 5, desc: '借力打力,所受伤害的 8% 反伤近敌/级' },
};

const PASSIVE_BONUS = {
  might:  { key: 'mightMult',  mode: 'mult', v: 0.10 },
  cd:     { key: 'cdMult',     mode: 'mult', v: -0.08 },
  speed:  { key: 'speedMult',  mode: 'mult', v: 0.08 },
  hp:     { key: 'hpFlat',     mode: 'add',  v: 20 },
  magnet: { key: 'magnetFlat', mode: 'add',  v: 25 },
  xp:     { key: 'xpMult',     mode: 'mult', v: 0.10 },
  gold:   { key: 'goldMult',   mode: 'mult', v: 0.15 },
  armor:  { key: 'armorFlat',  mode: 'add',  v: 1 },
  fortify:{ key: 'damageTakenMult', mode: 'mult', v: -0.05 },
  // crit 无 bonuses 槽:applyChoice 在 recalc 后按等级直接写入 p.stats.crit
};

// 保底项(全满时):金币袋 / 大金币袋 / 馒头,id 互不相同
function goldChoice(amount, big) {
  return big
    ? { kind: 'gold', id: 'gold_big', name: '大金币袋', desc: `+${amount} 金币`, icon: 'coin', amount }
    : { kind: 'gold', id: 'gold', name: '金币袋', desc: `+${amount} 金币`, icon: 'coin', amount };
}
function healChoice(p) {
  return { kind: 'heal', id: 'heal', name: '馒头', desc: `回复 ${45} 生命`, icon: 'meat', heal: 45,
    _skip: p.hp >= p.stats.maxHp - 0.5 };
}

// ---- CONTRACT v2.2 §8:组合技推荐标记 ----
// 判定单个选项的 rec 文案(无推荐返回 null);可进化优先于联动。
// 只读 p.weapons 与 g.passiveLv + WEAPONS[id].evo 绑定关系,不改抽取概率。
function recFor(g, c, plv) {
  const p = g.player;
  const own = id => { for (const w of p.weapons) if (w.id === id) return true; return false; };
  if (c.kind === 'passive') { // ① 满级未进化武器的绑定心法 → 即将可进化
    for (const w of p.weapons) {
      const d = WEAPONS[w.id];
      if (w.lv >= d.maxLv && !w.evolved && d.evo && d.evo.passive === c.id) return '可进化·' + d.evo.evoName;
    }
    return null;
  }
  if (c.kind === 'newWeapon' || c.kind === 'weapon') { // ② 绑定心法已 ≥4 级 → 取此武器即可进化
    const d = WEAPONS[c.id];
    if (d && d.evo && (plv[d.evo.passive] || 0) >= 2) return '可进化·' + d.evo.evoName;
    // ③ 协同向:焚天↔墨雨系(阴阳相激)、五雷↔墨雨系(感电连锁)
    if (c.id === 'holy') {
      if (own('fireball')) return '联动·阴阳相激';
      if (own('lightning')) return '联动·感电连锁';
    } else if (c.id === 'lightning' && own('holy')) return '联动·感电连锁';
    if (c.id === 'fan' && own('needle')) return '联动·扇针合流';
    if (c.id === 'needle' && own('fan')) return '联动·扇针合流';
    if (c.id === 'lantern' && own('lightning')) return '联动·引魂雷印';
    if (c.id === 'lightning' && own('lantern')) return '联动·引魂雷印';
    if (c.id === 'lantern' && own('shield')) return '联动·灯护金钟';
    if (c.id === 'shield' && own('lantern')) return '联动·灯护金钟';
    return null;
  }
  if (c.kind === 'evolve' && c.id === 'holy') { // 墨染乾坤进化卡与协同标记共存(evolve 排序仍在前)
    if (own('fireball')) return '联动·阴阳相激';
    if (own('lightning')) return '联动·感电连锁';
  }
  return null;
}

// 加权不重复抽一项(从 pool 中 splice 移除)
function weightedPick(pool) {
  let tot = 0;
  for (let i = 0; i < pool.length; i++) tot += pool[i].w;
  let r = Math.random() * tot;
  for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) return pool.splice(i, 1)[0]; }
  return pool.splice(0, 1)[0];
}

// 被动等级记录在 g.passiveLv(main 开局创建;crit 等新键由 applyChoice 动态补)
// ══════ 神通(XX-ARCH-006 / owner 选 A:接上局内)══════════════
//
// 背景:修仙阁有 14 门神通,起始只有剑气 1 级;悟道要「两门都满级」才产出第三门,
// 而局内升级池根本没有神通 —— 于是 13/14 门永久锁死。
// Cult.syncArt 的注释写明原设计是「局内学会的 → 局外记录」,两头都没接。
//
// 本轮(owner 选 A)补上两头:
//   局内:升级池出现「参悟 X」,给**真实属性增益**(按 family 映射到既有 stats,
//         不新造 14 套弹道 —— 那会变成第二套战斗系统)
//   局末:runArtSync 把本局练到的等级 syncArt 回修仙阁
//
// 为什么用属性增益而不是每门一套弹道:
// 局内已经有完整的武器开火循环(js/game/weapons.js 的 w.update)。
// 再造 14 套神通弹道 = 两套战斗并行,平衡没法调,也和「一个决策点」的
// 核心循环打架。先让神通有**可感知的确定收益**,再谈差异化形态。

/** family → 局内属性增益。键名对应 player.stats 里的字段。 */
export const ART_FAMILY = {
  sword:  { might: 0.10, cd: 0.04 },   // 攻伐系:伤害 + 频率
  wind:   { might: 0.07, speed: 0.05 },// 风系:伤害 + 移速
  thunder:{ might: 0.09, cd: 0.05 },
  fire:   { might: 0.11 },             // 攻伐偏伤害
  water:  { might: 0.06, area: 0.05 },
  shield: { armor: 0.08, hp: 0.05 },   // 守御系:护甲 + 生命
  orb:    { might: 0.05, area: 0.07 },
  move:   { speed: 0.06, cd: 0.03 }, // 身法系:移速 + 冷却
};

/** 局内神通等级上限(和修仙阁 max=5 对齐) */
const ART_RUN_MAX = 5;

/** 局内神通表 —— 只带修仙阁神通页需要的三项,避免把整张 ARTS 拖进局内 */
/** 局内神通表 —— id/name/family 全部**从 arts.js 的 ARTS 实抄**,不手写。
 * (第一版手写,编出了 sha/shalei 两个根本不存在的 id)
 */
const RUN_ARTS = [
  ['jianqi','剑气','sword'],
  ['wanjian','御风','wind'],
  ['guanglei','贯日','sword'],
  ['wanjian2','流云扇','wind'],
  ['yubiyu','暴雨针','wind'],
  ['wulei','五雷','thunder'],
  ['fentian','焚天','fire'],
  ['moyu','墨雨','water'],
  ['jinzhong','金钟罩','shield'],
  ['zhenshen','玄武盾','shield'],
  ['moyuan','墨渊','orb'],
  ['huohuo','引魂灯','orb'],
  ['suodi','缩地成寸','move'],
  ['feibo','御风诀','move'],
];

/** 局内已练到的最高等级(供局末 syncArt 回写) */
export function runArtSync(g) {
  const out = [];
  const held = (g.player && g.player.arts) || {};
  for (const [id, name] of RUN_ARTS) {
    const lv = held[id] || 0;
    if (lv > 0) out.push([id, name, lv]);
  }
  return out;
}

export function rollChoices(g) {
  const p = g.player;
  const plv = g.passiveLv || (g.passiveLv = {});
  const cands = [];
  // 进化候选:武器满级 + 绑定被动满级 + 尚未进化 → 必占一档(最高权重)
  const evoIds = [];
  for (const w of p.weapons) {
    const d = WEAPONS[w.id];
    if (w.lv < d.maxLv) {
      cands.push({
        kind: 'weapon', id: w.id, icon: d.icon, w: 10,
        name: `${d.name} Lv.${w.lv + 1}`,
        desc: d.lvText[Math.min(d.lvText.length - 1, w.lv)],
      });
    } else if (!w.evolved) {
      const evo = d.evo;
      if (evo && (plv[evo.passive] || 0) >= Math.min(2, PASSIVES[evo.passive].maxLv)) evoIds.push(w.id); // 门槛:心法3级(v2.3 下调)
    }
  }
  // 新武器(未满 4 把)
  if (p.weapons.length < MAX_WEAPONS) {
    const owned = new Set(p.weapons.map(x => x.id));
    for (const id of WEAPON_ORDER) {
      if (owned.has(id)) continue;
      const d = WEAPONS[id];
      cands.push({ kind: 'newWeapon', id, name: d.name, desc: d.desc, icon: d.icon, w: 6 });
    }
  }
  // 神通(XX-ARCH-006):局内参悟,局末 syncArt 回修仙阁。
  // 权重低于被动 —— 局内战斗的决策重心仍应在武器,神通是长期投资。
  const held = p.arts || (p.arts = {});
  for (const [id, name, family] of RUN_ARTS) {
    const lv = held[id] || 0;
    if (lv < ART_RUN_MAX) {
      cands.push({
        kind: 'art', id, family, name: lv ? `参悟 ${name} ${lv + 1}` : `初窥 ${name}`,
        desc: lv ? `道法精进 · 局末带回修仙阁(现 ${lv}/${ART_RUN_MAX})`
                 : '初窥门径 · 局末带回修仙阁',
        icon: 'gem_g', w: 5,
      });
    }
  }
  // 被动(含 crit 暴击之眼)
  for (const id in PASSIVES) {
    if ((plv[id] || 0) < PASSIVES[id].maxLv) {
      const d = PASSIVES[id];
      cands.push({ kind: 'passive', id, name: d.name, desc: d.desc, icon: d.icon, w: 7 });
    }
  }
  const out = [];
  if (evoIds.length) { // 进化项独占一档,另两档为普通项
    const id = evoIds[(Math.random() * evoIds.length) | 0];
    const d = WEAPONS[id], evo = d.evo;
    out.push({ kind: 'evolve', id, name: `⚡进化·${evo.evoName}`, desc: evo.desc, icon: evo.icon, evo: true });
  }
  if (!out.length && !cands.length) { // 全满保底:金币 / 回血
    return [goldChoice(25), healChoice(p), goldChoice(60, true)];
  }
  const pool = cands.slice();
  while (out.length < 3 && pool.length) out.push(weightedPick(pool));
  // 不足 3 项时补保底(满血时不给回血项)
  const fills = [goldChoice(25), healChoice(p), goldChoice(60, true)];
  for (let i = 0; i < fills.length && out.length < 3; i++) {
    if (fills[i]._skip) continue;
    out.push(fills[i]);
  }
  while (out.length < 3) out.push(goldChoice(25));
  // rec 标记 + 排序(v2.2 §8):evolve 卡仍最前,rec 项次之;稳定排序,同档保持抽取顺序
  for (let i = 0; i < out.length; i++) {
    const r = recFor(g, out[i], plv);
    if (r) out[i].rec = r;
  }
  if (out.some(c => c.rec)) {
    const rank = c => (c.kind === 'evolve' ? 0 : c.rec ? 1 : 2);
    out.sort((a, b) => rank(a) - rank(b));
  }
  return out;
}

export function applyChoice(g, c) {
  const p = g.player;
  if (c.kind === 'newWeapon') {
    if (p.weapons.length < MAX_WEAPONS) p.weapons.push(makeWeapon(c.id));
  } else if (c.kind === 'weapon') {
    const w = p.weapons.find(x => x.id === c.id);
    if (w && w.lv < WEAPONS[w.id].maxLv) w.lv++;
  } else if (c.kind === 'evolve') { // 武器进化:实例原地升级为超武形态
    const w = p.weapons.find(x => x.id === c.id);
    if (w && !w.evolved) {
      w.evolved = true;
      w.evoId = c.id;
      const evo = WEAPONS[c.id].evo;
      g.addParticles(p.x, p.y, { n: 26, color: PAL.cinnabar, speed: 200, life: 0.8, size: 5, grav: 40 });
      g.spawnText(p.x, p.y - 64, `${evo.evoName}!`, { color: PAL.cinnabar, size: 24, life: 1.6 });
      Bus.emit('sfx', 'levelup');
    }
  } else if (c.kind === 'art') {
    const held = p.arts || (p.arts = {});
    const lv = (held[c.id] || 0) + 1;
    held[c.id] = lv;
    // 真实属性增益:每级按 family 给固定加成,和局内既有 stats 同一套口径。
    const fam = ART_FAMILY[c.family] || { might: 0.06 };
    for (const [k, v] of Object.entries(fam)) {
      if (k === 'cd' || k === 'speed') p.stats[k] *= (1 + v);
      else if (k === 'area') p.stats.areaMult = (p.stats.areaMult || 1) * (1 + v);
      else if (k === 'hp') p.stats.maxHp = (p.stats.maxHp || p.hp || 100) * (1 + v), p.hp = p.stats.maxHp;
      else if (k === 'armor') p.stats.armor = (p.stats.armor || 0) + v * 100;
      else p.stats.might = (p.stats.might || 1) * (1 + v);
    }
    g.spawnText(p.x, p.y - 60, `${c.name}!`, { color: PAL.gold, size: 20, life: 1.4 });
    Bus.emit('sfx', 'levelup');
  } else if (c.kind === 'passive') {
    g.passiveLv[c.id] = (g.passiveLv[c.id] || 0) + 1;
    const b = PASSIVE_BONUS[c.id];
    if (b) {
      const bon = p.bonuses;
      if (b.mode === 'mult') bon[b.key] *= (1 + b.v);
      else bon[b.key] += b.v;
    }
    if (c.id === 'speed') p.dashCdMul = (p.dashCdMul || 1) * 0.96; // 疾风靴:冲刺冷却 -4%/级
    if (c.id === 'guard' && p.addShieldCapacity) {
      p.addShieldCapacity(12);
      p.shieldRegen = (p.shieldRegen || 0) + 0.32;
    }
    if (c.id === 'retaliate') p.reflectRatio = Math.min(0.45, (p.reflectRatio || 0) + 0.08);
    p.recalc();
    // 暴击之眼:recalc 后按角色基础暴击叠加(基础 10% + 6%/级)
    p.stats.crit = (p.charBonus.crit || 0.1) + 0.06 * (g.passiveLv.crit || 0);
  } else if (c.kind === 'gold') {
    g.stats.gold += c.amount || 25;
  } else if (c.kind === 'heal') {
    p.hp = Math.min(p.stats.maxHp, p.hp + (c.heal || 45));
  }
}
