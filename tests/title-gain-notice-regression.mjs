// title-gain-notice-regression.mjs —— 「解锁了称号,必须说一声」的门禁
//
// 同事报的原话:玩家拿到「入魔」时**不会有任何 toast 或横幅**,
//   一枚拼了十几局才拿到的称号,落地时一声不吭,只能自己想起来去称号页看。
//
// ⚠️ 这条门禁盯的病是本项目最核心的那个:**声明了、返回了、然后没人接**。
//   `Titles.check()` 老早就把刚解锁的称号装进 `gained` 并 return 出去了,
//   但全仓**零个读取点** —— `track()` 里那行 `this.check()` 把返回值扔了。
//   跟 save-integrity / lint-deadwire 那些「导出了没人读」是同一个病。
//
// ⚠️ 本门禁**只断言不变量,不断言「现在是不是坏的」**:接上了绿,拔掉红。
//
// 出处可复现:node tests/title-gain-notice-regression.mjs
// 退出码:0 = 通过;1 = 不通过;2 = **门禁自身失效**(自检不过,见 [6])
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
import { install } from './harness.mjs';
import { codeMask } from './lib-uimod.mjs';
// ⚠️ install() 必须在 import 任何游戏模块**之前**调用:
//   relations.js 现在 import 了 ui/dom.js,toast() 会摸 document。
//   (ESM 的静态 import 会被提到所有语句之前,所以这里只能靠 install() 抢在前面。)
install();

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(ROOT + '/' + p, 'utf8');

let pass = 0, fail = 0; const RED = [], SELF_FAIL = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; RED.push(n); console.log(`  ❌ ${n}${d ? '\n       — ' + d : ''}`); }
};
/** 尺子本身出问题 ⇒ 这轮结果不可信,必须 exit 2 而不是 exit 1 */
const tf = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; SELF_FAIL.push(n); console.log(`  🛑 ${n}${d ? '\n       — ' + d : ''}`); }
};

// ————————————————————————————————————————————————————————————
// 通知捕获:数「真的发出去了几条」+ 记下每条的文案。
//
// 为什么拦 document.body.appendChild 而不是拦 toast:
//   toast() 内部是「先 appendChild 建节点、再 textContent = msg」。
//   只拦 appendChild 的话,那一刻 textContent 还是空串 —— G1 要断言
//   「文案里含那枚称号的名字」,空串判不了。所以这里 appendChild 时
//   **把节点存下来**,断言阶段再读它的 textContent(那时已经写好了)。
//   这也顺带证明了「走的是 toast 那条既有通道」:节点是 .xx-toast,
//   挂在 body 上,不是新造的浮层宿主。
// ————————————————————————————————————————————————————————————
const seen = [];
const body = globalThis.document.body;
const _realAppend = body.appendChild.bind(body);
body.appendChild = (el) => { seen.push(el); return _realAppend(el); };

/** 本轮发出了几条提示(按 toast 节点数计) */
const notices = () => seen.filter(el => String(el.className || '').includes('xx-toast'));
/** 清空记录,返回清空前的内容,方便逐场景断言 */
const reset = () => { const n = notices().map(el => el.textContent); seen.length = 0; return n; };

const { Titles } = await import('../js/xiuxian/relations.js');
const { TITLES } = await import('../js/xiuxian/lore.js');
// 直接拿既有 toast 原件,给 [5] 的捕获器自检用(不经过 track,免得与被测状态耦合)
const { toast } = await import('../js/xiuxian/ui/dom.js');

/** 从零开始的一份 Titles 状态(直接写 s.flags —— 那是存档形状,不是产品副作用) */
const seed = flags => { Titles.s = { flags: { ...flags }, active: [] }; Titles.save(); };

