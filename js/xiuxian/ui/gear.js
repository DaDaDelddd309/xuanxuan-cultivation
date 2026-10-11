// ===== 修仙阁 · 装备页(XX-EQUIP-005 · 重构:槽位网格 + 背包网格 + 点选/拖拽)=====
//
// 契约(不变):纯渲染 + 事件绑定,**不改状态结构**。所有写入走 core/save.js 的
//   Save.equip / Save.unequip —— 规则(单槽互斥、必须先拥有)只在那儿定一次。
//
// 玩家原话(要的是梦幻西游那种感觉):
//   「装备页面不能像梦幻西游那种感觉吗?拖拽的方式或者点一下装上,物品不也有图片素材的吗?」
// 于是这一页的结构改成:
//   · 已穿戴 = 4 个槽位网格:点一下脱下,也可以从这里拖回背包
//   · 背包   = 装备网格:点一下直接穿到它自己的槽位,也可以拖到槽位
//   · 两条路径的落档结果必须完全一致(同一件装备,点着穿和拖着穿,存档一模一样)
//
// 为什么装备页要单独一页而不是塞进行囊:
//   行囊是「消耗品」语义(源石、传承书,用掉就没了),装备是「持有物」语义
//   (拿到就是拿到了,能换能脱)。两者的操作模型不同。
//
// ⚠️ 拖拽为什么不用 HTML5 的 dragstart/dragover/drop:那是鼠标专属通道,
//    触摸设备上基本不触发。这里走 Pointer Events —— 一套代码同时覆盖鼠标和触摸,
//    阈值与收尾照 js/ui/joystick.js 的既有写法:一次只允许一根手指、cancel 必须收尾、
//    切后台要释放。
//
// ⚠️ 背包区是**纵向滚动容器**,玩家报过「滑动不了,向下拉不了」。所以判定顺序是:
//   · 位移 >6px 但还没按住满 150ms → 判定为**滚动手势**,放弃拖拽,把滚动交还页面
//     (若「一动就拖」,快速滑动背包会直接变成拖拽,滚动就废了)
//   · 按住满 150ms 不动 → 进拖拽态(幽灵立刻出现),此后 preventDefault 挡掉页面滚动
//   · 拖拽态下松手、期间一次没动 → 撤销,并且**不拦这次 click**
//     (慢按的玩家不该因为多按了半秒就丢掉那一次点击)
//   · 结构上不给 .xx-gear-bag 写死高度 —— 能不能滚、滚多高由 CSS 决定
//
// ⚠️ 本文件被 ui.js import,故**不能反向 import Hall** —— ui.js import 本文件,
//    本文件再 import ui.js 就成环。组件通过参数 `hall` 拿引用。
// ⚠️ 每个**首参是 hall** 的 export function 都必须在 Hall 上有同名转发壳
//    (test-ui-split 强制)。下面只新增了两个纯判定函数(首参不是 hall),
//    它们不是 Hall 方法,不需要壳 —— 见 gearDragPhase / gearDropAction。
import { Save } from '../../core/save.js?v=17';
import { GEAR, GEAR_IDS, SLOTS, SLOT_KEYS, gearBonus, AFFIXES } from '../../game/gear.js?v=17';
// ⚠️ 图标映射由另一处统一提供,本文件**不自己造一份副本** —— 两份映射一定会漂移。
//    签名固定:SLOT_ICON(slotKey) / GEAR_ICON(gearId) → 'assets/gear/xxx.svg' 这样的路径。
//    import 戳必须与别处引用同一模块时一致(本文件用 ?v=17,与同文件既有的
//    gear.js?v=17 同款),否则 lint-module-identity 会报模块身份分裂。
import { SLOT_ICON, GEAR_ICON } from '../../game/gearIcons.js?v=17';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/** 拖拽判定阈值。写在模块级并导出:门禁要按同一组数字驱动手势,
 *  写死一份在测试里的话,改阈值就会变成"测的是另一个世界"。 */
export const DRAG_MOVE_PX = 6;    // 位移:超过且没按住满 HOLD → 判为滚动手势,交还页面
export const DRAG_HOLD_MS = 150;  // 长按:按住不动到这么久才进拖拽态
const GHOST_HALF = 24;            // 幽灵跟手时的取中偏移(px),视觉由 CSS 定

