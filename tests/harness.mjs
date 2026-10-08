// ===== 无头运行环境(Headless Harness)=====
// 用途:在**没有浏览器**的机器上跑真实的游戏代码。
//
// 为什么需要它:
//   这台机器是 Android PRoot,playwright 直接报 `Unsupported platform: android`,
//   所以 V0.98 之前"本地实测可玩性"这件事一直是空的 —— 单测能跑,但
//   「玩家真的动起来了吗」「一局能不能跑完」没人验证过。
//   而 V0.98 恰好在这一层翻车:7 个 js/game/*.js 的相对路径写错,
//   main.js 根本加载不了 —— 所有单测全绿,游戏是白屏。
//
// 这个文件提供最小 DOM + canvas 桩,让真实的 engine/player/enemies/…
// 能在 Node 里跑起来。**不模拟画面**,只驱动逻辑:
//   · 帧循环真的推进
//   · 输入真的改变移动
//   · 怪真的刷、真的被打死、真的掉宝石
//   · 灵伴真的跟着走、真的跑过去捡
//   · 结算真的跑得完
// 画布调用全部用 Proxy 记录,不校验像素 —— 像素校验需要真浏览器,那件事留给 CI。

const CALLS = Object.create(null);   // 画布调用统计,用来证明"确实画了东西"
let CALL_COUNT = 0;

function makeCtx() {
  const base = {
    canvas: null,
    // 会被读写的属性
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: true,
    globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '',
    lineCap: '', lineJoin: '', miterLimit: 10, filter: 'none',
  };
  // 这两个必须真的返回对象:精灵栅格化(raster)靠 createImageData().data
  // 逐像素写颜色,返回空函数的话 sprite 全是空的 —— 那是"看起来没崩、
  // 其实什么都没烘焙"的假通过。
  const imgData = (w, h) => ({
    data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    width: w, height: h, colorSpace: 'srgb',
  });
  base.createImageData = (w, h) => imgData(w | 0, h | 0);
  base.getImageData = (x, y, w, h) => imgData(w | 0, h | 0);
  base.measureText = t => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });

  const target = Object.assign(Object.create(null), base);
  return new Proxy(target, {
    get(t, k) {
      if (k === '__stats') return CALLS;
      if (k in t) return t[k];
      // 任何未显式定义的方法 → 空函数(记录调用)
      return function (...a) {
        CALL_COUNT++;
        CALLS[k] = (CALLS[k] || 0) + 1;
        return undefined;
      };
    },
    set(t, k, v) { t[k] = v; return true; },
    has() { return true; },
  });
}

function makeCanvas() {
  // 关键:同一个 canvas 多次 getContext('2d') 必须返回**同一个** ctx。
  // 真实浏览器就是这样(同一上下文重复取),而且引擎会缓存 ctx 复用。
  // 早先这里每次都 new 一个 Proxy,于是 engine.ctx !== canvas.getContext(),
  // 所有"主画布调用了没有"的统计全是假的 —— 白白查了两轮。
  let _ctx = null;
  const c = {
    width: 960, height: 640,
    style: {},
    getContext() { if (!_ctx) { _ctx = makeCtx(); _ctx.canvas = c; } return _ctx; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640, right: 960, bottom: 640 }),
  };
  return c;
}

const VOID = new Set(['img','input','br','hr','meta','link','source','area','base','col']);

/** 属性串 → {id, class, dataset, attrs} */
function parseAttrs(str) {
  const out = { id: '', class: '', dataset: {}, attrs: {} };
  const re = /([\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(str || ''))) {
    const k = m[1], v = m[3] ?? m[4] ?? m[5] ?? '';
    if (k === 'id') out.id = v;
    else if (k === 'class') out.class = v;
    else if (k.startsWith('data-')) out.dataset[k.slice(5)] = v;
    else out.attrs[k] = v;
  }
  return out;
}

/**
 * 极简 HTML → 元素树。
 * 只支持游戏实际用到的东西:嵌套标签、id/class/data-*、void 元素、文本。
 * 不处理 <script>/<style> 内容 —— 游戏的 innerHTML 里没有内联脚本。
 */
