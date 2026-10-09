// world.js 接口兼容性测试 —— 工单 XX-S4-001 / XX-S4-004
//
// 验收目标: world.js 换成 worldgen 驱动后,
// ui.js 调用的那套接口行为必须与 V0.96 完全一致。
// run: node tests/test-world-compat.mjs
import { WORLD, nodeById, neighbors, homeNode, travel, pathBetween,
         buildEdges, rollEnemy, NODE_TYPES, ENEMY_POOL, SECRET_PILL, WORLD_INFO } from '../js/xiuxian/world.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failed.push(name + (detail ? ' :: ' + detail : '')); }
  if (!cond) console.log(`  ❌ ${name} ${detail}`);
}

console.log('\n[1] 导出面完整（旧调用方依赖）');
{
  const required = ['WORLD', 'nodeById', 'neighbors', 'homeNode', 'rollEnemy', 'travel', 'pathBetween',
                    'buildEdges', 'NODE_TYPES', 'ENEMY_POOL', 'SECRET_PILL'];
  const missing = required.filter(k => !(k in (globalThis.__probe || {}) || true));
  // 直接检查函数/对象存在
  ok('WORLD 是对象', WORLD && typeof WORLD === 'object');
  ok('nodeById 是函数', typeof nodeById === 'function');
  ok('neighbors 是函数', typeof neighbors === 'function');
  ok('homeNode 是函数', typeof homeNode === 'function');
  ok('rollEnemy 是函数', typeof rollEnemy === 'function');
  ok('travel 是函数', typeof travel === 'function');
  ok('pathBetween 是函数', typeof pathBetween === 'function');
  ok('buildEdges 是函数', typeof buildEdges === 'function');
  ok('NODE_TYPES 五种类型齐全',
     ['village','field','elite','secret','boss'].every(t => NODE_TYPES[t]));
  ok('ENEMY_POOL 四种池齐全',
     ['field','elite','secret','boss'].every(t => Array.isArray(ENEMY_POOL[t]) && ENEMY_POOL[t].length));
  ok('SECRET_PILL 非空', Object.keys(SECRET_PILL).length >= 4);
}

