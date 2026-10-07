// ===== 神通融合 / 悟道系统 · 数据层 =====
// 设计:两门神通修至满级(5级)后,可「悟道」消耗二者 + 一定道行,融合出超武。
// 超武继承双方特性并额外挂一条「道则」(新词条)。
// 契约:纯数据 + 纯函数,不依赖 DOM。融合表参考开源项目 mortal-tribulation 的
//       「双满级自动融合」结构,数值为本作独立设计。

// 神通库(局外永久掌握)。slot = 道则图标键,与 pix/items.js 对应。
export const ARTS = {
  // —— 剑系 ——
  jianqi:    { name: '剑气',   family: 'sword', max: 5, d: '扇形贯穿剑气,锋锐无匹', tint: '#c8d4e0' },
  wanjian:   { name: '御风',   family: 'wind',  max: 5, d: '御风追踪,刃随心动', tint: '#b8d8d0' },
  guanglei:  { name: '贯日',   family: 'sword', max: 5, d: '一箭洞穿,势不可挡', tint: '#e0c8a0' },
  wanjian2:  { name: '流云扇', family: 'wind',  max: 5, d: '扇风留痕,痕引雷至', tint: '#c8e0d8' },
  yubiyu:    { name: '暴雨针', family: 'wind',  max: 5, d: '散针如雨,专破气罩', tint: '#a8c8d8' },
  // —— 雷火 ——
  wulei:     { name: '五雷',   family: 'thunder',max: 5, d: '五雷正法,诛邪破魅', tint: '#a8b0e0' },
  fentian:   { name: '焚天',   family: 'fire',  max: 5, d: '烈焰焚天,灼烧不休', tint: '#e09060' },
  moyu:      { name: '墨雨',   family: 'water', max: 5, d: '泼墨成域,万物染墨', tint: '#6a7a8a' },
  // —— 玄甲 ——
  jinzhong:  { name: '金钟罩', family: 'shield',max: 5, d: '罩体生辉,近身不败', tint: '#d8c890' },
  zhenshen:  { name: '玄武盾', family: 'shield',max: 5, d: '玄龟负甲,盾随气长', tint: '#8ab0a0' },
  // —— 器灵 ——
  moyuan:    { name: '墨渊',   family: 'orb',   max: 5, d: '墨珠环绕,触之即溃', tint: '#7a6a8a' },
  huohuo:    { name: '引魂灯', family: 'orb',   max: 5, d: '青灯引魂,魂火灼魂', tint: '#7ae0d0' },
  // —— 遁法 ——
  suodi:     { name: '缩地成寸',family:'move', max: 5, d: '一步千里,缩地无痕', tint: '#c0c0e0' },
  feibo:     { name: '御风诀', family: 'move',  max: 5, d: '御风千里,来去无踪', tint: '#a0d0e0' },
};

// 融合配方:a+b -> out。order 不敏感(会自动排序)。
// 10 组,覆盖剑/雷火/玄甲/器灵/遁法五大方向。
const RECIPES = [
  { a:'jianqi',   b:'guanglei', out:'wanji',  dao:3000,  rule:'万剑归宗',
    text:'剑气化万剑,一念成阵。' },
  { a:'guanglei', b:'wanjian',  out:'chuanyun', dao:3500, rule:'穿云贯日',
    text:'箭乘风势,破云见日。' },
  { a:'wulei',    b:'moyu',     out:'ganle',  dao:5000,  rule:'感电连锁',
    text:'雷入墨水,导电千里。' },
  { a:'fentian',  b:'moyu',     out:'yanyang',dao:5500,  rule:'阴阳相激',
    text:'水火相激,蒸汽爆裂。' },
  { a:'wanjian2', b:'yubiyu',   out:'chanyi', dao:4200,  rule:'扇针合流',
    text:'扇风引针,千针齐发。' },
  { a:'huohuo',   b:'wulei',    out:'yinhun', dao:6000,  rule:'引魂雷印',
    text:'灯引魂,雷落印。' },
  { a:'huohuo',   b:'zhenshen', out:'denghuzhong', dao:6500, rule:'灯护金钟',
    text:'灯罩身,魂火护体。' },
  { a:'jinzhong', b:'moyuan',   out:'zhoutian',dao:7000,  rule:'周天星斗',
    text:'七珠周天,墨渊化星。' },
  { a:'suodi',    b:'jinzhong', out:'tianjiao',dao:7500,  rule:'天罡步',
    text:'缩地入甲,瞬息千里。' },
  { a:'feibo',    b:'moyu',     out:'yunmo',  dao:5800,  rule:'云墨',
    text:'云行墨走,墨随云散。' },
];

// 超武定义(由配方生成的成品)
export const SUPER_ARTS = {};
for (const r of RECIPES) {
  SUPER_ARTS[r.out] = {
    name: r.out, rule: r.rule, text: r.text,
    a: r.a, b: r.b, dao: r.dao,
    tier: 1, max: 1,          // 超武满级即 1 级(不占升级次数)
  };
}

// 归一化 key,避免顺序影响
function key2(a, b) { return [a, b].sort().join('+'); }

// 预建查表
const RECIPE_MAP = new Map();
for (const r of RECIPES) RECIPE_MAP.set(key2(r.a, r.b), r);

export function findRecipe(a, b) {
  if (!a || !b || a === b) return null;
  return RECIPE_MAP.get(key2(a, b)) || null;
}

// 悟道:检查两门神通是否都满级 + 道行是否够。消耗后返回新神通 id。
// s: { arts:{id:lv}, dao }
export function canEnlighten(s, a, b) {
  const rec = findRecipe(a, b);
  if (!rec) return { ok: false, code: 'no_recipe', msg: '此二者无融合之道' };
  const la = s.arts[a] || 0, lb = s.arts[b] || 0;
  if (la < 5 || lb < 5) return { ok: false, code: 'not_max',
    msg: `需二者皆修至满级(现 ${la}/${5} · ${lb}/${5})` };
  if (s.dao < rec.dao) return { ok: false, code: 'no_dao',
    msg: `道行不足,需 ${rec.dao}(现 ${s.dao})` };
  return { ok: true, code: 'ok', out: rec.out, rec };
}

export function enlighten(s, a, b) {
  const chk = canEnlighten(s, a, b);
  if (!chk.ok) return chk;
  s.dao -= chk.rec.dao;
  s.arts[chk.out] = 1;
  s.arts[a] = Math.max(0, (s.arts[a] || 0) - 1);
  s.arts[b] = Math.max(0, (s.arts[b] || 0) - 1);
  return { ok: true, out: chk.out, rec: chk.rec };
}

export function defaultArts() {
  return { jianqi: 1 };  // 初始掌握剑气
}

export function artName(id) {
  return SUPER_ARTS[id] ? SUPER_ARTS[id].rule : (ARTS[id] ? ARTS[id].name : id);
}
export function artFull(id) {
  return SUPER_ARTS[id] ? SUPER_ARTS[id].text : (ARTS[id] ? ARTS[id].d : '');
}
export function isSuper(id) { return !!SUPER_ARTS[id]; }
// 已融合出的超武 id 集合(给战斗层判断加成/冷却用)
export function superSet(arts) {
  const out = {};
  for (const k in arts || {}) if (SUPER_ARTS[k] && arts[k] > 0) out[k] = 1;
  return out;
}
export const SUPER_ARTS_EXPORT = SUPER_ARTS;
