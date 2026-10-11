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
//
// ⚠️ 这里原来有一行 `const K = 'xx_nag_v096'` —— **死键**。
//   全仓只有它自己的声明出现过一次,没有任何读写点(save-integrity 审计
//   把这条登记成了已知缺陷:「该键名在本仓从未被读写,迁移/巡检表会误以为
//   它有存档」)。已删。
//
//   为什么它一直没人发现:NAGER 根本**不需要**持久化 ——
//   预算的语义写在文件头是「一局内」,但实际作用域是**每次页面加载**:
//   全仓唯一的 `NAGER.newRun()` 调用点在 `main.js` 的 `(function bootCult(){…})`
//   这个启动 IIFE 里,即开页跑一次,不是每局跑一次。见 TICKETS.md XX-QA-064。
//   键名是早期「打算跨局累计」那版设计的残留,方案没落地,常量留了下来。
//   这跟今天修的两处是同一个病:声明了、没接线、然后所有人以为它管用。

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
  // ⚠️ **作用域提醒**:全仓唯一的调用点在 `main.js` 的启动 IIFE
  //   `(function bootCult(){ … NAGER.newRun(); … })` 里 —— 也就是
  //   **每次页面加载重置一次,不是每局**。
  //   而本文件头写的语义是「一局内『打扰』次数有上限」——
  //   两者对不上:同一页里玩第二局时,额度已经是上一局剩下的残值。
  //   见 TICKETS.md XX-QA-064。本函数本身正确,错的是调用时机。
  //
  //   另外这里原来还挂过一个 window 'xx-run-start' 监听(文件下方,已删):
  //   那条事件**没有任何发射器**(全仓 `dispatchEvent` 出现 0 次),
  //   是一个永远不触发的复位入口。危害不在于它坏了,而在于它**看起来**
  //   在管复位 —— 读代码的人都会以为「预算会自己按局重置」,
  //   于是没人去核对真正那次调用在哪儿、作用域又是哪儿。
  //   同一个病:声明了、没接线、然后所有人以为它管用。
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
    staleBusy();                      // XX-QA-001(2):占位浮层已经没了就别再占着
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

// 每局开始重置预算 —— 由 `main.js` 的 `startRun` **直接调用** `NAGER.newRun()`。
//
// ⚠️ 这里原来是一个 window 'xx-run-start' 监听,已删。理由见 `newRun` 上方的注释:
//   那条事件**没有任何发射器**(全仓 `dispatchEvent` 出现 0 次),它是个永远不触发的复位入口。
//   真正管用的是 main.js 里那次直接调用 —— 删掉监听不会改变任何行为。
//   `tests/nag-budget-guard-regression.mjs` 现在有一条断言守着那个直接调用还在,
//   免得将来有人「清理」main.js 时顺手把它删了,而这里也已经没有监听兜底。

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

// ══ XX-QA-001(1):浮层的可点性 ══
// 宿主的样式是 `pointer-events:none`,而 **pointer-events 会被子元素继承**。
// .xx-ritual 当年踩过这个坑(XX-BUG-C),在 css/xiuxian.css 里补了 pointer-events:auto。
// 但叙事卡一族(showStoryBeat / askPath / askStoryPath / askTombWords …)没补 ——
// 于是卡片**看得见、点不动**:玩家点了「知道了」「其一」「其二」毫无反应,
// 选项全部穿透到下面的地图节点上。这不是观感问题,是点了没反应。
//
// 纯信息横幅 .xx-banner 本来就不该吃点击(它的 CSS 里就是 none),保持不变。
// 判据用**结构**而不是写死数值:卡里**有没有可点的动作**。
const INTERACTIVE = '[data-p],[data-w],[data-act],button,.xx-sc-x';
function interactive(el) {
  try { return !!(el && el.querySelector && el.querySelector(INTERACTIVE)); }
  catch { return false; }
}

