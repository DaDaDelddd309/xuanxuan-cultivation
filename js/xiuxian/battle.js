// ===== 回合制剧情战斗 · 核心 =====
// 设计要点(严格按需求):
//  1. 怪物「近身」时从自动割草切入回合制,不是另开一个游戏,是同一场战斗换形态。
//  2. 血量继承:自动阶段已打掉的血按百分比保留,回合制阶段接着打。
//     例:自动阶段打了 60%,回合制从 40% 继续。
//  3. 回合制内「一招我一招」:玩家出一个技能 → 敌人行动 → 循环。
//  4. 玩家用局外学会的神通(arts),局内成长不丢失。
//  5. 剧情文本 + 敌人立绘,像 RPG 对话。
// 契约:纯逻辑,不碰 DOM/Canvas。由 ui/dialog 模块渲染。

import { artName, artFull } from './arts.js';

import { PAL } from '../core/palette.js';
const CN = ['零','一','二','三','四','五','六','七','八','九','十'];

// 敌人档案:境界名 + 台词 + 属性偏向
const ARCHETYPES = {
  guard: {   title:'外门执事',   realm:'炼气九层',   col:PAL.paperFaint,
    lines:['区区散修,也敢闯我山门?','规矩就是规矩,受死吧。','你不该来的。'] },
  wanderer:{ title:'游荡散修',   realm:'炼气十二层', col:'#7a9a6a',
    lines:['这株灵草,我要了。','同门相残?哈,江湖本就如此。','来战!'] },
  elder: {   title:'青云长老',   realm:'筑基初期',   col:PAL.xp,
    lines:['小友好大的杀心。','筑基方为修士,你还差得远。','此番,老夫代天行道。'] },
  yao: {     title:'青岚妖王',   realm:'筑基后期',   col:'#c86a4a',
    lines:['吼——！','妖道当诛!','你们这些蝼蚁!'] },
  devil: {   title:'黑风魔修',   realm:'金丹期',     col:'#7a3ac8',
    lines:['区区筑基,也敢直视本座?','血祭,开!','你的道途,到此为止。'] },
};

export function makeEnemy(id, key) {
  const a = ARCHETYPES[key] || ARCHETYPES.guard;
  return {
    key, title:a.title, realm:a.realm, col:a.col,
    hpMax: 100, hp: 100,
    dmg: 12 + Math.floor(Math.random()*8),
    line: a.lines[Math.floor(Math.random()*a.lines.length)],
    def: 2,
  };
}

// ---- 核心:从自动战斗切入回合制,做血量继承 ----
// autoHpLeft / hpMax = 自动阶段剩余血量比例(0~1)
export function enterTurnBased(e, hpRatio) {
  e.hpMax = 100;
  e.hp = Math.max(1, Math.min(100, Math.round(100 * hpRatio)));
  e.turn = 0;
  return e;
}
export function inheritedRatio(e) { return e.hp / e.hpMax; }