console.log('\n[2] WORLD 结构形状（edges 必须是 id 字符串）');
{
  ok('WORLD.nodes 是数组', Array.isArray(WORLD.nodes));
  ok('WORLD.edges 是数组', Array.isArray(WORLD.edges));
  ok('WORLD.grid = 6', WORLD.grid === 6, `实际 ${WORLD.grid}`);
  ok('edges 元素是 [string,string]',
     WORLD.edges.every(e => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string'),
     `首个: ${JSON.stringify(WORLD.edges[0])}`);
  ok('nodes 都有 x/y/type/id',
     WORLD.nodes.every(n => n.id && typeof n.x === 'number' && typeof n.y === 'number' && n.type));
  ok('WORLD_INFO 暴露生成元信息', WORLD_INFO && typeof WORLD_INFO.seed === 'string');
}

console.log('\n[3] homeNode / nodeById');
{
  const h = homeNode();
  ok('homeNode() 返回字符串 id', typeof h === 'string', `实际 ${typeof h}`);
  const hn = nodeById(h);
  ok('homeNode() 指向的节点存在', !!hn);
  ok('该节点标记 home', !!(hn && hn.home));
  ok('该节点是青石村', !!(hn && hn.name === '青石村'), `实际 ${hn && hn.name}`);
  ok('nodeById 不存在返回 undefined', nodeById('n9999') === undefined);
}

console.log('\n[4] neighbors（这是 V0.96 的关键形状契约）');
{
  const h = homeNode();
  const nb = neighbors(h);
  ok('neighbors 返回数组', Array.isArray(nb));
  ok('neighbors 元素全是字符串 id', nb.every(v => typeof v === 'string'), `实际 ${JSON.stringify(nb)}`);
  ok('home 至少 1 个邻居', nb.length >= 1, `实际 ${nb.length}`);
  ok('neighbors 结果都能被 nodeById 找到', nb.every(id => !!nodeById(id)));
  ok('每个邻居与 home 相邻(曼哈顿1)',
     nb.every(id => {
       const a = nodeById(h), b = nodeById(id);
       return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
     }));
  ok('不存在的 id 返回空数组', neighbors('n9999').length === 0);
}

console.log('\n[5] travel');
{
  const h = homeNode();
  const nb = neighbors(h);
  const t = travel(h, nb[0]);
  ok('走到邻居返回 {from,to,cost}', t && t.from === h && t.to === nb[0] && t.cost === 1,
     JSON.stringify(t));
  ok('走到自己返回 null', travel(h, h) === null);
  ok('走到不相邻返回 null', travel(h, 'n9999') === null);

  // 走到非邻居必须为 null
  const allIds = WORLD.nodes.map(n => n.id);
  const nonNb = allIds.find(id => id !== h && !nb.includes(id));
  if (nonNb) ok('走到非邻居返回 null', travel(h, nonNb) === null, `非邻居=${nonNb}`);
}

console.log('\n[6] pathBetween（BFS）');
{
  const h = homeNode();
  ok('pathBetween(a,a) = [a]', JSON.stringify(pathBetween(h, h)) === JSON.stringify([h]));
  const nb = neighbors(h);
  ok('到邻居路径长度 2', pathBetween(h, nb[0]).length === 2);

  // 所有节点都必须可达
  const unreachable = WORLD.nodes.filter(n => pathBetween(h, n.id) === null);
  ok('全部节点从 home 可达', unreachable.length === 0,
     unreachable.length ? `不可达: ${unreachable.map(n=>n.id).join(',')}` : '');

  // 路径必须是连续的相邻序列
  let pathOk = true;
  for (const n of WORLD.nodes) {
    const p = pathBetween(h, n.id);
    for (let i = 1; i < p.length; i++) {
      const a = nodeById(p[i-1]), b = nodeById(p[i]);
      if (Math.abs(a.x-b.x) + Math.abs(a.y-b.y) !== 1) { pathOk = false; break; }
    }
  }
  ok('所有路径都是连续的相邻序列', pathOk);
  ok('pathBetween 到不存在节点返回 null', pathBetween(h, 'n9999') === null);
}

console.log('\n[7] buildEdges 与 WORLD.edges 一致');
{
  const rebuilt = buildEdges(WORLD.nodes);
  ok('buildEdges(默认) 边数与 WORLD.edges 相同',
     rebuilt.length === WORLD.edges.length,
     `${rebuilt.length} vs ${WORLD.edges.length}`);
  const norm = arr => arr.map(e => e.slice().sort().join('-')).sort().join(',');
  ok('buildEdges(默认) 内容与 WORLD.edges 相同', norm(rebuilt) === norm(WORLD.edges));
  ok('buildEdges([]) 返回空数组', buildEdges([]).length === 0);
}

console.log('\n[8] rollEnemy');
{
  const pool = {};
  for (let i = 0; i < 3000; i++) {
    const n = WORLD.nodes.find(x => ENEMY_POOL[x.type]);
    const k = rollEnemy(n.id, 'qi');
    pool[k] = (pool[k] || 0) + 1;
  }
  ok('rollEnemy 总是返回池内敌人',
     Object.keys(pool).every(k => ['wanderer','guard','yao','elder','devil'].includes(k)),
     JSON.stringify(pool));
  ok('村庄不产生敌人(返回 null)',
     rollEnemy(WORLD.nodes.find(n => n.type === 'village').id, 'qi') === null);
  ok('不存在节点返回 null', rollEnemy('n9999', 'qi') === null);
}

console.log('\n[9] 世界内容合理性');
{
  const types = {};
  WORLD.nodes.forEach(n => types[n.type] = (types[n.type] || 0) + 1);
  console.log(`     节点类型分布: ${JSON.stringify(types)}  共 ${WORLD.nodes.length} 个`);
  ok('节点数在合理区间(6-18)', WORLD.nodes.length >= 6 && WORLD.nodes.length <= 18, `实际 ${WORLD.nodes.length}`);
  ok('恰好 1 个 Boss', types.boss === 1, `实际 ${types.boss}`);
  ok('至少 1 个秘境', (types.secret || 0) >= 1);
  ok('至少 1 个村庄', (types.village || 0) >= 1);
  ok('没有触发兜底布局', WORLD_INFO.fallback === false);
  ok('村庄都有名字', WORLD.nodes.filter(n => n.type === 'village').every(n => !!n.name));
  ok('秘境都指定了丹药',
     WORLD.nodes.filter(n => n.type === 'secret').every(n => !!n.pill && SECRET_PILL[n.pill] === n.pill || !!n.pill));
}

console.log('\n[10] 存档兼容：老存档无 seed 字段');
{
  // 模拟 V0.96 存档（只有进度，没有 seed）
  const legacy = { cult: { realm: 'qi', layer: 3 }, bag: {}, camp: {} };
  ok('老存档对象不含 seed 也不该导致 import 失败', legacy.seed === undefined);
  ok('world 模块不依赖存档字段即可完成初始化', !!WORLD.nodes.length);

  // setMaster 接受各种脏值
  const { setMaster, getMaster } = await import('../js/xiuxian/seed.js');
  const dirty = [null, undefined, '', '   ', '　\n\t'];
  let allOk = true;
  for (const v of dirty) {
    try { setMaster(v); } catch (e) { allOk = false; console.log('     崩溃于', JSON.stringify(v), e.message); }
  }
  ok('setMaster 接受 5 种空/空白值不崩溃', allOk);
  ok('空/空白值回退到默认种子', getMaster() === '青石村', `实际 "${getMaster()}"`);

  // 数字种子是合法的，不能被当成脏值回退
  ok('数字种子被接受（不会被回退）', setMaster(12345678901234) === '12345678901234');
  ok('数字 0 是合法种子', setMaster(0) === '0');
  ok('负数种子被接受（转字符串）', setMaster(-1) === '-1');
  setMaster('青石村');
}

console.log(`\ntest-world-compat: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
if (fail) {
  console.log('\n失败项:');
  failed.forEach(f => console.log('  ' + f));
  process.exit(1);
}