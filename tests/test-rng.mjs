// 种子确定性测试(XX-AUDIT-010)
//
// 背景:`npm run test:rng` 引用了 6 个**从未在 git 历史中存在过**的测试文件
//   (test-rng / test-seed / test-worldgen / test-world-compat / test-mine / test-runcfg)
// 实跑得到 MODULE_NOT_FOUND,`npm run check:full` 因此永远红。
//
// AGENTS.md 承诺「同种子 = 同世界,存档码可复现」,而这条承诺此前**零验证**:
// 仓库里有 171 处 Math.random(),唯一能验确定性的就是 Seed。
// 本文件补上这个缺口 —— 不是把 6 个空引用改成 1 个空引用,
// 而是让 `test:rng` 指向一个**真实存在、真能验出东西**的测试。
//
// ⚠️ 本测试只覆盖 Seed 自己的确定性,不代表全仓库已无 Math.random。
//    剩余 Math.random 的清理见 TICKETS(按模块分批,禁止一次性批量改)。
globalThis.document = {
  addEventListener(){}, createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),
  body:{appendChild(){}}, getElementById:()=>null,
};
globalThis.window = {};
const store = {};
globalThis.localStorage = { getItem:k=>store[k]??null, setItem:(k,v)=>store[k]=v, removeItem:k=>delete store[k] };

const { Seed } = await import('../js/xiuxian/profile.js');

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log('  ❌', n)); };
const seq = (n) => Array.from({ length: n }, () => Seed.next());

console.log('\n=== 同种子 → 同序列 ===');
{
  Seed.set('青石村');
  const a = seq(200);
  Seed.set('青石村');
  const b = seq(200);
  t('同种子两次 200 次采样完全一致', JSON.stringify(a) === JSON.stringify(b));
}

console.log('=== 不同种子 → 不同序列 ===');
{
  Seed.set('青石村');
  const a = seq(200);
  Seed.set('黑风岭');
  const b = seq(200);
  t('不同种子产生不同序列', JSON.stringify(a) !== JSON.stringify(b));
}

console.log('=== 取值域合法 ===');
{
  Seed.set('青石村');
  const vals = seq(500);
  t('全部落在 [0,1)', vals.every(v => v >= 0 && v < 1));
  t('没有恒定值(不是死 PRNG)', new Set(vals).size > 100);
  t('不是纯 0.5 退化', new Set(vals).size > 1);
}

console.log('=== 派生接口同源 ===');
{
  Seed.set('青石村');
  const s1 = Array.from({ length: 50 }, () => Seed.int(1, 6));
  Seed.set('青石村');
  const s2 = Array.from({ length: 50 }, () => Seed.int(1, 6));
  t('int() 同种子可复现', JSON.stringify(s1) === JSON.stringify(s2));
  t('int() 落在 [1,6]', s1.every(v => Number.isInteger(v) && v >= 1 && v <= 6));

  Seed.set('青石村');
  const p1 = Array.from({ length: 50 }, () => Seed.pick(['a','b','c']));
  Seed.set('青石村');
  const p2 = Array.from({ length: 50 }, () => Seed.pick(['a','b','c']));
  t('pick() 同种子可复现', JSON.stringify(p1) === JSON.stringify(p2));
  t('pick() 只取到给定集合', p1.every(v => ['a','b','c'].includes(v)));

  Seed.set('青石村');
  const w1 = Array.from({ length: 50 }, () => Seed.weighted([{id:1,w:1},{id:2,w:9}], e=>e.w));
  Seed.set('青石村');
  const w2 = Array.from({ length: 50 }, () => Seed.weighted([{id:1,w:1},{id:2,w:9}], e=>e.w));
  t('weighted() 同种子可复现', JSON.stringify(w1) === JSON.stringify(w2));

  Seed.set('青石村');
  const c1 = Array.from({ length: 200 }, () => Seed.chance(0.3));
  t('chance() 只返回布尔', c1.every(v => typeof v === 'boolean'));
  const rate = c1.filter(Boolean).length / c1.length;
  t(`chance(0.3) 实测占比接近 0.3(实测 ${rate.toFixed(2)})`, rate > 0.15 && rate < 0.45);
}

console.log('=== 空种子回默认 ===');
{
  Seed.set('   ');
  t('空白种子回落青石村', Seed.cur === '青石村');
  Seed.set('');
  t('空串种子回落青石村', Seed.cur === '青石村');
}

console.log('=== 种子随存档往返 ===');
{
  Seed.set('青石村');
  Seed.set('自定义种子XYZ');
  const got = Seed.get();          // 模拟重开页面:从 localStorage 读回
  t('get() 读回存档里的种子', got === '自定义种子XYZ');
  Seed.set('青石村');
  const a = seq(100);
  Seed.set('自定义种子XYZ');
  const b = seq(100);
  t('换种子后序列随之改变', JSON.stringify(a) !== JSON.stringify(b));
}

console.log(`\ntest-rng: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);