const SLOT_NAME = k => (SLOTS.find(s => s.key === k) || {}).name || k;

/** 图标标签。路径缺失就什么都不画 —— 不留 undefined/空 src 的破图。 */
function iconTag(path, alt) {
  const src = typeof path === 'string' ? path.trim() : '';
  if (!src) return '';
  return `<img src="${esc(src)}" alt="${esc(alt || '')}" draggable="false">`;
}

/** 一件装备的词条明细,写成人话 */
function affixText(id) {
  const g = GEAR[id];
  if (!g) return '';
  const b = gearBonus(id);
  return Object.entries(g.affixes || {}).map(([k, lv]) => {
    const a = AFFIXES[k];
    if (!a) return '';
    return `${a.name} ${lv}`;
  }).filter(Boolean).join(' · ');
}

/** 悬停/长按提示:名字 + 词条(手机没有 hover,这条是桌面与读屏的兜底) */
function titleOf(id) {
  const g = GEAR[id];
  if (!g) return '';
  const t = affixText(id);
  return t ? `${g.name} · ${t}` : g.name;
}

// ─────────────────────────────────────────────
// 纯判定:不碰 DOM、不碰存档。导出是为了门禁能在合成样本上单独验它们。
// ─────────────────────────────────────────────

/**
 * 指针该处于哪个阶段(纯函数)。
 * @param {{moved?:number, held?:boolean}} st
 * @returns {'idle'|'scroll'|'drag'} idle=还没定性;scroll=这是滚动手势,别抢;drag=拖拽
 */
export function gearDragPhase(st) {
  const s = st || {};
  if (s.held) return 'drag';                      // 长按到位 → 无条件拖拽
  const moved = Number(s.moved) || 0;
  return moved > DRAG_MOVE_PX ? 'scroll' : 'idle';
}

/**
 * 拖拽落点 → 该做什么(纯函数,不写存档)。
 * 每件装备的槽位是唯一的,所以「槽位拖到别的槽位」永远是错配,
 * 不存在换装时的原子性问题 —— 不需要 unequip+equip 两步,也丢不了装备。
 * @param {{kind:'bag',id:string}|{kind:'slot',slot:string}} from
 * @param {{kind:'slot',slot:string}|{kind:'bag'}|{kind:'none'}|null} to
 * @returns {{kind:'equip'|'unequip'|'none', id?:string, slot?:string, why?:string}}
 */
export function gearDropAction(from, to) {
  if (!from || !to) return { kind: 'none', why: '没有落点' };
  if (from.kind === 'bag') {
    const g = GEAR[from.id];
    if (!g) return { kind: 'none', why: '不认识的装备' };
    if (to.kind !== 'slot') return { kind: 'none', why: '落点不是槽位' };
    if (to.slot !== g.slot) return { kind: 'none', why: `${g.name} 穿不了这个槽位` };
    return { kind: 'equip', id: from.id, slot: to.slot };
  }
  if (from.kind === 'slot') {
    if (!SLOT_KEYS.includes(from.slot)) return { kind: 'none', why: '不认识的槽位' };
    if (to.kind !== 'bag') return { kind: 'none', why: '槽位只能拖回背包' };
    return { kind: 'unequip', slot: from.slot };
  }
  return { kind: 'none', why: '来路不明' };
}

// ─────────────────────────────────────────────
// 拖拽会话:一次只允许一根手指,状态全在 DRAG 里
// ─────────────────────────────────────────────
const DRAG = {
  src: null, from: null, id: null,
  ox: 0, oy: 0, x: 0, y: 0, moved: 0,
  held: false, on: false, timer: 0, ghost: null,
};
let hookedHost = null;      // 委托挂在哪个节点上(重绘不换节点,所以只挂一次)
let hookedHall = null;
let suppressClick = false;  // 拖完要吃掉浏览器补发的那次 click

/** 事件挂在长期存在的容器上,与 render() 里 build() 挂委托是同一路子(委托挂在 bodyEl 上,重绘也不会丢)。
 *  挂容器而不是挂每个槽位/每个背包格子:重绘会换掉那些节点,挂上去就白挂。
 *  没有可用 DOM(部分冒烟门禁只给空壳 document)时静默跳过 —— 渲染照常,只是没有拖拽。 */
