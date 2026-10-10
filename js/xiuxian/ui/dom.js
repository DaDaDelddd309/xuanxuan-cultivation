// 修仙阁 · UI 共享 DOM 辅助 —— 工单 XX-AUDIT-005
//
// 为什么单独抽出来:
//   拆 ui.js 时,视图模块(如 ui/tomb.js)要用 `esc()` 转义、`toast()` 弹提示。
//   这两个原本是 ui.js 里的模块级私有函数。如果每个视图模块各自复制一份,
//   就正是这个文件历史上出过的四类事故之一(重复方法 188 行 / 重复 import 白屏)。
//   所以这里是**唯一一份**,ui.js 和所有视图模块都从这里 import。
//
// 搬的时候一个字没改,只加了 export —— 行为必须与拆分前逐字节一致。

export const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
export const pct = (a, b) => b > 0 ? Math.min(100, Math.max(0, a / b * 100)) : 0;
export const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function toast(msg) {
  let t = document.getElementById('xx-toast');
  if (!t) { t = $('div', 'xx-toast'); t.id = 'xx-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('on'));
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 1900);
}