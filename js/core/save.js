// ===== 🖥️ UI agent 名下:本地存档(容错解析 + 字段校验 + 坏档回默认) =====
// 结构契约:{v,gold,chars,settings,best,gear,totalRuns,totalKills}  key:'pxs_save'
const KEY = 'pxs_save';

// 角色白名单(与 CHARACTERS 一致,防脏数据混入)
const VALID_CHARS = ['knight', 'mage', 'ranger', 'white'];

// 装备槽位 + 装备 id 白名单(XX-EQUIP-003)。
// 这里**重复声明**而不从 game/gear.js import:save.js 是最早被加载的模块,
// 从它拉 gear.js 会把整个游戏层拖进 UI 层依赖链,方向反了。
// 两份列表若不一致,由 tests/gear-regression.mjs 的存档契约段报出来 ——
// 比运行时才发现「存档里有件不存在的装备」便宜得多。
const VALID_SLOTS = ['head', 'body', 'hand', 'foot'];
const VALID_GEAR = [
  'hongyi_garment', 'laolao_hairpin', 'baize_claw', 'dangkang_ring',
  'qingqiong_robe', 'jiangu_blade', 'shijiang_seal', 'dengshi_lamp',
];
// 装备 id → 槽位。同样**重复声明**而不从 gear.js import,理由同上。
// 两份若不一致,由 tests/gear-regression.mjs 的存档契约段报出来。
// ⚠️ 这张表是必需的,不是图省事:equip() 必须知道"这件穿哪个槽",
//    而 save.js 不能反向依赖 gear.js(会把整个游戏层拖进 UI 层依赖链)。
const GEAR_SLOT = {
  hongyi_garment:'body', laolao_hairpin:'head', baize_claw:'hand', dangkang_ring:'hand',
  qingqiong_robe:'foot', jiangu_blade:'hand', shijiang_seal:'head', dengshi_lamp:'foot',
};

function defaults() {
  return {
    v: 1, gold: 0, chars: ['knight'],
    settings: { sfx: true, music: true, shake: true, lowgfx: false, fpsShow: false },
    best: { time: 0, kills: 0, level: 0, victory: false },
    // 装备:槽位 → 装备 id。新档全空 —— 送了新手装备就会让
    // 「结案 → 掉装备 → 穿戴」这条链变成可有可无(那是 XX-EQUIP-005 要验的东西)。
    gear: { head: null, body: null, hand: null, foot: null },
    // 背包里的装备(还没穿的)。与 gear 分开存:
    // 「拿到」和「穿上」是两件事,分不开就没法做「换装」。
    // 同样**不送新手装备** —— 否则玩家永远学不会结案才能拿东西。
    gearOwned: [],
    totalRuns: 0, totalKills: 0,
  };
}

// 宽松转非负整数;非法/NaN 回退 fb
function toInt(v, fb, max = 99999999) {
  v = Math.floor(Number(v));
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : fb;
}
function toBool(v, fb) { return typeof v === 'boolean' ? v : fb; }