function ensureHook(hall) {
  try {
    const d = typeof document === 'undefined' ? null : document;
    if (!d) return;
    const host = (typeof d.querySelector === 'function' && d.querySelector('#xx-body')) || d.body || null;
    if (!host || typeof host.addEventListener !== 'function') return;
    hookedHall = hall;                       // 每次都刷新:hall 是壳,可能换实例
    if (hookedHost === host) return;
    hookedHost = host;
    const opt = { passive: false };          // 要 preventDefault,必须非被动
    host.addEventListener('pointerdown', onDown, opt);
    host.addEventListener('pointermove', onMove, opt);
    host.addEventListener('pointerup', onUp, opt);
    host.addEventListener('pointercancel', onCancel, opt);
    host.addEventListener('click', onClickGuard, true);   // 捕获阶段,拦在 ui.js 的委托之前
    if (typeof window !== 'undefined' && window.addEventListener)
      window.addEventListener('blur', abort);            // 切后台防拖拽卡死(同 joystick)
  } catch { /* 渲染照常,拖拽不可用 */ }
}

function slotsOnHost() {
  if (!hookedHost || typeof hookedHost.querySelectorAll !== 'function') return [];
  try { return [...hookedHost.querySelectorAll('.xx-gear-slot')]; } catch { return []; }
}

function hitAt(x, y) {
  const d = typeof document === 'undefined' ? null : document;
  if (!d || typeof d.elementFromPoint !== 'function') return null;
  try { return d.elementFromPoint(x, y); } catch { return null; }
}

/** 命中元素 → 落点描述 */
function targetAt(x, y) {
  const el = hitAt(x, y);
  const slot = el && el.closest ? el.closest('.xx-gear-slot') : null;
  if (slot) return { kind: 'slot', slot: slot.dataset.slot };
  const bag = el && el.closest ? el.closest('.xx-gear-bag') : null;
  if (bag) return { kind: 'bag' };
  return { kind: 'none' };
}

function onDown(e) {
  suppressClick = false;    // 上一轮拖拽留下的「吃掉下一次 click」到此为止,
                            // 否则拖完浏览器若没补发 click(正常情况),玩家下一次真点会被吞
  if (DRAG.src) return;                        // 已有会话 → 忽略第二根手指
  const el = e.target && e.target.closest ? e.target.closest('.xx-gear-item, .xx-gear-slot') : null;
  if (!el || !el.dataset) return;
  const from = el.dataset.gear ? { kind: 'bag', id: el.dataset.gear }
    : el.dataset.slot ? { kind: 'slot', slot: el.dataset.slot } : null;
  if (!from) return;
  DRAG.src = el; DRAG.from = from; DRAG.id = e.pointerId;
  DRAG.ox = e.clientX; DRAG.oy = e.clientY;
  DRAG.x = e.clientX; DRAG.y = e.clientY;
  DRAG.moved = 0; DRAG.held = false; DRAG.on = false;
  DRAG.timer = setTimeout(onHold, DRAG_HOLD_MS);
}

function onHold() {
  DRAG.timer = 0;
  if (!DRAG.src || DRAG.on) return;
  DRAG.held = true;
  startDrag();
}

function startDrag() {
  if (DRAG.on || !DRAG.from) return;
  DRAG.on = true;
  // 指针捕获:手指滑出原元素也要继续收到 move/up —— 触摸端必需
  try {
    if (DRAG.src && typeof DRAG.src.setPointerCapture === 'function') DRAG.src.setPointerCapture(DRAG.id);
  } catch { /* 桩 DOM 或浏览器拒绝捕获:靠 document 上的监听兜底 */ }
  const d = typeof document === 'undefined' ? null : document;
  if (d && typeof d.createElement === 'function') {
    const g = d.createElement('div');
    g.className = 'xx-gear-drag';
    g.innerHTML = ghostHtml(DRAG.from);
    DRAG.ghost = g;
    if (d.body && typeof d.body.appendChild === 'function') d.body.appendChild(g);
  }
  placeGhost();
}

