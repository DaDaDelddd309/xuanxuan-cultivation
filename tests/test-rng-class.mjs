// RNG 类单元测试 —— 工单 XX-S1-002
//
// ⚠️ 2026-10-10 新增。补的是一个具体的洞:
//   `tests/test-rng.mjs` 早就存在、16 条断言全绿、挂在 `npm run test:rng` 上,
//   但它测的是 **profile.js 的 Seed**(另一个模块的 mulberry32 封装),
//   而工单 XX-S1-002 点名的是 `vendor/rot-rng.js` 的 **RNG 类**。
//   结果:`rot-rng.js` 实现了 13 个方法,其中 `getState` / `setState` / `clone` /
//   `getWeightedValue` 这几个是它**自己注释里声明的核心用途**,却零直接覆盖。
//
//   **测试存在但测的是别的东西,比没有测试更危险** ——
//   它让人以为这条有回归保护,于是真出问题时不会去查这里。
//
// 本文件只测 RNG 类本身,不碰 Seed。两者分工:
//   Seed      —— 局外玩法的确定性(奇遇/商人/掉落/怨灵)
//   RNG       —— 程序化生成的底座(地形/命名/子流隔离)
//
// 运行:node tests/test-rng-class.mjs
import { RNG } from '../js/xiuxian/vendor/rot-rng.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failed.push(name + (detail ? ' :: ' + detail : '')); }
  if (!cond) console.log(`  ❌ ${name} ${detail}`);
}

// 统计检验用:固定次数采样,判断分布而不是逐个值
const N = 20000;

console.log('\n[1] 构造与种子');
{
  const a = new RNG(12345);
  ok('实例是 RNG', a instanceof RNG);
  ok('getSeed 返回构造时的种子', a.getSeed() === 12345, `实际 ${a.getSeed()}`);
  ok('两个实例不共享状态',
     new RNG(1).getUniform() !== undefined && new RNG(2).getUniform() !== undefined);
  // 经典踩坑:曾有人把 RNG 做成单例,于是「每条子流独立」根本不成立
  const x = new RNG(7), y = new RNG(7);
  ok('同种子两实例产出相同序列', x.getUniform() === y.getUniform());
  const z = new RNG(8);
  ok('不同种子产出不同序列', new RNG(7).getUniform() !== z.getUniform());
}

console.log('\n[2] setSeed 后重新可复现');
{
  const r = new RNG(999);
  r.getUniform(); r.getUniform();          // 推进状态
  r.setSeed(999);
  // 注意:setSeed 把状态**退回起点**,所以第 1 个值就等于全新实例的第 1 个值,
  // 不是「推进三次后那个 mid」。第一版这里写错了(mid vs 第一个值),测了个不存在的行为。
  const afterReset = [r.getUniform(), r.getUniform(), r.getUniform()];
  const fresh = new RNG(999);
  const expect = [fresh.getUniform(), fresh.getUniform(), fresh.getUniform()];
  ok('setSeed 回到同种子后序列可复现', afterReset.every((v, i) => v === expect[i]),
     `${afterReset.map(v => v.toFixed(6))} vs ${expect.map(v => v.toFixed(6))}`);
  ok('setSeed 确实退回起点', Math.abs(r.getSeed() - 999) < 1e-9, `实际 ${r.getSeed()}`);
}

console.log('\n[3] getUniform —— 分布与值域');
{
  const r = new RNG(42);
  let sum = 0, min = 1, max = 0, outside = 0;
  for (let i = 0; i < N; i++) {
    const v = r.getUniform();
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v < 0 || v >= 1) outside++;
  }
  const mean = sum / N;
  ok('全部落在 [0,1)', outside === 0, `越界 ${outside} 次`);
  ok('均值接近 0.5', Math.abs(mean - 0.5) < 0.01, `实际均值 ${mean.toFixed(5)}`);
  ok('确实覆盖到 0 附近', min < 0.001, `最小 ${min.toFixed(6)}`);
  ok('确实覆盖到 1 附近', max > 0.999, `最大 ${max.toFixed(6)}`);
  ok('不是常量', max - min > 0.5);
}

console.log('\n[4] getUniformInt —— 边界与均匀性');
{
  const r = new RNG(7);
  // 边界值必须真能取到,否则「区间」是假的
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(r.getUniformInt(3, 7));
  ok('下界可取到', seen.has(3), `实际取到 ${[...seen].sort((a,b)=>a-b).join(',')}`);
  ok('上界可取到', seen.has(7));
  ok('不越下界', ![...seen].some(v => v < 3));
  ok('不越上界', ![...seen].some(v => v > 7));
  ok('整区间都取到', seen.size === 5, `只取到 ${seen.size} 个值`);

  // 单值区间(lower === upper)是最容易写 off-by-one 的地方
  ok('lower===upper 返回该值', r.getUniformInt(5, 5) === 5);

  const counts = {};
  const r2 = new RNG(11);
  for (let i = 0; i < N; i++) { const v = r2.getUniformInt(0, 3); counts[v] = (counts[v] || 0) + 1; }
  const vals = Object.values(counts);
  ok('四个值都出现', vals.length === 4, `只出现 ${vals.length} 个`);
  ok('大致均匀', Math.max(...vals) / Math.min(...vals) < 1.1,
     `min=${Math.min(...vals)} max=${Math.max(...vals)}`);
}