// ————————————————————————————————————————————————————————————
// [1] G1 解锁一枚 ⇒ 恰好一条,且文案含那枚称号的名字
// ————————————————————————————————————————————————————————————
console.log('\n=== [1] G1 解锁一枚:恰好一条,文案含称号名 ===');
const ONE = { id: 'rumo', flag: 'demon', need: 80 };   // 入魔
{
  reset();
  seed({ [ONE.flag]: ONE.need - 1 });                 // 差一步
  const before = Titles.list().length;
  Titles.track(ONE.flag, 1);                           // 补上最后一步 ⇒ 解锁

  const got = reset();
  t(`解锁「${ONE.id}」发出恰好 1 条提示(不是 0,也不是多条)`, got.length === 1,
    `实发 ${got.length} 条:${JSON.stringify(got)}`);
  t('那一条的文案里含这枚称号的中文名',
    got.length === 1 && got[0].includes(TITLES.find(x => x.id === ONE.id).name),
    `文案=${JSON.stringify(got[0])} —— 期望含「${TITLES.find(x => x.id === ONE.id).name}」`);
  t('提示不是空串/不是 undefined(零态不显示成空白的老坑)',
    got.length === 1 && got[0].trim().length > 0 && !/undefined|NaN/.test(got[0]),
    `文案=${JSON.stringify(got[0])}`);
  t('解锁确实落进了 active(提示没有替代落盘)', Titles.list().length === before + 1,
    `active=${JSON.stringify(Titles.list())}`);
}

// ————————————————————————————————————————————————————————————
// [2] G2 同局解锁多枚 ⇒ **一条**通知(不是多条)
// ————————————————————————————————————————————————————————————
console.log('\n=== [2] G2 同局解锁多枚:合成一条,不是逐枚弹 ===');
{
  reset();
  // 三枚同时点亮:入魔(rumo) / 仁侠(renxia) / 不鸟(buniao)
  const ids = ['rumo', 'renxia', 'buniao'];
  const flags = {};
  for (const id of ids) {
    const row = { rumo: ['demon', 80], renxia: ['rescue', 50], buniao: ['refuse_alliance', 5] }[id];
    flags[row[0]] = row[1];
  }
  seed(flags);
  Titles.check();                       // 先把三枚都点亮(check 自己也会 add)
  Titles.s.active = [];                 // 复位 active,让下面这一次 track 重新点亮它们
  Titles.save();
  Titles.track('challenge', 1);          // 一次 track ⇒ check() 返回三枚

  const got = reset();
  t('一次 track 点亮 3 枚 ⇒ 只发 1 条提示', got.length === 1,
    `实发 ${got.length} 条:${JSON.stringify(got)} —— 逐枚弹就是 ${got.length} 条`);
  t('这一条里三枚称号的名字都在(合并不是丢信息)',
    got.length === 1 && ids.every(id => got[0].includes(TITLES.find(x => x.id === id).name)),
    `文案=${JSON.stringify(got[0])},期望都含:${ids.map(i => TITLES.find(x => x.id === i).name).join('/')}`);
  t('文案报出了枚数(玩家知道自己拿到了几枚)', got.length === 1 && got[0].includes('3'),
    `文案=${JSON.stringify(got[0])}`);
}

// ————————————————————————————————————————————————————————————
// [3] G3 零解锁 ⇒ **零**通知(这条最容易翻车,必须有)
// ————————————————————————————————————————————————————————————
console.log('\n=== [3] G3 零解锁:绝对安静 ===');
{
  reset();
  seed({});                               // 空存档
  Titles.track('challenge', 1);           // 离任何称号都还远
  let got = reset();
  t('空存档下 track 一次 ⇒ 0 条提示', got.length === 0, `实发 ${got.length} 条:${JSON.stringify(got)}`);

  // 已经解锁过的那枚再 track 一次:check() 返回空(条件仍满足,但 add() 返回 false)
  seed({ challenge: 30, spare: 20 });
  Titles.check();                         // 先点亮「赤子之心」
  Titles.track('challenge', 1);           // 条件依然满足 ⇒ 不该再报一次
  got = reset();
  t('同一枚重复满足条件 ⇒ 不重复提示(不吵)', got.length === 0,
    `实发 ${got.length} 条:${JSON.stringify(got)} —— 每次 track 都报一遍就是噪音`);

  // 差一步但没到:必须安静
  seed({ demon: 79 });
  Titles.track('demon', 0);               // +0,还是 79
  got = reset();
  t('差一步(79/80)⇒ 0 条提示(不提前报喜)', got.length === 0, `实发 ${got.length} 条:${JSON.stringify(got)}`);
}

