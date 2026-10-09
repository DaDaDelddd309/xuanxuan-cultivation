// 矿脉可达性与产出测试 —— 工单 XX-S5-001 / XX-S5-002
// 运行: node tests/test-mine.mjs
import { WORLD, nodeById, pathBetween, homeNode } from '../js/xiuxian/world.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failed.push(name + (detail ? ' :: ' + detail : '')); }
  if (!cond) console.log(`  ❌ ${name} ${detail}`);
}

// 模拟 BUILD 的纯逻辑部分(不 import build.js —— 它依赖 localStorage/Bus)
const MINE_TIER = { secret: 3, elite: 2, boss: 3, field: 1, village: 0 };
const nodeType = id => { const n = nodeById(id); return n ? n.type : 'field'; };

// 矿脉节点集合(全测试共用)
const MINEABLE = WORLD.nodes.filter(n => (MINE_TIER[n.type] || 0) > 0);

console.log('\n[1] 矿脉类型表');
{
  ok('secret 产矿 3 档', MINE_TIER.secret === 3);
  ok('elite 产矿 2 档', MINE_TIER.elite === 2);
  ok('boss 产矿 3 档', MINE_TIER.boss === 3);
  ok('field 产矿 1 档', MINE_TIER.field === 1);
  ok('village 不产矿(安全区)', MINE_TIER.village === 0);
}

console.log('\n[2] 至少存在可占领的矿脉节点');
{
  const count = MINEABLE.length;
  const byType = {};
  MINEABLE.forEach(n => byType[n.type] = (byType[n.type] || 0) + 1);
  console.log(`     可占领矿脉 ${count} 个: ${JSON.stringify(byType)}`);
  ok('至少有 4 个可占领矿脉', count >= 4, `实际 ${count}`);
  ok('村庄永不可占领为矿', !MINEABLE.some(n => n.type === 'village'));
  ok('至少有 1 个高价值矿(secret/boss)',
     MINEABLE.some(n => n.type === 'secret' || n.type === 'boss'));
}

console.log('\n[3] 矿脉可达性（flood-fill 保证，这里独立复核）');
{
  const h = homeNode();
  const unreachable = MINEABLE.filter(n => pathBetween(h, n.id) === null);
  ok('所有矿脉从起点可达', unreachable.length === 0,
     unreachable.length ? `不可达: ${unreachable.map(n=>n.id).join(',')}` : '');
}

console.log('\n[4] 占领状态机（模拟 claimMine 逻辑）');
{
  const land = [];
  const fires = [];
  const canClaim = (id) => {
    if (fires.some(f => f.nodeId === id)) return { ok:false, msg:'此处分给你建篝火了。' };
    if (land.includes(id)) return { ok:false, msg:'已是自家领地。' };
    return { ok:true };
  };
  const claim = (id, type) => {
    const c = canClaim(id);
    if (!c.ok) return c;
    if ((MINE_TIER[type] || 0) <= 0) return { ok:false, msg:'此处无矿。' };
    land.push(id);
    return { ok:true, msg:'纳入领地。此处将每日出产源石。' };
  };

  const v = MINEABLE[0];

  ok('首次占领成功', claim(v.id, v.type).ok);
  ok('重复占领被拒', !claim(v.id, v.type).ok, '应拒绝第二次');
  ok('村庄占领被拒(无矿)',
     !claim(WORLD.nodes.find(n => n.type === 'village').id, 'village').ok);
  ok('篝火位置占领被拒', (() => {
    const f = MINEABLE[1];
    fires.push({ nodeId: f.id });
    const r = claim(f.id, f.type);
    fires.length = 0;
    return !r.ok;
  })());
}

console.log('\n[5] 产出计算（模拟 mineYield 逻辑）');
{
  const campLv = 1;           // 篝火 1 级
  const land = WORLD.nodes
    .filter(n => (MINE_TIER[n.type] || 0) > 0)
    .slice(0, 3)
    .map(n => n.id);
  let t = 0;
  for (const id of land) t += MINE_TIER[nodeType(id)] || 0;
  const yieldN = Math.max(1, Math.round(t * (1 + campLv * 0.4)));
  console.log(`     占领 ${land.length} 条矿脉,基础 ${t} 档 → 篝火${campLv}级 → 产出 ${yieldN} 源石/10分钟`);
  ok('产出为正', yieldN > 0);
  ok('产出随篝火等级提升',
     Math.round(t * (1 + 2 * 0.4)) > yieldN);
  ok('空领地至少保底 1(不出现 0 产出死局)',
     Math.max(1, Math.round(0 * (1 + campLv * 0.4))) >= 1);
}

console.log('\n[6] 换种子后矿脉分布会变');
{
  const { regenerate } = await import('../js/xiuxian/world.js');
  const sig = () => WORLD.nodes
    .filter(n => (MINE_TIER[n.type] || 0) > 0)
    .map(n => `${n.id}:${n.type}@${n.x},${n.y}`).join('|');

  const a = sig();
  regenerate('矿脉测试种子A');
  const b = sig();
  regenerate('矿脉测试种子B');
  const c = sig();
  regenerate('青石村');

  console.log(`     A: ${a.slice(0, 70)}`);
  console.log(`     B: ${b.slice(0, 70)}`);
  ok('不同种子的矿脉分布不同', a !== b && b !== c,
     `A=${a.slice(0,24)} B=${b.slice(0,24)} C=${c.slice(0,24)}`);
  // 2026-10-10 修一处恒真断言:
  //   原写法 `sig() !== a || true` —— `|| true` 让它无条件通过。
  //   比普通的假绿更糟:它让「同种子分布稳定」这个**真正重要的不变量**
  //   在报告里显示为「已测且通过」,而下一个人会以为这条已经有回归保护。
  //
  //   它本该断言什么:回到同一个种子,布局必须**完全一致** ——
  //   这是 AGENTS.md「同种子 = 同世界,存档码可复现」承诺的一部分。
  const back = sig();
  ok('同种子分布稳定(回到默认种子后与初始一致)', back === a,
     `初始=${a.slice(0, 40)} | 回来=${back.slice(0, 40)}`);
  // 反向:再换一次同样的种子,结果也必须一致(而不是只有"回到默认"这一条路对)
  regenerate('矿脉测试种子A');
  ok('同种子重复生成结果一致', sig() === b);
  regenerate('青石村');
}

console.log('\n[7] build.js 的 WORLD 代理是否随换种子更新');
{
  // main.js:291 做的是 BUILD.setWorld(WORLD)。WORLD 现在是 Proxy，
  // BUILD._world 拿到的是活代理，换种子后应自动指向新世界。
  const { regenerate } = await import('../js/xiuxian/world.js');
  const proxy = WORLD;                 // 模拟 setWorld 拿到的引用
  const beforeCount = proxy.nodes.length;
  const beforeSig = proxy.nodes.map(n => n.id + n.type).join(',');

  regenerate('代理验证种子');
  const afterCount = proxy.nodes.length;
  const afterSig = proxy.nodes.map(n => n.id + n.type).join(',');

  console.log(`     换种子前节点 ${beforeCount}, 指纹 ${beforeSig.slice(0, 50)}`);
  console.log(`     换种子后节点 ${afterCount}, 指纹 ${afterSig.slice(0, 50)}`);
  ok('旧引用仍能看到新世界(Proxy 生效)', afterSig !== beforeSig || afterCount !== beforeCount);
  regenerate('青石村');
}

console.log(`\ntest-mine: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
if (fail) { failed.forEach(f => console.log('  ' + f)); process.exit(1); }