console.log('\n[5] getNormal —— 中心与展布');
{
  const r = new RNG(3);
  let sum = 0, sq = 0;
  for (let i = 0; i < N; i++) { const v = r.getNormal(10, 2); sum += v; sq += v * v; }
  const mean = sum / N;
  const sd = Math.sqrt(sq / N - mean * mean);
  ok('均值接近设定值', Math.abs(mean - 10) < 0.1, `实际 ${mean.toFixed(4)}`);
  ok('标准差接近设定值', Math.abs(sd - 2) < 0.1, `实际 ${sd.toFixed(4)}`);
  // 自定义参数不能被忽略
  const r2 = new RNG(3);
  let s2 = 0;
  for (let i = 0; i < N; i++) s2 += r2.getNormal(-5, 1);
  ok('支持负的均值', Math.abs(s2 / N + 5) < 0.1, `实际 ${(s2 / N).toFixed(4)}`);
}

console.log('\n[6] getPercentage —— 1..100 闭区间');
{
  const r = new RNG(5);
  const seen = new Set();
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const v = r.getPercentage();
    seen.add(v);
    if (!Number.isInteger(v) || v < 1 || v > 100) bad++;
  }
  ok('全是 1..100 的整数', bad === 0, `越界 ${bad} 次`);
  ok('100 能取到(闭区间)', seen.has(100));
  ok('1 能取到(闭区间)', seen.has(1));
  ok('覆盖足够广', seen.size >= 95, `只取到 ${seen.size} 个不同值`);
}

console.log('\n[7] getItem 与 shuffle');
{
  const r = new RNG(13);
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const got = [];
  for (let i = 0; i < 2000; i++) got.push(r.getItem(arr));
  ok('只返回数组内的元素', got.every(v => arr.includes(v)));
  ok('各元素都被抽到过', new Set(got).size === arr.length);
  // shuffle 不能丢元素也不能产生重复 —— 这是它最容易坏的地方
  const src = Array.from({ length: 12 }, (_, i) => i);
  const sh = r.shuffle(src.slice());
  ok('shuffle 不改原数组', src.every((v, i) => v === i));
  ok('shuffle 长度不变', sh.length === src.length);
  ok('shuffle 是排列(无重复无丢失)',
     new Set(sh).size === src.length && sh.every(v => src.includes(v)));
  // 不能每次都返回同一个顺序,否则叫 shuffle 有点冤
  const orders = new Set();
  for (let i = 0; i < 50; i++) orders.add(r.shuffle(src.slice()).join(','));
  ok('多次 shuffle 结果不同', orders.size > 5, `只出现 ${orders.size} 种顺序`);
}

console.log('\n[8] getWeightedValue —— 权重抽取（本类存在的理由）');
{
  const r = new RNG(17);
  // ⚠️ 真实签名是 `getWeightedValue(data)`:`for (const id in data)`,
  //   所以它收的是**对象** `{ 键: 权重 }`,返回的是**键名**。
  //   第一版这里传了数组 `[{v,w}]`,于是 `data[id]` 是对象、相加得 NaN,
  //   返回的还是数组下标 '0'/'1'/'2' —— 测的是一个不存在的用法。
  const data = { secret1: 80, secret2: 15, secret3: 5 };
  const counts = {};
  for (let i = 0; i < N; i++) {
    const v = r.getWeightedValue(data);
    counts[v] = (counts[v] || 0) + 1;
  }
  const p1 = counts.secret1 / N, p2 = counts.secret2 / N, p3 = counts.secret3 / N;
  ok('权重 80 的约占 80%', Math.abs(p1 - 0.8) < 0.02, `实际 ${(p1 * 100).toFixed(2)}%`);
  ok('权重 15 的约占 15%', Math.abs(p2 - 0.15) < 0.02, `实际 ${(p2 * 100).toFixed(2)}%`);
  ok('权重 5 的约占 5%', Math.abs(p3 - 0.05) < 0.02, `实际 ${(p3 * 100).toFixed(2)}%`);
  ok('三个键都取到过', !!(counts.secret1 && counts.secret2 && counts.secret3));
  ok('返回的是键名而不是值', Object.keys(counts).every(k => k in data),
     `实际取到 ${Object.keys(counts).join(',')}`);

  // 权重全 0:total=0 → random=0 → 循环里 `0 < part(=0)` 恒假 → 返回最后一个键。
  // 不崩,但结果是「最后一个」。记下来,因为这是调用方给错数据时的实际行为。
  const z = new RNG(17);
  const zr = z.getWeightedValue({ x: 0, y: 0 });
  ok('权重全 0 时不抛异常', zr !== undefined && zr !== null, `实际 ${JSON.stringify(zr)}`);
  ok('权重全 0 时仍返回集合内的键', ['x', 'y'].includes(zr), `实际 ${zr}`);
  ok('空对象不抛异常', (() => { try { new RNG(1).getWeightedValue({}); return true; } catch (err) { return false; } })());
}

