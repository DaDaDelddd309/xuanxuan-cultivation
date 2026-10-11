// ===== 装备图标资产层(物品图像)—— 图标 → 文件路径的唯一真源 =====
//
// 为什么单独一层:js/game/gear.js 是**纯数据**,里面 SLOTS 每项都声明了一个
// `icon:'g_head'` 字段 —— 但那个字段**全仓零消费方**(grep 只命中声明处),
// 4 个死键挂了半年没人报错。于是装备页只能拿文字凑,玩家看到的永远是
// 「一块灰卡片 + 一行小字」。
//
// 本文件只做一件事:**把槽位/装备 id 翻译成图标文件的相对路径**。
// 不画任何东西(那是 assets/gear/*.svg 的事),也不碰任何战斗/存档状态。
// UI 侧拿到路径后自己决定怎么渲染(<img src> / inline svg / mask),本层不管。
//
// 【为什么不用硬编码表】
// 这里刻意**不抄一份** `['hongyi_garment', ...]` 或 `['head','body',...]`:
// 那种副本一加新装备就静默漏掉,而漏掉的表现是「图不出来」而不是「报错」。
// 全部从 gear.js 的 GEAR_IDS / SLOTS **派生**,新增装备自动有图。
// 门禁 tests/gear-icon-assets-regression.mjs 的 G4 会核对派生关系没走样。
//
// 退出码无关(本文件不退出),门禁负责判定。
import { GEAR, GEAR_IDS, SLOTS } from './gear.js?v=17';

/** 图标根目录。相对站点根,与 ui/portrait.js 里 `'assets/portrait/xxx.jpg'` 同口径。 */
const GEAR_DIR = 'assets/gear/';

/** 槽位查表。用 Map 而不是普通对象:Object.prototype 上的键
 *  ('constructor' / '__proto__')对普通对象是**命中**的 —— 存档被改坏时
 *  一件叫 'constructor' 的装备就能凭空变出一条路径。Map 免疫。 */
const SLOT_BY_KEY = new Map(SLOTS.map(s => [s.key, s]));

/** gear 表是不是真有这个 id。
 *  必须 own-property 判定:`GEAR['constructor']` 是 Function(真值),
 *  用 `if (GEAR[id])` 会给一个不存在的装备返回一条看起来正常的路径 ——
 *  那种「返回了但指向空文件」的错误比直接返回 null 难查得多。 */
const hasGear = id => typeof id === 'string'
  && Object.prototype.hasOwnProperty.call(GEAR, id);

/**
 * 槽位图标路径。
 * @param {'head'|'body'|'hand'|'foot'} slotKey
 * @returns {string|null} 'assets/gear/slot-head.svg' 形式;槽位不存在 → null
 */
export function SLOT_ICON(slotKey) {
  const s = SLOT_BY_KEY.get(slotKey);
  return s ? `${GEAR_DIR}slot-${s.key}.svg` : null;
}

/**
 * 装备图标路径。
 * @param {string} gearId gear.js 里的 GEAR 键名
 * @returns {string|null} 'assets/gear/hongyi_garment.svg' 形式;没有这件装备 → null
 */
export function GEAR_ICON(gearId) {
  return hasGear(gearId) ? `${GEAR_DIR}${gearId}.svg` : null;
}

/** 4 个槽位在 gear.js 里声明的 icon 键('g_head' 等)。
 *  gear.js 那 4 个字段原来是死键;本文件是它们的**第一个读出口**,
 *  从此「改了 icon 键但没人看」不再是静默的。 */
export const SLOT_ICON_IDS = SLOTS.map(s => s.icon);

/** 单个槽位声明的 icon 键;槽位不存在或没声明 → null。 */
export function SLOT_ICON_KEY(slotKey) {
  const s = SLOT_BY_KEY.get(slotKey);
  return s && s.icon ? s.icon : null;
}

/** 应当有图标的装备 id 清单(门禁遍历用)。
 *  从 GEAR_IDS 派生而不是手抄 —— 见本文件顶部「为什么不用硬编码表」。
 *  复制一份再 freeze:调用方拿到的数组不该能改坏本模块的导出。 */
export const GEAR_ICON_IDS = Object.freeze(GEAR_IDS.slice());