// XX-FEEDN · 修仙阁全页渲染冒烟 —— 挡住「拆分重构漏声明」这一整类
//
// 起因（2026-10-12，外部审计乱点 58 个元素才碰到）：
//   `js/xiuxian/ui.js` 拆成 `js/xiuxian/ui/` 时，`let feedN = 1`（投石数量）
//   留在了 **ui.js**，而用它的是 **ui/arts.js 的 vCamp** —— 两个不同的模块。
//   模板里 `${feedN}` 于是是自由变量 → `ReferenceError: feedN is not defined`。
//   触发条件特别阴：两处都在 `burning ? … : …` 里，
//   所以**篝火一点着，整张营地页渲染就崩** —— 不是点错按钮，是页都开不出来。
//
// 为什么现有的 lint 拦不住（结构性的，不是没写这条）：
//   · `lint-syntax` 只问「能不能解析」—— `投 ${feedN}` 语法完全合法
//   · `lint-methods` 只问「拆出去的每个方法，Hall 上还有没有同名壳」—— 有壳，且调用得通
//   · `lint-imports` 只查 import 戳 —— 这里根本没有 import
//   自由变量**只在运行时、且只在那个分支被执行到时**才炸。
//   前十一轮「只点正确按钮」的全绿状态碰不到它。
//
// 为什么用运行时冒烟而不是静态自由变量检查：
//   我先写了一个正则版（扫模板里的 `${…}` 找未声明标识符），**230 条假阳性** ——
//   正则做不了 JS 作用域分析。而本项目铁律是「度量工具自己出错比没有度量工具更危险」，
//   宁可漏报不可误报，所以那个版本**直接丢弃**，改成现在这个:
//     真调、真执行、崩了就是崩了。**零假阳性。**
//
// 覆盖方式:每个视图 × 三种状态都渲染一遍。
//   之所以要多状态:XX-FEEDN 就藏在「生着火」这一个分支里,
//   只跑默认状态等于没测。

globalThis.document = { addEventListener(){}, createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}), body:{appendChild(){}}, getElementById:()=>null };
globalThis.window = { addEventListener(){} };
globalThis.Audio = function(){ this.play=()=>Promise.resolve(); this.pause=()=>{}; };
const store = {}; globalThis.localStorage = { getItem:k=>store[k]??null, setItem:(k,v)=>store[k]=v, removeItem:k=>delete store[k] };

const { Cult } = await import('../js/xiuxian/index.js');
const { CAMP } = await import('../js/xiuxian/camp.js');
const { Bag } = await import('../js/xiuxian/items.js');

let fails = 0;
const ok = (n, c, extra = '') => {
  if (!c) fails++;
  console.log(`  ${c ? '✅' : '❌'} ${n}${extra ? ` — ${extra}` : ''}`);
};

const VIEWS = [
  ['arts',   'vArts'],   ['arts',   'vCamp'],
  ['bag',    'vBag'],    ['build',  'vBuild'],
  ['dexsys', 'vDex'],    ['dexsys', 'vSys'],
  ['fam',    'vFam'],    ['gear',   'vGear'],
  ['meta',   'vMarket'], ['meta',   'vCraft'], ['meta', 'vTavern'],
  ['realm',  'vRealm'],  ['story',  'vQuest'],
  ['title',  'vTitle'],
];

/** hall 在这些视图里只当壳用（调用它的方法拿返回值），给个万能代理。 */
const hall = new Proxy({}, { get: () => (...a) => ({ ok: true, msg: '', text: [], reward: { text: [] } }) });

function freshState() {
  for (const k of Object.keys(store)) delete store[k];
  Cult.load();
  return Cult.get();
}

// —— 三种状态 ——
const stateFresh = freshState();

const stateLit = freshState();                       // 篝火在烧 ← XX-FEEDN 就藏在这
Bag.add('stone_1', 4);
const lit = CAMP.light('n0');
Bag.add('stone_1', 3);                               // light() 会把现有源石全投掉，补几颗让源石卡能渲染
const burning = CAMP.burning();

const stateRich = freshState();                      // 中期:神通/装备/建筑/丹药都有
stateRich.arts = { fx: 3, sword: 5, talisman: 2 };
stateRich.dao = 99999; stateRich.exp = 4321;
stateRich.pills = { pill_1: 4 };
stateRich.totalKills = 3210;
for (const id of ['n1','n3','n10','n13']) stateRich.visited[id] = true;

console.log('【前置】三种状态都真的到位(否则后面等于没测)');
ok('新号状态可用', !!stateFresh);
ok('篝火真的点着了(XX-FEEDN 的触发条件)', burning === true, `CAMP.burning()=${burning}`);
ok('生火后背包仍有源石(否则源石卡那段根本不会渲染)', Bag.count('stone_1') > 0, `剩 ${Bag.count('stone_1')}`);

console.log('\n【逐视图 × 三状态渲染】');
const mods = {};
const crash = [];
for (const [mod, name] of VIEWS) {
  mods[mod] ||= await import(`../js/xiuxian/ui/${mod}.js`);
  const fn = mods[mod][name];
  if (typeof fn !== 'function') { crash.push(`${name} 导出里没有`); continue; }
  const results = [];
  for (const [label, st] of [['新号', stateFresh], ['生火', stateLit], ['中期', stateRich]]) {
    try {
      const out = fn(hall, st);
      const len = typeof out === 'string' ? out.length : (out == null ? 0 : 1);
      results.push(`${label}:${len}`);
    } catch (e) {
      results.push(`${label}:❌${e.constructor.name}`);
      crash.push(`${name} 在【${label}】状态下崩: ${e.constructor.name}: ${String(e.message).slice(0, 70)}`);
    }
  }
  ok(`${name} 三状态都渲染通过`, !crash.some(c => c.startsWith(name)), results.join(' '));
}

console.log('\n【回归本体】营地页生火后必须显示投石数量(XX-FEEDN)');
{
  for (const n of [1, 7]) {
    try {
      const html = mods.arts.vCamp(hall, stateLit, n);
      const stone = /投 \d+/.test(html);          // arts.js:96  源石卡上的「投 N」
      const numrow = new RegExp(`class="xx-val">${n}<`).test(html);  // arts.js:135 数字
      ok(`vCamp(feedN=${n}) 两处都插对了`, stone && numrow,
         `源石卡「投 N」=${stone} · 数字行=${numrow}`);
    } catch (e) {
      ok(`vCamp(feedN=${n})`, false, `${e.constructor.name}: ${String(e.message).slice(0, 70)}`);
    }
  }
  try {
    const html = mods.arts.vCamp(hall, stateLit);
    ok('不传第三参时默认 1(不崩即可)', typeof html === 'string');
  } catch (e) {
    ok('不传第三参', false, e.message);
  }
}

if (crash.length) {
  console.log('\n崩溃明细:');
  for (const c of crash) console.log('  · ' + c);
}

console.log(`\n失败 ${fails} 项` + (fails ? '' : ' · 全部通过'));
process.exit(fails ? 1 : 0);
