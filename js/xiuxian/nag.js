// ===== 打扰预算 · 全局唯一的弹层调度 =====
// 问题(V0.96 之前):23 个各自为政的弹层入口,6 个 setInterval,
// 超时从 1.6 秒到 22 秒不等。没有任何一个地方知道
// 「这一局玩家已经被打扰几次了」。
// 结果:怨灵每 2 分钟附身一次、商人 90 秒来一次、奇遇 34% 触发、
//       初见妖、支线就绪、结局、坐骑…… 全都抢着弹。
//
// 现在:所有浮层走这一个队列。并且有硬预算 ——
//   · 同一时刻最多 1 个浮层(强制串行)
//   · 一局内「打扰」次数有上限(默认 4)
//   · 预算用完 → 只放行「必须决策」的(结局、补完半句话)
//   · 想插队 → 必须写明 reason:'decision',且不消耗预算
//
// 设计原则:
//   机制是玩家来玩的,不是来消耗玩家注意力的。
//   玩家一局该被打扰 2-3 次,不是 10 次。
const K = 'xx_nag_v096';

// 打扰等级
export const NAG = {
  SILENT: 0,   // 完全不弹(状态类)
  LOW: 1,      // 一闪而过(拾取提示)
  MID: 2,      // 横幅类,可错过
  HIGH: 3,     // 浮帖,要读
  MUST: 4,     // 必须决策 —— 不消耗预算,永远放行
};

const DUR = { [NAG.LOW]: 1600, [NAG.MID]: 4200, [NAG.HIGH]: 9000, [NAG.MUST]: 0 };

export const NAGER = {
  // 本局预算
  budget: 4,
  used: 0,
  // 跑动的局数(不进砍杀就不计)
  runs: 0,
  _q: [],
  _busy: false,
  _el: null,
  _onRemove: null,
  _timer: null,

  reset() { this.used = 0; this._q = []; this._busy = false; this._clear(); },
  newRun() { this.runs++; this.used = 0; this._q = []; this._clear(); },
  _clear() {
    clearTimeout(this._timer);
    if (this._el) { this._el.remove(); this._el = null; }
    this._onRemove = null;
    this._busy = false;
  },

  left() { return Math.max(0, this.budget - this.used); },

  // 申请一个浮层位
  // opt: { level, el, onClose, reason, force }
  request(opt) {
    const lv = opt.level ?? NAG.MID;
    // SILENT 不排也不计;LOW 排但不计
    if (lv === NAG.SILENT) return false;
    // 预算只算 MID / HIGH —— 这两档才是真的挡住玩家视野的。
    // LOW(一闪而过的拾取提示)不该挤占额度。
    if (lv === NAG.MID || lv === NAG.HIGH) {
      if (this.used >= this.budget) return false;   // 预算用完,静默丢弃
      this.used++;
    }
    this._q.push({ ...opt, level: lv });
    this._pump();
    return true;
  },

  _pump() {
    if (this._busy || !this._q.length) return;
    if (typeof mountQueued === 'function' && _host) { mountQueued(); return; }
    const job = this._q.shift();
    // 进队后预算可能已经被别的任务用完 → 非 MUST 的丢弃
    if (job.level < NAG.MUST && this.used >= this.budget) { this._pump(); return; }

    this._busy = true;
    if (job.el) {
      this._el = job.el;
      document.getElementById('app').appendChild(job.el);
    }
    this._onRemove = job.onClose || null;

    const dur = job.dur ?? DUR[job.level] ?? DUR[NAG.MID];
    const done = () => {
      clearTimeout(this._timer);
      if (this._el) this._el.remove();
      this._el = null; this._onRemove = null; this._busy = false;
      try { job.onClose && job.onClose(); } catch {}
      // 给一点间隔,避免两个浮层贴脸
      setTimeout(() => this._pump(), 350);
    };
    // 点击关闭
    if (job.el && job.level >= NAG.MID) job.el.addEventListener('click', done, { once: true });
    this._timer = setTimeout(done, dur);
  },

  // 调试:本局打扰情况
  report() { return { used:this.used, budget:this.budget, pending:this._q.length, runs:this.runs }; },
};