function ghostHtml(from) {
  const id = from.kind === 'bag' ? from.id : ((Save.data.gear || {})[from.slot] || '');
  const g = GEAR[id];
  if (!g) return '';
  return `<div class="xx-gear-item-icon">${iconTag(GEAR_ICON(id), g.name)}</div>` +
         `<div class="xx-gear-item-name">${esc(g.name)}</div>`;
}

function placeGhost() {
  const g = DRAG.ghost;
  if (!g || !g.style) return;
  g.style.position = 'fixed';
  g.style.pointerEvents = 'none';    // 幽灵不许挡住 elementFromPoint 的命中判定
  g.style.left = Math.round(DRAG.x - GHOST_HALF) + 'px';
  g.style.top = Math.round(DRAG.y - GHOST_HALF) + 'px';
}

function onMove(e) {
  if (!DRAG.src || e.pointerId !== DRAG.id) return;
  DRAG.x = e.clientX; DRAG.y = e.clientY;
  DRAG.moved = Math.max(DRAG.moved, Math.hypot(e.clientX - DRAG.ox, e.clientY - DRAG.oy));
  const phase = gearDragPhase({ moved: DRAG.moved, held: DRAG.held });
  if (!DRAG.on) {
    if (phase === 'scroll') { clearPending(); return; }   // 玩家在滚背包,别抢
    if (phase !== 'drag') return;
    startDrag();
  }
  if (e.cancelable) e.preventDefault();     // 拖拽中不让页面跟着滚
  placeGhost();
  const act = gearDropAction(DRAG.from, targetAt(DRAG.x, DRAG.y));
  for (const s of slotsOnHost()) s.classList.toggle('drop-ok', act.kind === 'equip');
}

function onUp(e) {
  if (!DRAG.src || e.pointerId !== DRAG.id) return;
  // 落点看**抬手这一刻**的坐标,不是最后一次 move 的坐标:
  // 快速甩过来时浏览器会合并 move 事件,最后一帧 move 可能是几十像素前的位置,
  // 拿它判落点就会「明明拖到槽上了却什么都没发生」。
  DRAG.x = e.clientX; DRAG.y = e.clientY;
  if (!DRAG.on) { clearPending(); return; }              // 普通点击:什么都不做,交给 data-act
  const x = DRAG.x, y = DRAG.y;
  const from = DRAG.from;                               // endDrag 会清掉会话,先把来路取出来
  const dragged = DRAG.moved > DRAG_MOVE_PX;            // 进拖拽态后一次没动 → 当作取消
  endDrag();
  if (!dragged) return;                                 // 不拦 click:慢按的那一次点击照常生效
  suppressClick = true;                                 // 拖过了就别再补发一次点击
  applyDrop(from, x, y);
}

/** pointercancel:系统收走了手势(来电、通知、系统返回键)。收尾,一个字都不写。 */
function onCancel(e) {
  if (DRAG.src && e.pointerId !== DRAG.id) return;
  endDrag();
}

function applyDrop(from, x, y) {
  const act = gearDropAction(from, targetAt(x, y));
  if (act.kind === 'none') return;                      // 落在空白处/错槽位:什么都不做
  const hall = hookedHall;
  if (!hall) return;
  const r = act.kind === 'equip' ? hall.doGearOn(act.id) : hall.doGearOff(act.slot);
  if (r && r.ok && typeof hall.render === 'function') hall.render();
}

/** 拖完浏览器还会补发一次 click。不吃掉的话,「拖一次」会同时触发「点一下」。 */
function onClickGuard(e) {
  if (!suppressClick) return;
  suppressClick = false;
  if (e.stopPropagation) e.stopPropagation();
  if (e.preventDefault) e.preventDefault();
}

function endDrag() {
  if (DRAG.ghost && typeof DRAG.ghost.remove === 'function') DRAG.ghost.remove();
  DRAG.ghost = null;
  try {
    if (DRAG.src && typeof DRAG.src.releasePointerCapture === 'function' && DRAG.id !== null)
      DRAG.src.releasePointerCapture(DRAG.id);
  } catch { /* 元素已被重绘换掉 */ }
  for (const s of slotsOnHost()) s.classList.remove('drop-ok');
  clearPending();
  DRAG.on = false;
}

