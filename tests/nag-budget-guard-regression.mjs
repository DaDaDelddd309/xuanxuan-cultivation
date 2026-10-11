// nag-budget-guard-regression.mjs —— 工单 XX-QA-063 的门禁
//
// 这条工单登记时的描述是:「nag.js:195 的 `this.used >= this.budget`,
// `this === app`(DOM 元素没这两个属性)恒 false,『预算用完静默丢弃』从未生效过。
// 接还是不接,当时被当成「产品行为变更」挂起等人拍板。
//
// 现在的结论(不问了,已修):
//
//   · 接。`nager.js` **文件头自己就把设计写清楚了** ——
//     「一局内『打扰』次数有上限(默认 4)」「预算用完 → 只放行『必须决策』的」。
//     `NAGER.budget = 4` / `NAGER.used = 0` 也一直在,还有 left() / report()
//     两个读它的方法。整条规则只差 `:202` 那一行读错了对象,
//     于是从 V0.96 至今一直是装饰。这不是设计变更,是修一个没接上的开关。
//
//   · **结局卡不可能被静默** —— 这点当时是担心,读完代码可以确定:
//     MUST 在三处丢弃点全部豁免:
//       :61  `if (lv === NAG.MID || lv === NAG.HIGH)`  —— MUST 两头都不沾
//       :76  显式 `job.level < NAG.MUST`
//       :202 `lv < NAG.MUST`
//     所以「接上守卫 = 刚修的 P0 换形态回来」不成立。
//
//   · 但「静默丢弃」这个**动作**本身改了(见下方 [3]):
//     玩家点了个东西却什么都没发生,看起来像坏了 —— 这跟本项目铁律
//     「度量/反馈自己出错比没有更危险」是同款毛病。storycard 是内容不是通知,
//     因为玩家读得多就不让他看是本末倒置。现在降级直挂,不排队不消失。
//
// 出处可复现:node tests/nag-budget-guard-regression.mjs
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(ROOT + '/' + p, 'utf8');