function parseHTML(html, rootEl) {
  const stack = [rootEl];
  const VOID_CLOSE = new RegExp(`^</(${[...VOID].join('|')})\\s*>$`, 'i');
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[0];
    if (m[3] !== undefined) {                       // 文本节点
      const t = m[3].trim();
      if (t) stack[stack.length - 1]._text = (stack[stack.length - 1]._text || '') + t;
      continue;
    }
    const tag = m[1], closing = raw.startsWith('</');
    if (closing) {
      if (VOID_CLOSE.test(raw)) continue;           // 自闭合标签没有对应闭合
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const a = parseAttrs(m[2]);
    const el = makeEl(tag);
    el.id = a.id;
    a.class.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
    Object.assign(el.dataset, a.dataset);
    el.attrs = a.attrs;
    if (VOID.has(tag.toLowerCase())) {
      stack[stack.length - 1].appendChild(el);
    } else {
      stack[stack.length - 1].appendChild(el);
      stack.push(el);
    }
  }
  return rootEl;
}

/** 极简 DOM:只实现游戏真正用到的那部分 */
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], _html: '', id: '', attrs: {},
    style: new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; }, get: (t, k) => t[k] }),
    dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); },
    },
    _listeners: {},
    // className 与 classList 必须同步:游戏里有两套写法
    // (\`el.className = 'xx-screen hidden'\` 和 classList.add)。
    // 只实现一套的话,另一种写出来的元素就永远查不到。
    get className() { return [...this.classList._s].join(' '); },
    set className(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get innerHTML() { return this._html; },
    // 关键:innerHTML 被赋值时真的建出子元素树,否则 querySelector('#xx-body') 永远找不到东西
    set innerHTML(v) { this._html = String(v); this.children = []; parseHTML(String(v), this); },
    get textContent() { return this._text || ''; },
    set textContent(v) { this._text = String(v); },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {},
    querySelector(sel) { const r = this.querySelectorAll(sel); return r[0] || null; },
    querySelectorAll(sel) {
      // 支持 #id / .class / [attr] / [attr="v"] / 逗号并列 —— 够游戏用了
      const parts = String(sel).split(',').map(s => s.trim()).filter(Boolean).map(comp => {
        let m;
        if ((m = comp.match(/^#(.+)$/)))        return { k: 'id', v: m[1] };
        if ((m = comp.match(/^\.(.+)$/)))       return { k: 'class', v: m[1] };
        if ((m = comp.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/)))
                                             return { k: 'attr', a: m[1], v: m[2] };
        return { k: 'tag', v: comp.toUpperCase() };
      });
      const hit = (el, c) => {
        // 树里可能混进非 makeEl 的节点(比如 canvas),对残缺节点要免疫
        if (!el) return false;
        if (c.k === 'id')    return el.id === c.v;
        if (c.k === 'class') return !!(el.classList && el.classList.contains(c.v));
        if (c.k === 'tag')   return el.tagName === c.v;
        // 属性:data-* 落在 dataset 上,其余落在 attrs 上
        if (c.a.startsWith('data-')) return c.v === undefined ? (c.a.slice(5) in el.dataset) : el.dataset[c.a.slice(5)] === c.v;
        return c.v === undefined ? (c.a in el.attrs) : el.attrs[c.a] === c.v;
      };
      const out = [];
      const walk = (n) => {
        for (const el of (n.children || [])) {
          if (parts.some(c => hit(el, c))) out.push(el);
          walk(el);
        }
      };
      walk(this);
      return out;
    },
    /** closest:从自己往上找匹配祖先 */
    closest(sel) {
      let n = this;
      while (n) { const r = n.querySelectorAll(sel); if (r.length && n !== this) return r[0];
                  if (n !== this && this._selfMatches && this._selfMatches(sel)) return this;
                  n = n.parentElement; }
      return null;
    },
    getElementsByTagName() { return []; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }),
    focus() {}, blur() {}, click() { this.dispatch('click', { target: this }); },
    dispatch(type, ev = {}) {
      const e = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, ev);
      (this._listeners[type] || []).forEach(f => f(e));
    },
    /** 沿树找所有匹配节点(测试用) */
    find(sel) { const one = this.querySelector(sel); return one ? [one] : []; },
    _findById(id) { return this.querySelector('#' + id); },
  };
  return el;
}

