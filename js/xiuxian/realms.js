import { PAL } from '../core/palette.js';
// ===== 修仙境界系统 · 数据层 =====
// 设计:炼气期分 12 层(1~12),圆满后需「筑基丹」方可突破至筑基期。
// 筑基期分 9 层,后续境界预留扩展(金丹/元婴/化神)。
// 修为(exp)是局外累积资源,战斗掉落 + 自动增长;突破在「洞府」手动进行。
// 契约:纯数据 + 纯函数,不依赖 DOM / Canvas,可被 save / ui / battle 层引用。

// 境界定义。层数 = 该境界可修的层。need 是「升到下一层」所需修为基数。
// mul 为该境界对基础属性的整体乘区(线性,便于平衡)。
export const REALMS = [
  { id: 'qi',      name: '炼气期', layers: 12, color: PAL.paperFaint, mul: 1.00,
    desc: '引气入体,凡俗之始' },
  { id: 'zhuji',   name: '筑基期', layers: 9,  color: PAL.xp, mul: 1.55,
    desc: '道基初成,可御风而行', requires: 'pill_zhuji' },
  { id: 'jindan',  name: '金丹期', layers: 9,  color: PAL.qi, mul: 2.40,
    desc: '结丹于腹,寿元三百', requires: 'pill_jindan' },
  { id: 'yuanying',name: '元婴期', layers: 9,  color: '#b86fd0', mul: 3.80,
    desc: '碎丹成婴,神魂离体', requires: 'pill_yuanying' },
  { id: 'huashen', name: '化神期', layers: 9,  color: PAL.goldDim, mul: 6.00,
    desc: '神意化域,言出法随', requires: 'pill_huashen' },
];

// 每层所需修为(数组索引 = 层数-1,不足的按最后一层算)
const LAYER_COST = {
  qi:       [50, 90, 150, 240, 360, 520, 720, 980, 1300, 1700, 2200],
  zhuji:    [4000, 6500, 9500, 13500, 18500, 25000, 33000, 43000],
  jindan:   [60000, 90000, 130000, 185000, 255000, 340000, 450000],
  yuanying: [600000, 900000, 1350000, 1900000, 2600000],
  huashen:  [3500000, 5500000],
};

// 突破丹。found=解锁地图位置,没有就意味着得先在地图上跑一趟。
export const PILLS = {
  pill_zhuji:    { id: 'pill_zhuji',    name: '筑基丹', realms: 'qi',       price: 2000,
                   desc: '服之可破炼气九转之壁,直入筑基。', rare: 0.18 },
  pill_jindan:   { id: 'pill_jindan',   name: '结丹丹', realms: 'zhuji',    price: 45000,
                   desc: '三转之基,成丹之钥。', rare: 0.06 },
  pill_yuanying: { id: 'pill_yuanying', name: '元婴丹', realms: 'zhuji',    price: 180000,
                   desc: '碎丹成婴,神游太虚。', rare: 0.03 },
  pill_huashen:  { id: 'pill_huashen',  name: '化神丹', realms: 'jindan',   price: 1200000,
                   desc: '神识化域,万法由心。', rare: 0.008 },
};

// ---- 基础工具 ----
export function realmIndex(realmId) {
  return REALMS.findIndex(r => r.id === realmId);
}
export function getRealm(realmId) {
  return REALMS[realmIndex(realmId)] || REALMS[0];
}
export function maxLayerOf(realmId) {
  return getRealm(realmId).layers;
}
export function isFinalRealm(realmId) {
  return realmIndex(realmId) === REALMS.length - 1;
}

// 升到「当前境界第 layer+1 层」所需修为;若已在本境界顶层,返回 null(需突破)。
export function layerCost(realmId, layer) {
  const arr = LAYER_COST[realmId] || [];
  if (layer < 1) layer = 1;
  if (layer > arr.length) return null;           // 本境界已修满
  return arr[layer - 1] || arr[arr.length - 1];
}