// ---- 技能:玩家每个回合从已掌握神通里选一个 ----
// damage = base * artsLevelMul;level=5 满级额外加成
function artDamage(s, id) {
  const lv = s.arts[id] || 0;
  if (lv <= 0) return 0;
  // 满级(5)=1.6x;超武(tier1)=2.2x
  const isS = !!s.isSuper?.[id];
  const mul = isS ? 2.2 : 1 + (lv - 1) * 0.15;
  return Math.round((10 + lv * 4) * mul);
}
// 冷却周期 P =「这张牌用掉之后,隔几个回合能再上场」。
// 递减发生在回合边界(tickCooldown,duel.js:399 每个玩家回合一次),所以
// 「本回合用掉 ⇒ 接下来 P-1 个回合点不动」,玩家在按钮上看到的是 P-1。
//
// 【不变式 —— 改这条曲线前先读这段】
//   一个玩家回合只出一张牌 ⇒ 任意时刻最多只有 P-1 张牌躺在冷却里(每回合只新增一张)
//   ⇒ 想让玩家手里**永远剩下 ≥2 张可选**,必须 P-1 ≤ n-2,即 **P ≤ n-1**(n = 已掌握神通数)。
//   P 一旦超过 n-1,牌组就会周期性地「只剩一张 / 一张不剩」。
//
// 旧实现 `max(1, 4 - floor(lv/2))` 与 n 无关,实测(多种子 × 多配置,回合边界递减):
//   默认存档只有一门神通(defaultArts() = {jianqi:1}),P=4
//     ⇒ **67% 的回合玩家一张牌都点不动**(走 duel.js:407 的强制普攻,全程零输入)
//   两门神通 lv1 两门都是 P=4 ⇒ 两张牌在同一个回合一起转正,
//     「两张牌可选」只占 23.7% 的回合
//   这就是「选什么都不影响结果」在冷却这一层的形状:牌根本没回来,没有第二次决策。
//
// 现在 P 取 min(原曲线, n-1):牌组小就自动降冷却,而不是让玩家空转;
// 牌组够大(n≥3)时仍保留原梯度(等级越高回场越快),冷却依旧真实生效 ——
// 玩家依然不能「每回合把同一张牌放一遍」。
function artCd(s, id) {
  const isS = !!s.isSuper?.[id];
  if (isS) return 1;                                 // 超武无冷却(duel-balance-invariant C8)
  const lv = s.arts[id] || 0;
  const base = Math.max(1, 4 - Math.floor(lv / 2));   // 原曲线:lv1→4 lv2/3→3 lv4/5→2
  const n = availableArts(s).length;                 // 与 canUseArt 同一套候选池,别开第二套口径
  return Math.min(base, Math.max(1, n - 1));
}

export function availableArts(s) {
  return Object.keys(s.arts).filter(id => (s.arts[id] || 0) > 0);
}

export function canUseArt(s, id) {
  if (!s.arts[id]) return false;
  if ((s.cooldown || {})[id] > 0) return false;
  return true;
}

// 玩家出一招
export function playerAct(s, e, artId) {
  if (!canUseArt(s, artId)) return null;
  const dmg = Math.max(1, artDamage(s, artId) - e.def);
  e.hp = Math.max(0, e.hp - dmg);
  s.cooldown = s.cooldown || {};
  s.cooldown[artId] = artCd(s, artId);
  // ⚠️ XX-DUEL-007:冷却递减原来**写在 playerAct 里面**。
  //   而 duel.js 的「无牌可打 → 强制普攻」分支根本不调 playerAct ——
  //   于是那条路上冷却永远不转正。
  //   实测(duel-balance-invariant 的模拟):单神通玩家整场只出 1 招、
  //   双神通玩家只出 2 招,之后全程零输入的自动战斗。
  //   症状不是「手感差」,是**冷却冻结** —— 玩家看着自己被动挨打。
  //   现在递减移到回合边界(见 tickCooldown),由 Duel.playerTurn 统一调一次,
  //   无论本回合走哪条分支。
  return { art:artId, name:artName(artId), dmg, text:artFull(artId) };
}

// 敌人出一招
export function enemyAct(e, s) {
  const crit = Math.random() < 0.15;
  let dmg = Math.round(e.dmg * (0.85 + Math.random()*0.4) * (1 - (s.dmgReduce||0)));
  if (crit) dmg = Math.round(dmg * 1.6);
  s.hp = Math.max(0, s.hp - dmg);
  return { dmg, crit, line: e.line };
}

/** 推进一个玩家回合:所有冷却 -1。**每回合必须且只能调一次。 */
export function tickCooldown(s) {
  s.cooldown = s.cooldown || {};
  for (const k in s.cooldown) if (s.cooldown[k] > 0) s.cooldown[k]--;
}

export function isDead(e) { return e.hp <= 0; }
export function playerDead(s) { return s.hp <= 0; }

// 玩家血量由「自动战斗时的实际 hp」继承而来,不是满血。
// hpRatio 同样保留。
export function carryOver(s, autoHpRatio) {
  s.hp = Math.max(1, Math.round(s.hpMax * autoHpRatio));
  s.cooldown = {};
  return s;
}

export function realmDisplay(realm, layer) {
  return `${realm}${CN[layer] || layer}层`;
}