/** 只是点了一下,或者判定为滚动手势:清干净,把这次手势交还浏览器。 */
function clearPending() {
  if (DRAG.timer) clearTimeout(DRAG.timer);
  DRAG.timer = 0;
  DRAG.src = null; DRAG.from = null; DRAG.id = null;
  DRAG.moved = 0; DRAG.held = false;
}

const abort = () => endDrag();

// ─────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────

export function vGear(hall) {
  ensureHook(hall);
  const owned = (Save.data.gearOwned || []).filter(id => GEAR[id]);
  const worn = Save.data.gear || {};

  let h = `<div class="xx-gear">
    <div class="xx-card">
      <div class="xx-label">装 备</div>
      <div class="xx-dim" style="margin-top:5px">
        装备只从<b>支线结案</b>掉落,不会在砍杀局里刷出来 —— 拿到就是拿到了。
        ${owned.length ? `已得 <b style="color:var(--xx-gold)">${owned.length}/${GEAR_IDS.length}</b> 件。` : ''}
      </div>
    </div>`;

  // —— 已穿戴的四个槽:点一下脱下,也可以从这里拖回背包 ——
  h += `<div class="xx-label" style="margin:14px 0 6px">已 穿 戴</div>`;
  h += `<div class="xx-gear-slots">`;
  for (const slot of SLOT_KEYS) {
    const id = worn[slot];
    const g = id ? GEAR[id] : null;
    h += `<div class="xx-gear-slot" data-slot="${esc(slot)}"${g ? ` data-act="gear-off" data-v="${esc(slot)}"` : ''}${g ? ` title="${esc(titleOf(id))}"` : ''}>
      <div class="xx-gear-slot-icon">${iconTag(SLOT_ICON(slot), SLOT_NAME(slot))}</div>
      <div class="xx-gear-slot-name">${esc(SLOT_NAME(slot))}</div>
      ${g ? `<div class="xx-gear-slot-item">${esc(g.name)}</div>`
         : `<div class="xx-gear-slot-empty">空</div>`}
    </div>`;
  }
  h += `</div>`;

  // —— 背包:点一下直接穿到它自己的槽位,也可以拖过去 ——
  h += `<div class="xx-label" style="margin:14px 0 6px">背 包</div>`;
  h += `<div class="xx-gear-bag">`;
  for (const id of owned) {
    const g = GEAR[id];
    const on = worn[g.slot] === id;
    // 已穿着的那件不给 data-act:它已经在身上了,再点一下「穿」没有意义,
    // 卸下只走槽位那一条路(两个入口指向同一个动作,比点了没反应清楚)。
    h += `<div class="xx-gear-item rarity-${g.rarity}${on ? ' worn' : ''}" data-gear="${esc(id)}"${on ? '' : ` data-act="gear-on" data-v="${esc(id)}"`} title="${esc(titleOf(id))}">
      <div class="xx-gear-item-icon">${iconTag(GEAR_ICON(id), g.name)}</div>
      <div class="xx-gear-item-name">${esc(g.name)}</div>
    </div>`;
  }
  h += `</div>`;

  const msg = (typeof hall._gearMsg === 'string' && hall._gearMsg) ? esc(hall._gearMsg) + ' · ' : '';
  const tail = owned.length
    ? '点一下背包里的装备就穿上;点一下已穿的槽位就脱下。也可以按住不放再拖动 —— 拖到槽位是穿上,从槽位拖回背包是脱下。'
    : '背包里还没有装备。去「修仙阁 → 支线」了结一条支线,红嫁衣、姥姥的簪、白泽之爪……都在那儿等你。';
  h += `<div class="xx-gear-hint">${msg}${tail}</div>`;

  return h + `</div>`;
}

export function doGearOn(hall, id) {
  const r = Save.equip(id);
  if (!r.ok) return r;
  hall._gearMsg = r.replaced
    ? `换上了。${GEAR[id].name} 替下了 ${GEAR[r.replaced] ? GEAR[r.replaced].name : r.replaced}`
    : `穿上了 ${GEAR[id].name}`;
  return { ok:true, msg:hall._gearMsg };
}

export function doGearOff(hall, slot) {
  const r = Save.unequip(slot);
  if (r.ok) hall._gearMsg = '已脱下';
  return r;
}