// 砍杀产出护栏 —— 工单 XX-NET-004
// 运行: node tests/kill-yield-regression.mjs
//
// 这条门禁存在的原因,是一桩**从来没被发现的静默事故**:
//
// `js/main.js` 局末调 `Cult.settle({kills,...})`,外面包着
//     try { cult = Cult.settle({...}); } catch (e) { console.warn('[cult-settle]', e); }
// 而 `Cult.settle` 的第一行用的是 `layerCost()` —— **那个名字从来没被 import**。
//
// 于是从 `d94ef8a v099k` 起,每一次砍杀结算都抛 ReferenceError,
// 被上面那行 catch 吞成一行 console.warn,**修为和道行一次都没发过**。
//
// 最讽刺的地方:v099k 的提交信息写着「砍杀修为接上(化神期 59087 局 -> 209 局)」,
// **那套被精心调过的平衡从来没生效过** —— 它调的第一行就抛。
//
// 而全部测试都是绿的:玩家看到的是「砍杀完修为不涨」,开发者看到的是「CI 全绿」。
// 这就是本门禁要堵的洞:**一个被 catch 吞掉的异常,不产生任何可观测信号。**
//
// 玩家的原话(这才是发现它的方式):
// 「为什么要点击?不是砍杀后自动涨修为的吗?这个还能自己加上去?那么还玩什么?」
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
import { stripComments } from './lib-swlist.mjs';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.document = { addEventListener(){}, removeEventListener(){},
  createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, remove(){} }),
  body:{appendChild(){}}, getElementById:()=>null };
globalThis.window = {};

const { Cult } = await import('../js/xiuxian/index.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d='') => { if (c) pass++; else { fail++; failed.push(n + (d?' :: '+d:'')); console.log(`  ❌ ${n} ${d}`); } };

// ————— 0. 前提:必须真的能调,而不是一调就抛 —————
{
  let threw = null;
  try { Cult.killYield(Cult.get(), 1); } catch (e) { threw = e; }
  ok('killYield 不抛异常(那个丢掉的 layerCost import 就死在这)', !threw,
     threw ? threw.constructor.name + ': ' + threw.message : '');
}

// ————— 1. 砍杀必须真的给修为和道行 —————
{
  Cult.s.realm = 'qi'; Cult.s.layer = 1;
  const exp0 = Cult.s.exp || 0, dao0 = Cult.s.dao;
  let r = null, threw = null;
  try { r = Cult.settle({ kills: 10, time: 60 }); } catch (e) { threw = e; }
  ok('Cult.settle 不抛', !threw, threw ? threw.message : '');
  ok('settle 返回了产出(不是 null)', !!r, 'main.js 靠它判是否结算成功');
  ok('10 只妖给了修为', (Cult.s.exp || 0) > exp0,
     `exp ${exp0} → ${Cult.s.exp}`);
  ok('10 只妖给了道行', Cult.s.dao > dao0, `dao ${dao0} → ${Cult.s.dao}`);
  ok('settle 返回值与实际入账一致', r && r.exp > 0, `r.exp=${r && r.exp}`);
}

// ————— 2. 产出必须随境界放大(从 LAYER_COST 反推,不是拍系数) —————
{
  // 境界 id 用真实表里的,别猜 —— 猜错会得到「两境界产出一样」的假象,
  // 然后我就会以为公式没生效。(踩过一次:'hua' 其实叫 'huashen')
  //
  // ⚠️ 这里必须包 try:如果 killYield 因为缺 import 而抛,门禁自己会跟着崩,
  //    变成一段栈而不是一条「哪项不达标」。**门禁失败必须让人一眼看出是哪条**,
  //    崩掉的话还得自己反推是哪一行 —— 那是把诊断成本转嫁给下一个人。
  let a = null, b = null, err = null;
  try { a = Cult.killYield({ realm: 'qi' }, 100); b = Cult.killYield({ realm: 'huashen' }, 100); }
  catch (e) { err = e; }
  ok('killYield 在两个境界都能算出产出', !err, err ? err.message : '');
  if (!err) ok('高境界产出显著高于低境界', b.exp > a.exp * 10,
     `炼气 ${a.exp} vs 化神 ${b.exp}`);
}

// ————— 3. 吐纳必须走**同一条**公式(不能各写各的) —————
{
  ok('MEDITATE_AS_KILLS 是正数', Cult.MEDITATE_AS_KILLS > 0,
     `实测 ${Cult.MEDITATE_AS_KILLS}`);
  let one = null, med = null, err = null;
  try { one = Cult.killYield(Cult.get(), 1); med = Cult.killYield(Cult.get(), Cult.MEDITATE_AS_KILLS); }
  catch (e) { err = e; }
  ok('吐纳产出算得出来', !err, err ? err.message : '');
  if (!err) {
    // 注意用比值而不是乘法等式:killYield 每只都 Math.round,
    // 1 只 = round(2.5) = 3,4 只 = round(10) = 10,写成 `med === one*4` 会假红。
    const asKills = med.exp / one.exp;
    ok('吐纳产出 ≈ 固定只数的妖', Math.abs(asKills - Cult.MEDITATE_AS_KILLS) <= 1,
       `吐纳折合 ${asKills.toFixed(1)} 只,期望 ${Cult.MEDITATE_AS_KILLS} 只`);
    ok('一次吐纳不超过 10 只妖(否则砍杀失去意义)', asKills <= 10,
       `1 次吐纳 = ${asKills.toFixed(1)} 只妖`);
  }
}

// ————— 4. 接线契约:main.js 的 catch 不得把失败吞成「没事」 —————
{
  const raw = readFileSync(ROOT + '/js/main.js', 'utf8');
  const src = stripComments(raw);
  ok('main.js 调了 Cult.settle', /Cult\.settle\s*\(/.test(src));
  // catch 里至少要 warn 出可读的标识,不能静默
  ok('settle 失败时留下可查痕迹', /catch\s*\([^)]*\)\s*\{\s*console\.warn/.test(src),
     'settle 外面那个 catch 必须 warn —— 静默 catch 是这次事故能活到今天的原因');
  // 关键:sp.exp 的兜底依赖 cult 非空,cult 为 null 时修为就无处可去
  ok('cult 为 null 时不会把 exp 赋成 undefined', /if\s*\(sp\s*&&\s*cult\)\s*sp\.exp\s*=\s*cult\.exp/.test(src));
}

// ————— 5. 死代码护栏:settle 真的有调用点(它一度「全项目无调用点」) —————
{
  const callers = ['js/main.js']
    .map(f => readFileSync(ROOT + '/' + f, 'utf8'))
    .filter(s => /Cult\.settle\s*\(/.test(s)).length;
  ok('Cult.settle 至少有一个调用点', callers >= 1,
     'v099k 时它「一直存在、公式也对,但全项目没有任何调用点」');
}

console.log(`\n砍杀产出护栏: ${pass} 通过, ${fail} 失败`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);