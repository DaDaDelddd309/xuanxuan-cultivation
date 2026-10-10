// 界面文字卫生(工单 XX-TEST-002)
//
// 为什么需要:
//   V0.99 上线后用户实机看到修仙阁年表栏直接吐出整段 JS 源码:
//     「year(fromClock) { if (!fromClock) this.s.year = CLOCK.year(); ...」
//   根因:我给 CHRONICLE 加了 `get year()`,而对象字面量里**后定义的同名方法
//   year() 会整个覆盖 getter**,于是 this.year 拿到的是函数本身,拼进模板就是源码。
//
//   而当时 564 项断言全绿 —— 因为**没有一条断言检查"界面上显示的是不是人能读的字"**。
//   逻辑全对、模块全通、数字全对,就是没人看那行字长什么样。
//
// 本文件的原则:凡是**会被拼进 innerHTML 的东西**,都必须是人能读的文字。
// 这是"逻辑测试"和"呈现测试"之间那道一直没人补的缝。

const { install } = await import('./harness.mjs');
install();

import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

// 显示出来的代码特征。宁可误报也不能漏 —— 漏了就是放源码上线。
const CODE_SMELLS = [
  [/function\s*\w*\s*\(/, '出现 function('],
  [/=>/, '出现箭头函数 =>'],
  // 注意:别把 'var' 当特征 —— 那是合法的 HTML 标签 <var>(斜体数值)。
  // 只认 const/let,且要求后面跟空格或 = (排除单词出现在中文里)。
  [/\b(const|let)\s+[A-Za-z_\$]/, '出现变量声明 const/let'],
  [/\breturn\b/, '出现 return'],
  [/\{;|\}\s*;/, '出现花括号分号(源码结构)'],
  [/\bthis\.\w+\s*=/, '出现 this.xxx= 赋值'],
  [/=>\s*\{/, '出现 =>{'],
  [/\)\s*\{\s*$/m, '行尾是 ){ (函数体)'],
  [/=\s*\(?function/, '出现 =function'],
];

// 明显不是给人看的占位
const PLACEHOLDERS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/, /\bInfinity\b/];

// ⚠️ XX-AUDIT-005:'js/xiuxian/ui.js' 硬写在列表里,拆分后新增的
// js/xiuxian/ui/*.js 一份都进不了检查 —— 文案检查会静默少覆盖一大片。
// 改成动态取整个 UI 层。
const { uiFiles } = await import('./lib-uimod.mjs');
const UI_FILES = [
  ...uiFiles(),
  'js/xiuxian/chronicle.js', 'js/xiuxian/clock.js',
  'js/xiuxian/market.js', 'js/xiuxian/tavern.js', 'js/xiuxian/artstar.js',
  'js/xiuxian/craft.js', 'js/xiuxian/companion.js', 'js/xiuxian/companion-actor.js',
  'js/xiuxian/bond.js', 'js/xiuxian/ritual.js', 'js/xiuxian/bestiary.js',
  'js/xiuxian/world.js', 'js/xiuxian/story.js', 'js/xiuxian/quest.js',
  'js/xiuxian/family.js', 'js/xiuxian/build.js', 'js/xiuxian/camp.js',
  'js/main.js',
];

// ————————————————————————————————————
console.log('\n[1] getter / setter 不得与同名方法冲突');
{
  const files = UI_FILES.map(f => [f, readFileSync(ROOT + '/' + f, 'utf8')]);
  const getPat = /^\s*get\s+(\w+)\s*\(\s*\)/gm;
  let conflict = 0;
  for (const [f, src] of files) {
    const names = [...src.matchAll(getPat)].map(m => m[1]);
    for (const n of names) {
      const method = new RegExp('^\\s*' + n + '\\s*\\(', 'm').test(src);
      const hasGetBody = new RegExp('^\\s*get\\s+' + n + '\\s*\\([^)]*\\)\\s*\\{[^}]*\\}', 'm').test(src);
      if (method && !hasGetBody) {
        ok(`${f}: get ${n}() 与 ${n}()() 冲突`, false,
           '后定义的方法会覆盖 getter → this.' + n + ' 变成函数本身');
        conflict++;
      }
    }
  }
  if (!conflict) ok('全仓无 getter/方法同名冲突', true);
}

console.log('\n[2] 插值规则:数字/字符串裸插是安全的,只盯可疑的');
{
  // 扫源码找「可能返回对象/函数的裸插值」太容易误报(数字、.length 都是安全的)。
  // 真正能抓 bug 的是 [5] 的**实际渲染**检查 —— 那一节跑真页面。
  // 这里只留一条结构性纪律:任何 getter 都不得与方法同名([1] 已覆盖)。
  ok('本节不做源码猜测,交给 [5] 实际渲染', true);
}

console.log('\n[3] 已知的"渲染出源码"入口逐个验');
{
  // CHRONICLE.stamp() 是这次翻车的地方,直接验它的输出
  const { CLOCK } = await import('../js/xiuxian/clock.js');
  const { CHRONICLE } = await import('../js/xiuxian/chronicle.js');
  CLOCK.load(); CHRONICLE.load();
  const s = CHRONICLE.stamp();
  ok('stamp() 是字符串', typeof s === 'string', typeof s);
  for (const [re, why] of CODE_SMELLS) ok(`stamp() 无${why}`, !re.test(s), s.slice(0, 50));
  for (const re of PLACEHOLDERS) ok(`stamp() 无 ${re}`, !re.test(s), s);
  ok('stamp() 读得出年日', /\d+ 年 · \d+ 日/.test(s), s);
}

console.log('\n[4] 关键格式化函数不会返回函数体');
{
  const { CLOCK } = await import('../js/xiuxian/clock.js');
  const t = CLOCK.uptimeText();
  ok('uptimeText 是字符串', typeof t === 'string', typeof t);
  for (const [re, why] of CODE_SMELLS) ok(`uptimeText 无${why}`, !re.test(t), t);
  ok('uptimeText 含累计', /累计/.test(t), t);

  const { MOUNT } = await import('../js/xiuxian/mount.js');
  const { ARTSTAR } = await import('../js/xiuxian/artstar.js');
  const { MARKET, MARKET_GOODS } = await import('../js/xiuxian/market.js');
  const { TAVERN, MATES } = await import('../js/xiuxian/tavern.js');
  globalThis.__g = { save: { data: { gold: 5000 } } };
  MATES.scavenger && null;
  ok('同伴名是字符串', typeof MATES.scavenger.name === 'string');
  ok('商品名是字符串', typeof MARKET_GOODS.stone_1.name === 'string');
  ok('升星文案是字符串', typeof ARTSTAR.up('jianqi', { max: 5, base: 10 }, () => true, () => true).msg === 'string');
}

console.log('\n[5] 修仙阁 13 个页签:正文不得含代码特征');
{
  // 真渲染一遍,而不是扫源码
  const R = ROOT + '/js/xiuxian/';
  for (const m of ['index.js','items.js','camp.js','merchant.js','mount.js','companion.js',
                   'story.js','quest.js','chronicle.js','build.js','family.js','relations.js',
                   'ambience.js','clock.js','market.js','tavern.js','artstar.js','craft.js',
                   'spine.js','ui.js']) await import(R + m);
  const { Cult } = await import(R + 'index.js');
  const { Bag, DAY } = await import(R + 'items.js');
  const { CAMP } = await import(R + 'camp.js');
  const { Merchant } = await import(R + 'merchant.js');
  const { MOUNT } = await import(R + 'mount.js');
  const { COMPANION } = await import(R + 'companion.js');
  const { STORY } = await import(R + 'story.js');
  const { QUEST } = await import(R + 'quest.js');
  const { CHRONICLE } = await import(R + 'chronicle.js');
  const { BUILD } = await import(R + 'build.js');
  const { FAMILY } = await import(R + 'family.js');
  const { CLOCK } = await import(R + 'clock.js');
  const { MARKET } = await import(R + 'market.js');
  const { ARTSTAR } = await import(R + 'artstar.js');
  const { installSpine } = await import(R + 'spine.js');
  const { Hall } = await import(R + 'ui.js');
  globalThis.__g = { save: { data: { gold: 3000 } } };
  CLOCK.load(); Cult.init(); Bag.load('x'); DAY.load('d'); CAMP.load();
  Merchant.load(); MOUNT.load(); COMPANION.load(); STORY.load(); QUEST.load();
  CHRONICLE.load(); BUILD.load(); FAMILY.load(); MARKET.loaded = false; MARKET.load();
  ARTSTAR.load(); installSpine(Cult.s, CAMP);
  Hall.open();

  const TABS = ['realm','map','camp','arts','bag','market','people','title',
                'fam','build','dex','quest','sys'];
  for (const t of TABS) {
    Hall.tab = t; Hall.render();
    const h = globalThis.document.querySelector('#xx-body').innerHTML;
    // 去掉 style/script 块再查,那些是代码但不是"漏出来"的
    const text = h.replace(/<style[\s\S]*?<\/style>/g, '');
    const hit = CODE_SMELLS.find(([re]) => re.test(text));
    if (hit) ok(`${t} 页无代码外泄`, false, hit[1] + ' → ' + text.match(hit[0])[0].slice(0, 40));
    else ok(`${t} 页无代码外泄`, true);
    const ph = PLACEHOLDERS.find((re) => re.test(text));
    if (ph) ok(`${t} 页无 undefined/NaN/[object]`, false, ph + ' → ' + text.match(ph)[0]);
    else ok(`${t} 页无 undefined/NaN/[object]`, true);
  }
}

console.log(`\ntest-uitext: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);