// 把任意来源(可能损坏/被篡改/缺字段)的数据清洗为合法结构
function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  d.gold = toInt(raw.gold, 0);
  if (Array.isArray(raw.chars)) {
    d.chars = [...new Set(raw.chars.filter(id => typeof id === 'string' && VALID_CHARS.includes(id)))];
  }
  if (!d.chars.length) d.chars = ['knight'];
  if (!d.chars.includes('knight')) d.chars.unshift('knight'); // 初始角色永远可用
  if (raw.settings && typeof raw.settings === 'object') {
    d.settings.sfx = toBool(raw.settings.sfx, true);
    d.settings.music = toBool(raw.settings.music, true);
    d.settings.shake = toBool(raw.settings.shake, true);
    d.settings.lowgfx = toBool(raw.settings.lowgfx, false);
    d.settings.fpsShow = toBool(raw.settings.fpsShow, false);
  }
  if (raw.best && typeof raw.best === 'object') {
    d.best.time = toInt(raw.best.time, 0);
    d.best.kills = toInt(raw.best.kills, 0);
    d.best.level = toInt(raw.best.level, 0);
    d.best.victory = toBool(raw.best.victory, false);
  }
  d.totalRuns = toInt(raw.totalRuns, 0);
  d.totalKills = toInt(raw.totalKills, 0);
  // 装备:逐槽清洗。旧档没有 gear 字段 → 全空(不是报错,是正常升级路径)。
  // 槽位不合法或装备 id 不在白名单 → 当作没穿,而不是崩。
  if (raw.gear && typeof raw.gear === 'object') {
    for (const slot of VALID_SLOTS) {
      const id = raw.gear[slot];
      d.gear[slot] = (typeof id === 'string' && VALID_GEAR.includes(id)) ? id : null;
    }
  }
  // 已拥有的装备:逐个过白名单,顺带**保证每件装备只算一次**
  // (重复结案、或老档里同一件出现过多次,都只留一次 —— 否则会出现两件同 id 的"红嫁衣")
  if (Array.isArray(raw.gearOwned)) {
    const seen = new Set();
    for (const id of raw.gearOwned) {
      if (typeof id === 'string' && VALID_GEAR.includes(id) && !seen.has(id)) seen.add(id);
    }
    d.gearOwned = [...seen];
  }
  // 穿着的必须也在背包里 —— 否则改档就能白嫖一件没拿到的装备
  for (const slot of VALID_SLOTS) {
    if (d.gear[slot] && !d.gearOwned.includes(d.gear[slot])) d.gear[slot] = null;
  }
  return d;
}

export const Save = {
  data: defaults(),

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.data = raw ? sanitize(JSON.parse(raw)) : defaults();
    } catch {
      this.data = defaults(); // JSON 损坏 = 坏档,回默认
    }
    return this.data;
  },

  commit() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch { /* 隐私模式/配额满:静默失败,不影响游戏 */ }
  },

  reset() { this.data = defaults(); this.commit(); },

  // ————— 装备(XX-EQUIP-005)—————
  /** 拿到一件装备(结案掉落)。重复拿到返回 false —— 本系统**不产出第二件**。 */
  ownGear(id) {
    if (typeof id !== 'string' || !VALID_GEAR.includes(id)) return false;
    if (this.data.gearOwned.includes(id)) return false;
    this.data.gearOwned.push(id);
    this.commit();
    return true;
  },

  ownsGear(id) { return this.data.gearOwned.includes(id); },

  /**
   * 穿上。**单槽互斥**:同槽位的旧装备自动回到背包,不会凭空消失。
   * @returns {{ok:boolean, msg?:string, replaced?:string|null}}
   */
  equip(id) {
    if (!this.ownsGear(id)) return { ok: false, msg: '还没有这件' };
    const slot = GEAR_SLOT[id];
    if (!VALID_SLOTS.includes(slot)) return { ok: false, msg: `${id} 的槽位不合法` };
    const d = this.data.gear;
    const replaced = d[slot];
    d[slot] = id;                      // ⚠️ 键是**槽位**,不是装备 id
    this.commit();
    return { ok: true, replaced: replaced === id ? null : replaced };
  },

  /** 脱下某个槽位 */
  unequip(slot) {
    if (!VALID_SLOTS.includes(slot)) return { ok: false, msg: '没有这个槽位' };
    if (!this.data.gear[slot]) return { ok: false, msg: '这个槽位本来就是空的' };
    this.data.gear[slot] = null;
    this.commit();
    return { ok: true };
  },

  /** 当前穿着的一整套(loadoutBonus 的输入形状) */
  loadout() {
    const out = {};
    for (const slot of VALID_SLOTS) if (this.data.gear[slot]) out[slot] = this.data.gear[slot];
    return out;
  },
};