/**
 * 安装全局环境。必须在 import 任何游戏模块**之前**调用。
 * @param {object} [opts]
 */
export function install(opts = {}) {
  const doc = makeEl('#document');
  const app = makeEl('div'); app.id = 'app';
  doc.appendChild(app);
  const canvas = makeCanvas();
  doc.appendChild(canvas);

  // 预置 index.html 里那些会被 getElementById 找的元素
  const byId = { app, game: canvas };
  for (const id of ['btn-cult', 'hud-xx', 'hud-xx-ling', 'hud-xx-fire', 'hud-xx-buf',
                    'vignette', 'screens', 'joy', 'boss-bar', 'toast']) {
    if (!byId[id]) { const e = makeEl('div'); e.id = id; byId[id] = e; app.appendChild(e); }
  }

  const rafQueue = [];
  // 单一单调时钟。engine 内部用 performance.now() 算 dt,
  // 若时间源每帧重建就会算出 0 或负数,循环永远不推进。
  let T = 0;
  const win = {
    innerWidth: opts.width || 960,
    innerHeight: opts.height || 640,
    devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    performance: { now: () => T },
  };

  globalThis.window = win;
  globalThis.document = {
    ...doc,
    documentElement: makeEl('html'),
    body: makeEl('body'),
    getElementById: id => byId[id] || null,
    createElement: t => makeEl(t),
    // 走 doc 的真实实现 —— 早先这里写死成 () => null,
    // 结果修仙阁的界面节点一个都查不到,测试只能假通过。
    querySelector: sel => doc.querySelector(sel),
    querySelectorAll: sel => doc.querySelectorAll(sel),
    addEventListener() {}, removeEventListener() {},
    hidden: false,
  };
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.performance = win.performance;
  // main.js 会读 location.search(debug 开关)与 location.protocol(SW 注册判断)
  globalThis.location = { search: opts.search || '', protocol: 'http:', href: 'http://localhost/', host: 'localhost' };
  globalThis.location.reload = () => { reloads++; };
  let reloads = 0;
  // navigator 在新 Node 里是只读 getter,必须 defineProperty,直接赋值会 TypeError
  try { Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'headless', maxTouchPoints: 0 }, configurable: true, writable: true }); }
  catch { /* 老版本 Node 可直接赋值 */ globalThis.navigator = globalThis.navigator || { userAgent: 'headless' }; }
  globalThis.devicePixelRatio = 1;
  globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };
  globalThis.AudioContext = function () {
    return { createGain: () => ({ gain: { value: 1 }, connect() {} }), destination: {}, close() {} };
  };
  globalThis.Image = function () {
    this.width = 1; this.height = 1; this.onload = null; this.onerror = null;
    Object.defineProperty(this, 'src', {
      set() { /* 图片永远"加载失败":剪影兜底路径必须能活下来 */ },
      get() { return ''; },
    });
  };
  // localStorage
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    clear: () => mem.clear(),
    _mem: mem,
  };
  // Canvas 工厂(精灵栅格化要用)
  globalThis.OffscreenCanvas = function () { return makeCanvas(); };
  const origCreate = globalThis.document.createElement;
  globalThis.document.createElement = t => (t === 'canvas' ? makeCanvas() : origCreate(t));

  return {
    window: win, document: globalThis.document, canvas, app,
    localStorage: globalThis.localStorage,
    /** 推进 n 帧,返回总时长(秒)。dt 固定,避免依赖真实时间 */
    step(frames = 60, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) {
        T += dt * 1000;
        const q = rafQueue.splice(0, rafQueue.length);
        for (const fn of q) { try { fn(T); } catch (e) { e.__raf = true; throw e; } }
      }
      return frames * dt;
    },
    /** 当前虚拟时间(毫秒) */
    now: () => T,
    /** 手动灌一次输入帧(不推进物理),用于触发一次性逻辑 */
    tick: () => { const q = rafQueue.splice(0, rafQueue.length); q.forEach(fn => fn(T)); },
    stats: () => ({ CALL_COUNT, CALLS: { ...CALLS } }),
  };
}

export { makeEl, makeCanvas, makeCtx, parseHTML };