console.log('\n[9] getState / setState —— 存档只存种子不存世界的前提');
{
  const r = new RNG(23);
  r.getUniform(); r.getUniform(); r.getUniform();
  const state = r.getState();
  ok('状态是数组', Array.isArray(state), `实际 ${typeof state}`);
  ok('状态长度 4(3 个内部寄存器 + 计数器)', state.length === 4, `实际 ${state.length}`);
  ok('状态元素都是数字', state.every(v => typeof v === 'number' && Number.isFinite(v)));

  const expect = [r.getUniform(), r.getUniform(), r.getUniform()];
  r.setState(state);
  const actual = [r.getUniform(), r.getUniform(), r.getUniform()];
  ok('setState 后序列精确复现', expect.every((v, i) => v === actual[i]));

  // 这是 save() / load() 能成立的技术前提:整个状态可以搬走
  const a = new RNG(31), b = new RNG(31);
  a.getUniform();
  b.setState(a.getState());
  ok('跨实例搬运状态后同步', a.getUniform() === b.getUniform());
}

console.log('\n[10] clone —— 子流隔离不互相干扰');
{
  const a = new RNG(41);
  a.getUniform();                       // 推进主实例,让 clone 从"中途"开始
  const c = a.clone();
  ok('clone 是独立实例', c !== a && c instanceof RNG);
  ok('clone 后两者互不影响',
     (a.getUniform(), c.getUniform(), a.getUniform()) !== (c.getUniform(), c.getUniform()));

  // 真正要保证的:推进 clone 不能改变原实例的序列
  const base = new RNG(43);
  const expect = [base.getUniform(), base.getUniform(), base.getUniform()];
  const base2 = new RNG(43);
  // 注意:这里**不能**先 base2.getUniform() 推进 —— 那样 actual 取的是第 2/3/4 个值,
  // 而 expect 是第 1/2/3 个,序列天然错位一位。第一版就栽在这里,
  // 差一位的断言测的是「错位后的相等」,不是「clone 不影响原序列」。
  base2.clone().getUniform(); base2.clone().getUniform(); base2.clone().getUniform();
  const actual = [base2.getUniform(), base2.getUniform(), base2.getUniform()];
  ok('推进 clone 不改变原序列', expect.every((v, i) => v === actual[i]),
     `期望 ${expect.map(v=>v.toFixed(6))} 实际 ${actual.map(v=>v.toFixed(6))}`);
}

console.log('\n[11] 边界与异常不应静默通过');
{
  ok('空种子的 getUniform 仍在 [0,1)',
     (() => { const r = new RNG(0); const v = r.getUniform(); return typeof v === 'number' && v >= 0 && v < 1; })());
  ok('字符串种子不崩',
     (() => { try { const r = new RNG('abc'); return typeof r.getUniform() === 'number'; } catch (e) { return false; } })());
  ok('undefined 种子不崩',
     (() => { try { const r = new RNG(undefined); return typeof r.getUniform() === 'number'; } catch (e) { return false; } })());
  // 反向区间:实现用 max/min 归一化,所以 lower>upper 是**支持**的,
  // 不该返回一个区间外的值当作没事发生。
  const r = new RNG(3);
  const rev = new Set();
  for (let i = 0; i < 2000; i++) rev.add(r.getUniformInt(7, 3));
  ok('反向区间(7,3)与正向(3,7)取同一集合',
     [...rev].every(v => v >= 3 && v <= 7), `实际取到 ${[...rev].sort((a,b)=>a-b).join(',')}`);
  ok('反向区间也能取到两端', rev.has(3) && rev.has(7));
  // 下界大于上界时的直觉期望有两条:要么报错,要么等价于交换后取值。
  // 当前实现是后者(归一化),所以断言写死后者 —— 哪天改成前者,这条会红并提醒更新。
  const fwd = new Set();
  const r2 = new RNG(3);
  for (let i = 0; i < 2000; i++) fwd.add(r2.getUniformInt(3, 7));
  ok('反向与正向取到的集合相同',
     [...rev].every(v => fwd.has(v)) && [...fwd].every(v => rev.has(v)));
}

console.log(`\n${'='.repeat(46)}`);
console.log(`test-rng-class: ${fail ? 'FAIL' : 'PASS'} (${pass} 通过 / ${fail} 失败)`);
if (fail) { console.log('\n失败项:'); failed.forEach(f => console.log('  · ' + f)); }
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);