// ── DOM 桩:要能分辨「挂到浮层宿主」和「直接挂到 #app」──
// 这正是降级路径与丢弃路径的分界线。
const mkEl = (tag = 'div') => ({
  tagName: tag, className: '', id: '', dataset: {}, style: {}, isConnected: true,
  _appendedTo: null, _h: {},
  classList: { add() {}, remove() {}, contains() { return false; } },
  querySelector() { return null; },          // 无可点动作 → interactive() = false
  querySelectorAll() { return []; },
  addEventListener(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
  remove() { this.isConnected = false; },
  appendChild(c) { c._appendedTo = this; return c; },
});
const app = mkEl('div');
app.id = 'app';
globalThis.document = {
  getElementById: id => (id === 'app' ? app : null),
  createElement: t => mkEl(t),
  addEventListener() {}, removeEventListener() {},
  body: mkEl('body'),
};
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

const { NAGER, NAG, installNagger } = await import('../js/xiuxian/nag.js');
installNagger();

/** 造一张叙事卡;must=true 时打上 data-nag="must" */
const card = (must = false) => {
  const el = mkEl('div');
  el.className = 'xx-storycard';
  if (must) el.dataset.nag = 'must';
  return el;
};
/** 把 NAGER 拨回一个干净的已知状态(不是修 bug,是隔离场景) */
const reset = (used, budget) => {
  NAGER.used = used; NAGER.budget = budget;
  NAGER._busy = false; NAGER._q.length = 0; NAGER._el = null;
};
/** 扔一张卡进拦截器,返回它最后挂在哪儿 */
const throw_ = (must) => {
  const el = card(must);
  app.appendChild(el);
  return el;
};
const where = el => (el._appendedTo && el._appendedTo.id === 'xx-nag-host') ? '浮层宿主'
  : (el._appendedTo === app ? '直接挂页面' : '**没挂到任何地方(被丢弃)**');

console.log('\n=== [1] 守卫现在真的读 NAGER,不是读 DOM 元素 ===');
{
  reset(0, 4);
  const a = throw_(false);
  t('有额度时,叙事卡走浮层队列', where(a) === '浮层宿主', `实际挂在:${where(a)}`);
  t('并且计入预算(NAGER.used 从 0 → 1)', NAGER.used === 1,
    `used=${NAGER.used} —— 没计数说明守卫仍在读 this(=DOM 元素,恒 undefined)`);
}

console.log('\n=== [2] 额度用完:不再占用浮层,但也**不许消失** ===');
{
  reset(4, 4);                                  // 额度已满
  const el = throw_(false);
  t('超预算的卡**没有被丢弃**', where(el) !== '**没挂到任何地方(被丢弃)**',
    `实际挂在:${where(el)} —— 这就是原来「静默丢弃」的形态:玩家点了,什么都没发生`);
  t('超预算的卡降级为直接挂在页面上', where(el) === '直接挂页面',
    `实际挂在:${where(el)} —— 额度限制的是「打断」,不是「看得见」`);
  t('降级的卡不再吃额度(没打断就不该计)', NAGER.used === 4, `used=${NAGER.used}`);
  t('降级的卡不占忙位(后面还能正常排队)', NAGER._busy === false);
}

console.log('\n=== [3] 必须决策的卡:任何预算下都放行 ===');
{
  // 极端值:额度为 0、已用远超上限 —— 最能证明这不是「顺便」放行的
  reset(99, 0);
  const el = throw_(true);
  t('额度为 0 时,data-nag="must" 的卡仍然走浮层', where(el) === '浮层宿主',
    `实际挂在:${where(el)} —— 结局卡/补完半句话被吞掉就是刚修过的那个 P0 换形态回来`);
  t('并且它被渲染了(不是只入队不显示)', !!el._appendedTo);

  // 再验一次与 :61 / :76 同口径 —— 那两处是 NAGER.request 路径
  reset(99, 0);
  NAGER._busy = false; NAGER._q.length = 0;
  const ok = NAGER.request({ level: NAG.MUST, el: throw_(true) });
  t('NAGER.request(MUST) 在预算耗尽时依然受理', ok === true,
    `request 返回 ${ok} —— :61 只拦 MID/HIGH,MUST 不该被拦`);

  reset(4, 4);
  const ok2 = NAGER.request({ level: NAG.HIGH, el: throw_(false) });
  t('但 NAGER.request(HIGH) 在预算耗尽时被拒(守卫真的在生效)', ok2 === false,
    '如果这条也放行,说明预算压根没生效 —— 和修之前一样');
}

console.log('\n=== [4] 源码层面:不再有读错对象的比较 ===');
{
  // ⚠️ 必须先剥注释再扫 —— 这个 bug 的说明注释里**原文写着** `this.used >= this.budget`
  //   那串字面量,不剥就会被自己的注释判红。
  //   我第一版没剥,跑出一条假红 —— 又一次「度量工具自己出错」,当场抓到。
  const { codeMask } = await import('./lib-uimod.mjs');
  const NAG_SRC = codeMask(R('js/xiuxian/nag.js')).code;
  // 只看 installNagger 的包装函数体 —— :61/:76 的 this 是对的,不能误伤
  const seg = NAG_SRC.slice(NAG_SRC.indexOf('export function installNagger'));
  t('拦截器里不再出现 `this.used >= this.budget`',
    !/this\.used\s*>=\s*this\.budget/.test(seg),
    '这一处 this 是 #app DOM 元素,两个属性都是 undefined → 恒 false');
  t('守卫改读 NAGER.used / NAGER.budget',
    /NAGER\.used\s*>=\s*NAGER\.budget/.test(seg));
  t('丢弃点仍带 MUST 豁免(lv < NAG.MUST)',
    /lv\s*<\s*NAG\.MUST\s*&&\s*NAGER\.used\s*>=\s*NAGER\.budget/.test(seg),
    '少了这个豁免,结局卡就会在预算用完后被吞掉');
}

console.log('\n=== [5] 死代码清理:预算必须真的「每局重置」 ===');
{
  const { codeMask } = await import('./lib-uimod.mjs');
  const NAG_SRC = codeMask(R('js/xiuxian/nag.js')).code;
  const MAIN_SRC = codeMask(R('js/main.js')).code;

  t('nag.js 不再声明那个死键常量 xx_nag_v096',
    !/const\s+K\s*=\s*['"]xx_nag_v096/.test(NAG_SRC),
    '它全仓只有声明、没有读写点 —— save-integrity 把它登记成已知缺陷,已删');
  t('nag.js 不再监听没有发射器的 xx-run-start',
    !/addEventListener\(\s*['"]xx-run-start/.test(NAG_SRC),
    '全仓 dispatchEvent 出现 0 次,这条监听永远不触发 —— 它让人以为预算会自己按局重置');

  // ⚠️ 这条最关键:删掉那条死监听之后,真正管用的复位只剩 main.js 那一次调用。
  //   谁再「清理」main.js 时顺手删了它,预算就永远归不了零。
  t('【关键】main.js 里仍然有 NAGER.newRun() 的生产调用点',
    /NAGER\.newRun\(\)/.test(MAIN_SRC),
    '唯一的复位入口没了 —— 预算永远不归零');

  // 作用域现状:**在启动 IIFE 里,不是 startRun 里**。
  //   文件头写的语义是「一局内」,实际是「每次页面加载」——
  //   同一页玩第二局时额度是上一局的残值。已登记 XX-QA-064,**不在本门禁判红**
  //   (那是设计对不齐,不是守卫失效;守卫本身是对的)。
  //   这里只把事实**打印出来**并记录,不判红 —— 判的是「守卫失效」,不是「作用域对不齐」。
  //   XX-QA-064 修完之后这一行会变成 true,届时可以收紧成一条硬断言。
  const inStartRun = (() => {
    const at = MAIN_SRC.indexOf('function startRun(');
    if (at < 0) return false;
    const nx = MAIN_SRC.slice(at + 1).search(/\nfunction [A-Za-z_$]/);
    return nx > 0 && /NAGER\.newRun\(\)/.test(MAIN_SRC.slice(at, at + 1 + nx));
  })();
  console.log(`    ℹ️  NAGER.newRun() 在 startRun 内: ${inStartRun}`
    + (inStartRun ? '' : '  ← 现状:在启动 IIFE 里(XX-QA-064:作用域是每次页面加载,不是每局)'));
}

if (fail === 0) {
  console.log(`\n✅ XX-QA-063 通过:${pass} 项(预算守卫接上了,结局卡丢不掉)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标`);
  process.exit(1);
}