// 下一个大境界(突破目标)
export function nextRealm(realmId) {
  const i = realmIndex(realmId);
  return i < 0 || i >= REALMS.length - 1 ? null : REALMS[i + 1];
}

// ---- 突破判定 ----
// 返回 {ok, code, msg}
// code: 'ok' | 'need_pill' | 'need_exp' | 'max_layer' | 'no_next' | 'need_cause'
export function canBreakthrough(s) {
  const r = getRealm(s.realm);
  if (s.layer < r.layers) {
    return { ok: false, code: 'need_exp', msg: `修为未满,还需 ${fmt(layerCost(s.realm, s.layer))} 修为方可冲击 ${r.name}${s.layer}层圆满` };
  }
  const nxt = nextRealm(s.realm);
  if (!nxt) return { ok: false, code: 'no_next', msg: '已至化神巅峰,前路需自行开辟' };
  if (nxt.requires) {
    const p = PILLS[nxt.requires];
    const owned = (s.pills && s.pills[nxt.requires]) || 0;
    if (owned <= 0) {
      return { ok: false, code: 'need_pill',
        msg: `需【${p ? p.name : nxt.requires}】方可突破 —— 去「${pillLocation(p)}」寻找` };
    }
  }
  return { ok: true, code: 'ok', msg: `可突破至 ${nxt.name}` };
}

function pillLocation(p) {
  if (!p) return '某处秘境';
  if (p.rare >= 0.15) return '青岚秘境';
  if (p.rare >= 0.05) return '黑风岭';
  return '古战场遗迹';
}

// 突破:消耗丹药,进入新境界第 1 层。返回新状态或 null(失败原因)。
export function doBreakthrough(s) {
  const chk = canBreakthrough(s);
  if (!chk.ok) return { err: chk };
  const nxt = nextRealm(s.realm);
  if (nxt.requires) s.pills[nxt.requires] = Math.max(0, (s.pills[nxt.requires] || 0) - 1);
  s.realm = nxt.id;
  s.layer = 1;
  s.exp = 0;
  return { ok: true, realm: nxt };
}

// ---- 修为增长(局外) ----
// exp 是「当前层已积累的修为」;层满后溢出部分自动进下一层(但不跨大境界)。
export function addExp(s, amount) {
  amount = Math.max(0, Math.floor(amount) || 0);
  if (!amount) return { levels: 0, broke: false };
  s.exp += amount;
  let levels = 0;
  // 允许一次加经验跨多层
  let guard = 0;
  while (guard++ < 200) {
    const r = getRealm(s.realm);
    if (s.layer > r.layers) break;
    const c = layerCost(s.realm, s.layer);
    if (c === null) break;                     // 本境界层数表已满
    if (s.exp < c) break;
    s.exp -= c;
    if (s.layer < r.layers) { s.layer++; levels++; }
    else { s.exp = 0; break; }                 // 顶层,余下修为留到突破后再算
  }
  return { levels, broke: s.layer >= getRealm(s.realm).layers };
}

// ---- 战斗力(总览用) ----
export function combatPower(s) {
  const r = getRealm(s.realm);
  const layerMul = 1 + (s.layer - 1) * 0.08;    // 每层 +8%
  const expRatio = s.exp / (layerCost(s.realm, s.layer) || 1);
  return Math.round((100 + s.layer * 20) * r.mul * layerMul * (1 + Math.min(0.3, expRatio * 0.3)));
}

export function realmTitle(s) {
  return `${getRealm(s.realm).name}${s.layer}层`;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}
export { fmt };

// ---- 默认存档(局外) ----
export function defaultCultivation() {
  return {
    realm: 'qi', layer: 1, exp: 0,
    pills: {},              // { pill_zhuji: 1, ... }
    dao: 0,                 // 道行(货币)
    totalKills: 0,
    artifacts: {},          // 神通保留(悟道产物)
  };
}
