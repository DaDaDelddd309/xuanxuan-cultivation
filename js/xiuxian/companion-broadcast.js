// ===== 局内广播条 · 灵伴说话(XX-COMPANION-003)=====
//
// 为什么要它:
//   原来的灵伴说话方式是**弹窗**(`Bond.bubble`)—— 在砍杀游戏中途
//   弹出一个遮视线的框,玩家正盯着弹幕呢,突然视野被挡。
//   审计与玩家反馈都指向这一点:突兀、妨碍视野。
//
// 改成什么:
//   顶部**滚动字幕**(游戏广播条)。不弹窗、不遮视野、不打断操作。
//   说完**停留不立即消失**,等下一轮说话时把上一条慢慢推上去。
//   永远保留 **2 行**:第 1 行是正在说的(高亮),第 2 行是刚说完的(淡出)。
//   名字带颜色,和正文明确区分 —— 否则「谁在说话」要看半天。
//
// 与既有规则的关系(不能破坏):
//   `companion.js` 的「每局 ≤2 句、由本局表现触发」**原样保留**。
//   本文件只负责**怎么显示**,不负责**说什么**。
// ⚠️ esc 在本仓库被**复制了 4 份**(bond.js / duel.js / ui.js / …),
//   技术债 P2-2 记过。这里**故意再抄一份**,而不是 import 一个还不存在的
//   `ui-esc.js` —— 凭空造依赖比抄一份更糟。
//   待办:抽 `js/core/esc.js` 统一,四处一并改(见 TICKETS XX-AUDIT-023)。
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MAX_LINES = 2;          // 永远保留 2 行
const DWELL_MS = 4200;        // 说完停留多久(不立即消失)
const PUSH_MS = 520;          // 换行推挤动画时长

let root = null, cur = null, prev = null, timer = null;

function ensure() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'cc-broadcast';
  root.className = 'cc-bc';
  root.setAttribute('aria-live', 'polite');   // 读屏能播报
  // 挂在 hud 顶部容器里 —— 与血条同排,不额外占垂直空间
  const hudTop = document.querySelector('.hud-top');
  (hudTop || document.body).appendChild(root);
  return root;
}

/**
 * 说一句话
 * @param {string} who   说话人(灵伴名,已由调用方决定颜色)
 * @param {string} text  正文
 * @param {object} opt   { color, verb } verb = 动作/事件词(高亮),可选
 */
export function say(who, text, opt = {}) {
  if (!who || !text) return;
  const el = ensure();
  clearTimeout(timer);

  // 上一条「正在说的」降级成「刚说完的」
  if (cur) {
    cur.classList.remove('cc-bc-line-now');
    cur.classList.add('cc-bc-line-prev');
    prev = cur;
  }

  const line = document.createElement('div');
  line.className = 'cc-bc-line cc-bc-line-now';
  const color = opt.color || 'var(--cc-name)';
  line.innerHTML =
    `<b class="cc-bc-name" style="color:${color}">${esc(who)}</b>` +
    (opt.verb ? `<i class="cc-bc-verb">${esc(opt.verb)}</i>` : '') +
    `<span class="cc-bc-text">${esc(text)}</span>`;
  el.appendChild(line);

  // 只保留 2 行:多出来的从顶部移除
  while (el.children.length > MAX_LINES) el.removeChild(el.firstChild);

  // 入场:从下方轻微上浮 + 淡入(不闪烁)
  requestAnimationFrame(() => line.classList.add('cc-bc-in'));

  cur = line;

  // 停留,不立即消失 —— 等下一轮说话把它推上去
  timer = setTimeout(() => {
    if (cur === line) line.classList.remove('cc-bc-in');
  }, DWELL_MS);
}

/** 开局清场 —— 跨局残留的修复点(XX-AUDIT-031) */
export function clearBroadcast() {
  clearTimeout(timer);
  if (root) root.innerHTML = '';
  cur = null; prev = null;
}

/**
 * 手动收起/展开。
 *
 * ⚠️ 原注释写「HUD 隐藏时一并收起，避免残留」—— **那句是错的**。
 *    root 挂在 `.hud-top` 里、`.hud-top` 在 `#hud` 里,
 *    而 `css/style.css:52` 是 `.hidden { display:none !important }` ——
 *    HUD 一藏,广播条跟着一起没了,**根本不需要这个函数**。
 *    真正的残留问题不是「没藏」,是「跨局留着」(已由 clearBroadcast 修)。
 *
 *    目前产品侧无人调用(只有测试在调)。留着是因为「进结算层时手动收起」
 *    是个合理需求,但**不要为了让它有意义而去调用它** ——
 *    那是为函数找场景,不是为场景找函数。
 */
export function setVisible(on) {
  if (root) root.classList.toggle('cc-bc-hidden', !on);
}