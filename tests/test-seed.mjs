// 分层种子单元测试 —— 覆盖工单 XX-S2-001 / 002 / 003
// 运行: node tests/test-seed.mjs
import { RNG } from '../js/xiuxian/vendor/rot-rng.js';
import { hashStr, derive, STREAMS, SeedSet, setMaster, getMaster, save, load, fingerprint, rng } from '../js/xiuxian/seed.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failed.push(name); console.log(`  ❌ ${name} ${detail}`); }
}

console.log('\n[1] 子种子派生：各流互相独立');
{
  const m = '青石村';
  const vals = STREAMS.map(s => derive(m, s));
  ok('四条流派生值互不相同', new Set(vals).size === vals.length, `值: ${vals}`);
  ok('派生值都是合法 32 位无符号整数', vals.every(v => Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF));
  ok('流名不同则值不同', derive(m, 'terrain') !== derive(m, 'village'));
  ok('主种子不同则值不同', derive('甲', 'loot') !== derive('乙', 'loot'));
}

console.log('\n[2] 改 loot 流不影响 terrain 流');
{
  // 关键验证：消耗 loot 流之后，terrain 的产出必须与未消耗时一致。
  const s3 = new SeedSet('种子A');
  const t3 = s3.stream('terrain').getUniform();   // terrain 第一位

  const s4 = new SeedSet('种子A');
  s4.stream('loot').getUniform();                  // 先乱消耗 loot
  s4.stream('loot').getUniform();
  const t5 = s4.stream('terrain').getUniform();    // terrain 第一位

  ok('消耗 loot 流后 terrain 首值不变', t3 === t5, `${t3} vs ${t5}`);

  // 同理：消耗 terrain 也不该影响 village
  const s5 = new SeedSet('种子B');
  const v1 = s5.stream('village').getUniform();
  const s6 = new SeedSet('种子B');
  s6.stream('terrain').getUniform(); s6.stream('terrain').getUniform();
  ok('消耗 terrain 后 village 首值不变', v1 === s6.stream('village').getUniform());

  // 换主种子，terrain 必须变（否则说明流没隔离，等于同一条流）
  const s7 = new SeedSet('种子C');
  ok('不同主种子 terrain 首值不同',
     s7.stream('terrain').getUniform() !== new SeedSet('种子D').stream('terrain').getUniform());
}

console.log('\n[3] 存档：只存种子，不存世界');
{
  const payload = save();
  const keys = Object.keys(payload);
  ok('存档载荷只有 1 个键', keys.length === 1, `实际: ${keys}`);
  ok('该键是 seed', keys[0] === 'seed');

  // 重建流程：存 → 改种子 → 读回 → 应还原
  setMaster('原始种子');
  const before = fingerprint();
  const p = save();

  setMaster('别的种子');
  ok('换种子后指纹不同', fingerprint() !== before);

  load(p);
  ok('load 后指纹还原', fingerprint() === before, `${fingerprint()} != ${before}`);
  ok('load 后 master 还原', getMaster() === '原始种子');
}

console.log('\n[4] 字符串种子解析（老存档兼容）');
{
  ok('hashStr 确定性: 同串同值', hashStr('青石村') === hashStr('青石村'));
  ok('hashStr 区分大小写', hashStr('abc') !== hashStr('ABC'));
  ok('hashStr 区分中英文', hashStr('青石村') !== hashStr('QingShi'));
  ok('hashStr 返回 32 位无符号整数', (() => {
    const h = hashStr('测试');
    return Number.isInteger(h) && h >= 0 && h <= 0xFFFFFFFF;
  })());

  // 老存档兼容:无 seed 字段不能崩
  const legacyPayloads = [null, undefined, {}, { seed: null }, { seed: '' }, { seed: '   ' }];
  let noCrash = true;
  for (const p of legacyPayloads) {
    try { load(p); } catch (e) { noCrash = false; console.log('     崩溃于', JSON.stringify(p), e.message); }
  }
  ok('6 种老存档格式全部不崩溃', noCrash);
  ok('空/空白种子回退到默认值', getMaster() === '青石村', `实际: "${getMaster()}"`);
}

console.log('\n[5] 子流 API');
{
  const s = new SeedSet('X');
  const a1 = s.stream('terrain'), a2 = s.stream('terrain');
  ok('同一流返回同一实例(惰性缓存)', a1 === a2);
  ok('不同流返回不同实例', s.stream('terrain') !== s.stream('village'));

  let threw = false;
  try { s.stream('不存在的流'); } catch { threw = true; }
  ok('未知流名抛错', threw);

  s.reset('terrain');
  ok('reset 后重建实例', s.stream('terrain') !== a1);
}

console.log('\n[6] 同种子 → 同子流序列（可复现性）');
{
  const s1 = new SeedSet('可复现'), s2 = new SeedSet('可复现');
  let same = true;
  for (const name of STREAMS) {
    const r1 = s1.stream(name), r2 = s2.stream(name);
    for (let i = 0; i < 100; i++) {
      if (r1.getUniform() !== r2.getUniform()) { same = false; break; }
    }
  }
  ok('四条流各 100 个值全部一致', same);
}

console.log('\n[7] 浏览器环境模拟：rng() 走当前主种子');
{
  setMaster('当前种子');
  const a = rng('terrain').getUniform();

  setMaster('另一个种子');
  const b = rng('terrain').getUniform();
  ok('换主种子后 rng(terrain) 输出改变', a !== b, `${a} vs ${b}`);

  // 回到原种子：因 RNG 是惰性创建且未推进过，必须完全复现
  setMaster('当前种子');
  ok('回到原种子 rng(terrain) 复现', rng('terrain').getUniform() === a);

  setMaster('当前种子');   // 清掉上面的推进
  const x = rng('loot').getUniform();
  setMaster('当前种子');
  ok('同种子重置后 loot 也复现', rng('loot').getUniform() === x);
}

console.log(`\ntest-seed: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
if (fail) { failed.forEach(f => console.log('  失败: ' + f)); process.exit(1); }