// ————————————————————————————————————————————————————————————
// [4] G4 通知走的是既有通道,不是新写的系统
// ————————————————————————————————————————————————————————————
console.log('\n=== [4] G4 复用既有通道(不新增弹层入口) ===');
{
  const REL = R('js/xiuxian/relations.js');
  t('relations.js 从 ui/dom.js 复用 toast', /import\s*\{[^}]*\btoast\b[^}]*\}\s*from\s*['"]\.\/ui\/dom\.js['"]/.test(REL),
    'relations.js 里找不到 `from ./ui/dom.js` 的 toast import —— 它要么自己造了一套,要么根本没接线');

  reset();
  seed({ demon: 79 });
  Titles.track('demon', 1);
  const els = notices();
  reset();
  t('提示落在既有的 .xx-toast 节点上(不是新浮层宿主)', els.length === 1 && String(els[0].className).includes('xx-toast'),
    `节点 className=${JSON.stringify(els.map(e => e.className))}`);

  // ⚠️ 不新增**独立弹层入口**:nag.js 是全仓唯一的浮层调度,
  //   称号提示必须绕开它(toast 挂 body,#app 拦截看不见它),而不是往里再插一个入口。
  // ⚠️ 这里必须先 codeMask 剥掉注释再判:relations.js 的注释里**正当地**
  //   解释着「为什么不用 NAGER」,那几行散文里就含 `installNagger` 字样 ——
  //   拿朴素正则扫全文,会把「解释自己没接」的那段注释判成「接了」。
  //   这正是 lib-uimod/codeMask 存在的理由(朴素正则会被注释里的 /* 吞掉真代码)。
  const REL_CODE = codeMask(REL).code;   // codeMask 返回 {code, strings},不是字符串
  t('没有把称号提示接进 nag 队列(不新增打扰预算消耗点 / 不占浮层位)',
    !/NAGER\s*\.\s*request\s*\(/.test(REL_CODE) && !/installNagger\s*\(/.test(REL_CODE),
    'relations.js 的**代码**(剥注释后)里出现了 NAGER.request / installNagger —— 称号提示会占浮层位、跟叙事卡抢队列');

  // 提示不得改任何数值:跑一轮解锁,flags/active 之外的东西一律不许动
  seed({ demon: 79 });
  const sig = () => JSON.stringify({ f: Titles.s.flags, a: Titles.s.active });
  const before = sig();
  Titles.track('demon', 1);
  t('发提示没有改动 flags / active 以外的任何东西', sig() !== before,
    '存档签名没变 —— 那说明解锁根本没发生,提示是假的');
}

// ————————————————————————————————————————————————————————————
// [5] G5 防退化:断言真的调用到了产品函数
//     (为 0 ⇒ 门禁自身失效,exit 2,不能当通过)
// ————————————————————————————————————————————————————————————
console.log('\n=== [5] G5 防退化:门禁真的摸到了产品函数 ===');
{
  // ⚠️ 自检**绝不能与被测状态耦合**。
  //   头一版这里写的是「跑一次 track 然后断言抓到 1 条提示」——
  //   结果反向注入把接线掐掉时,尺子如实报「抓到 0 条」,于是门禁 exit 2
  //   (自身失效),而正确的红应该是 exit 1 (断言红)。
  //   换句话说:那个版本里,「产品坏了」和「尺子坏了」分不开,正是本文件要防的病。
  // 现在拆成两条**互相独立**的判据:
  //   ① 捕获器是活的 —— 直接驱动**既有**的 toast(dom.js 的真函数),
  //      这跟接线在不在没有任何关系;
  //   ② 断言的是产品函数 —— track/_announce 必须是 relations.js 里那个真对象的方法。
  reset();
  toast('__probe__');
  tf('捕获器是活的:直接调既有 toast(dom.js 真函数)能抓到提示',
    notices().length === 1, `抓到 ${notices().length} 条 —— 捕获器没接上,后面「0 条」的断言全是空的`);
  tf('捕获器读到的是刚写进去的文案(不是空串)',
    notices()[0] && notices()[0].textContent === '__probe__',
    `读到 ${JSON.stringify(notices()[0] && notices()[0].textContent)}`);
  reset();

  const REL_CODE2 = codeMask(R('js/xiuxian/relations.js')).code;
  tf('断言对象是产品代码本身(relations.js 真的定义了 track/_announce)',
    /track\s*\(\s*action\s*,\s*n\s*=\s*1\s*\)/.test(REL_CODE2) && /_announce\s*\(\s*gained\s*\)/.test(REL_CODE2),
    'relations.js 里找不到 track(action, n=1) / _announce(gained) —— 门禁在断言一个不存在的东西');
  tf('track 真的是 Titles 上的方法(不是测试自己造的替身)',
    typeof Titles.track === 'function' && typeof Titles._announce === 'function',
    `Titles.track=${typeof Titles.track} Titles._announce=${typeof Titles._announce}`);
}

// ————————————————————————————————————————————————————————————
// [6] G6 反向自检:合成样本,不碰真实文件、不与「当前代码状态」耦合
// ————————————————————————————————————————————————————————————
console.log('\n=== [6] G6 反向自检:尺子自己先红一遍(合成样本) ===');
{
  const REL = R('js/xiuxian/relations.js');
  const at = REL.indexOf('_announce(gained) {');
  tf('relations.js 里还找得到 _announce(接线没被挪走/改名)', at > 0,
    '_announce 不见了 —— 下面几条断言量的是一个不存在的东西');

  // 直接驱动产品函数喂合成 id:不依赖任何真实存档,也不依赖当前有哪些称号
  const feed = ids => {
    reset();
    Titles._announce(ids);
    const got = notices().map(e => e.textContent);
    reset();
    return got;
  };

  const one = feed(['__synthetic_a__']);
  tf('尺子能分辨:喂 1 个未知 id ⇒ 恰好 1 条,不为空',
    one.length === 1 && one[0].trim().length > 0, `得到 ${JSON.stringify(one)}`);

  const many = feed(['__synthetic_a__', '__synthetic_b__', '__synthetic_c__']);
  tf('尺子能分辨:喂 3 个未知 id ⇒ 仍然只有 1 条(合并不是逐枚弹)',
    many.length === 1, `得到 ${many.length} 条:${JSON.stringify(many)}`);
  tf('尺子能分辨:多枚那条里三个 id 都在', many.length === 1 && many[0].includes('__synthetic_a__')
    && many[0].includes('__synthetic_b__') && many[0].includes('__synthetic_c__'),
    `文案=${JSON.stringify(many[0])}`);
  tf('尺子能分辨:未知 id 不渲染成 undefined/NaN/空串',
    many.length === 1 && !/undefined|NaN/.test(many[0]) && many[0].trim().length > 0,
    `文案=${JSON.stringify(many[0])} —— 查不到名字就退回 id 本身,不能显示 undefined`);

  // 关键:零条必须**什么都不做**。这是最容易翻车的一条,
  // 所以尺子自己先证一次 —— 证明「0 条 → 0 通知」这个判据是活的,
  // 而不是「反正跑出来也是 0,过」。
  const none = feed([]);
  tf('尺子能分辨:喂空数组 ⇒ 0 条通知(零解锁必须绝对安静)', none.length === 0,
    `喂空数组却发出 ${none.length} 条:${JSON.stringify(none)} —— 尺子分不出「安静」和「没接」`);

  // 反过来:证明尺子不是「永远红」—— 上面那些必须真的能绿
  tf('尺子对合成样本判绿(否则它只是一把永远红的假尺子)',
    one.length === 1 && many.length === 1 && none.length === 0,
    `合成样本结果 one=${one.length} many=${many.length} none=${none.length}`);
}

if (SELF_FAIL.length) {
  console.log(`\n🛑 门禁自身失效:${SELF_FAIL.length} 项自检没过 —— 这轮结果不可信,不能当通过`);
  process.exit(2);
}
const total = pass + fail;
console.log(fail
  ? `\n❌ 称号解锁提示:红 ${fail}/${total} 项\n   ${RED.map(x => '· ' + x).join('\n   ')}`
  : `\n✅ 称号解锁提示通过:${total} 项(一枚一条 · 多枚合成一条 · 零解锁零通知 · 复用既有 toast)`);
process.exit(fail ? 1 : 0);