// 每局开始重置预算
if (typeof window !== 'undefined') {
  window.addEventListener('xx-run-start', () => NAGER.newRun());
}

// —— 统一拦截(V0.96)——
// ui.js / bond.js / duel.js 等一共 13 处直接 appendChild 到 #app。
// 与其逐个改(容易漏、容易改错),不如在挂载层拦一道:
//   · 同一时刻只允许一个浮层
//   · 非「必须决策」的浮层要过预算
// 原本各处自己 appendChild + 自己 setTimeout(remove) 的,
// 现在由这里统一排队和计时。
const HOST = 'xx-nag-host';
let _host = null;
function host() {
  if (!_host || !_host.isConnected) {
    const app = document.getElementById('app');
    if (!app) return null;
    _host = document.createElement('div');
    _host.id = HOST;
    _host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:84';
    app.appendChild(_host);
  }
  return _host;
}

// 浮层类名 → 打扰等级
const LEVEL = [
  [/xx-storycard.*legend|xx-banner/, NAG.MID],
  [/xx-storycard/, NAG.HIGH],
  [/xx-ritual/, NAG.MUST],
];
function levelOf(el) {
  const c = el.className || '';
  if (/xx-ritual/.test(c)) return NAG.MUST;
  for (const [re, lv] of LEVEL) if (re.test(c)) return lv;
  return NAG.HIGH;
}

// 装上拦截:包一层 appendChild
export function installNagger() {
  if (typeof document === 'undefined') return;
  const app = document.getElementById('app');
  if (!app || app.__nagged) return;
  app.__nagged = true;
  const orig = app.appendChild.bind(app);
  app.appendChild = function (el) {
    const lv = levelOf(el);
    // 非浮层(普通容器)照旧
    if (lv === NAG.HIGH && !/(xx-storycard|xx-banner|xx-ritual)/.test(el.className || '')) {
      return orig(el);
    }
    // 结局/补完半句话这类「必须决策」的标记
    if (el.dataset && el.dataset.nag === 'must') lv = NAG.MUST;
    if (lv < NAG.MUST && this.used >= this.budget) return el;   // 静默丢弃
    if (lv >= NAG.MID) NAGER.used++;

    const h = host();
    if (!h) return orig(el);
    // 队里还有别人、或者正忙 → 进队列
    if (NAGER._busy || NAGER._q.length) { NAGER._q.push({ el, level: lv }); NAGER._pump(); return el; }
    h.appendChild(el);
    NAGER._busy = true;
    const dur = lv >= NAG.MUST ? 11000 : (lv === NAG.MID ? 4200 : 8000);
    const done = () => {
      clearTimeout(NAGER._timer);
      el.remove();
      NAGER._busy = false;
      setTimeout(() => NAGER._pump(), 320);
    };
    if (lv >= NAG.MID) el.addEventListener('click', done, { once: true });
    NAGER._timer = setTimeout(done, dur);
    return el;
  };
}

// 队列项的挂载(供 _pump 用)
export function mountQueued() {
  const job = NAGER._q.shift();
  if (!job) return;
  const h = host();
  if (!h) return;
  h.appendChild(job.el);
  NAGER._busy = true;
  const dur = job.level >= NAG.MUST ? 11000 : (job.level === NAG.MID ? 4200 : 8000);
  const done = () => {
    clearTimeout(NAGER._timer);
    job.el.remove();
    NAGER._busy = false;
    setTimeout(() => NAGER._pump(), 320);
  };
  if (job.level >= NAG.MID) job.el.addEventListener('click', done, { once: true });
  NAGER._timer = setTimeout(done, dur);
}