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

const CN = ['零','一','二','三','四','五','六','七','八','九','十'];

// 敌人档案:境界名 + 台词 + 属性偏向
const ARCHETYPES = {
  guard: {   title:'外门执事',   realm:'炼气九层',   col:'#8a8a7a',
    lines:['区区散修,也敢闯我山门?','规矩就是规矩,受死吧。','你不该来的。'] },
  wanderer:{ title:'游荡散修',   realm:'炼气十二层', col:'#7a9a6a',
    lines:['这株灵草,我要了。','同门相残?哈,江湖本就如此。','来战!'] },
  elder: {   title:'青云长老',   realm:'筑基初期',   col:'#63c74d',
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
function artCd(s, id) {
  const lv = s.arts[id] || 0;
  const isS = !!s.isSuper?.[id];
  return isS ? 1 : Math.max(1, 4 - Math.floor(lv / 2));
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
  // 回合数递减所有冷却
  for (const k in s.cooldown) if (s.cooldown[k] > 0) s.cooldown[k]--;
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