// ══ XX-QA-001(2):「忙」这个标记原来只有计时器和点击能清 ══
// 浮层被**别的方式**弄掉时,_busy 就永远卡住 true:
//   · 仪式 Ritual.close() 是 classList.add('hidden'),不是 remove()
//   · 叙事卡 / tombEnding 自己的 setTimeout(()=>el.remove(), 9000) 直接摘节点
// 卡住的直接后果:之后每一个浮层都只进队列、不显示 ——
// 玩家看到的正是「走完支线却弹不出叙事卡 / 结不了案 / 看不到结局选择」。
// 判据:占位元素**还活着吗**(连着 DOM、没被 hidden、没被 display:none)。
function occupying(el) {
  if (!el) return false;
  if (el.isConnected === false) return false;
  if (el.classList && el.classList.contains('hidden')) return false;
  if (el.style && el.style.display === 'none') return false;
  return true;
}
function staleBusy() {
  if (!NAGER._busy) return false;
  if (occupying(NAGER._el)) return false;
  NAGER._busy = false;
  NAGER._el = null;
  NAGER._onRemove = null;
  return true;
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
    // ⚠️ 这里原来是 `const lv`。但下面第 194 行要为「必须决策」的卡片重新赋值
    //   (`lv = NAG.MUST`)—— 给 const 赋值会抛 TypeError。
    //   后果:凡是带 data-nag="must" 的卡片,append 到 #app 时当场抛异常,
    //   **元素永远不会被插入 DOM**,异常一路冒回点击处理器。
    //   也就是玩家点「了结」弹不出结局选择、点石将前的「补完」弹不出半句话 ——
    //   两个 P0 决策点直接卡死(t88 / t89 两条红就是它,不是测试写错)。
    //   这个 bug 从 4ba7e2f(V0.96 一体)就在,潜伏了整个 V0.96 周期。
    let lv = levelOf(el);
    // 非浮层(普通容器)照旧
    if (lv === NAG.HIGH && !/(xx-storycard|xx-banner|xx-ritual)/.test(el.className || '')) {
      return orig(el);
    }
    // 结局/补完半句话这类「必须决策」的标记
    if (el.dataset && el.dataset.nag === 'must') lv = NAG.MUST;

    // ⚠️ XX-QA-063:预算守卫原来写的是 `this.used >= this.budget`。
    //
    // 但这段在 app.appendChild 的包装函数里,`this` 是 **#app 这个 DOM 元素**,
    // 它身上没有 used / budget 两个属性 → 两边都是 undefined →
    // `undefined >= undefined` 是 false → **这个守卫从来没有生效过**。
    // NAGER 里 `budget: 4` / `used: 0` 一直都在(还有 left() / report() 两个
    // 读它的方法),只是没人读到 —— 于是本文件头写的
    // 「一局内『打扰』次数有上限(默认 4)」这条规则从 V0.96 至今一直是装饰。
    // (:61 和 :76 那两处的 this 是对的,它们在 NAGER 的方法里。只有这一处读错了对象。)
    //
    // MUST 永远豁免 —— 与 :61/:76 同一口径。结局卡、坐骑卡这些「必须决策」的,
    // 预算再紧也得放行,否则就是刚修过的那个 P0 换形态回来。
    if (lv < NAG.MUST && NAGER.used >= NAGER.budget) {
      // 额度用完,而且原来这里是 `return el` —— **静默丢弃**:
      // 玩家点了个东西、什么都没发生。这跟本项目铁律是同款毛病
      //(「度量/反馈自己出错比没有更危险」):一个看起来像坏了的交互,
      // 比多一条浮层糟糕得多。storycard 是**内容**,不是通知 ——
      // 因为玩家读得多就不让他看,是本末倒置。
      // 现在降级:直接挂在页面上,不排队、不占忙位、不自动消失。
      // 额度限制的是「打断」,不是「看得见」。
      if (interactive(el)) el.style.pointerEvents = 'auto';
      return orig(el);
    }
    if (lv >= NAG.MID) NAGER.used++;

    const h = host();
    if (!h) return orig(el);
    staleBusy();                      // XX-QA-001(2)
    // 队里还有别人、或者正忙 → 进队列
    if (NAGER._busy || NAGER._q.length) { NAGER._q.push({ el, level: lv }); NAGER._pump(); return el; }
    // XX-QA-001(1):宿主 pointer-events:none 会被继承下来,有可点动作的浮层必须自己拿回 auto
    if (interactive(el)) el.style.pointerEvents = 'auto';
    h.appendChild(el);
    NAGER._busy = true;
    NAGER._el = el;                  // XX-QA-001(2):记下占位者,staleBusy() 才有得判
    const dur = lv >= NAG.MUST ? 11000 : (lv === NAG.MID ? 4200 : 8000);
    const done = () => {
      clearTimeout(NAGER._timer);
      el.remove();
      NAGER._busy = false;
      NAGER._el = null;
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
  if (interactive(job.el)) job.el.style.pointerEvents = 'auto';   // XX-QA-001(1)
  h.appendChild(job.el);
  NAGER._busy = true;
  NAGER._el = job.el;               // XX-QA-001(2)
  const dur = job.level >= NAG.MUST ? 11000 : (job.level === NAG.MID ? 4200 : 8000);
  const done = () => {
    clearTimeout(NAGER._timer);
    job.el.remove();
    NAGER._el = null;
    NAGER._busy = false;
    setTimeout(() => NAGER._pump(), 320);
  };
  if (job.level >= NAG.MID) job.el.addEventListener('click', done, { once: true });
  NAGER._timer = setTimeout(done, dur);
}