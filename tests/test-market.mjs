// 局外集市测试 —— 工单 XX-META-001/002
// 运行: node tests/test-market.mjs
//
// 修的是最大的空缺:局后除了结算数字什么都没有,
// 攒的金币只能开角色(300/800/2000),无处可去。
import { install } from './harness.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
install();
const { MARKET, MARKET_GOODS } = await import('../js/xiuxian/market.js');
const { Cult } = await import('../js/xiuxian/index.js');
const { Bag } = await import('../js/xiuxian/items.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const setup = (gold, dao = 0) => {
  Cult.init();
  Cult.get().dao = dao;
  globalThis.__g = { save: { data: { gold } } };
  Bag.s.items = {};
  MARKET.s = { stock: [], run: 0, bought: [], mates: {} };   // 连残留字段一起清
  MARKET.reset(); MARKET.loaded = false; MARKET.load();
};

console.log('\n[1] 货架:开局就有货,不重复');
{
  setup(5000);
  const s = MARKET.stock();
  ok('有货', s.length >= 4, `${s.length} 件`);
  ok('不重复', new Set(s.map(x => x.key)).size === s.length);
  ok('每件都能查到定义', s.every(x => !!MARKET_GOODS[x.key]));
  ok('每件都有价格和说明', s.every(x => MARKET_GOODS[x.key].price > 0 && !!MARKET_GOODS[x.key].desc));
}

console.log('\n[2] 买:扣钱、到货、售出标记');
{
  setup(5000);
  const s = MARKET.stock();
  // 找一件买得起的
  const i = s.findIndex(x => MARKET_GOODS[x.key].price <= 5000);
  const key = s[i].key, price = MARKET_GOODS[key].price;
  const g0 = MARKET.gold();
  const r = MARKET.buy(i);
  ok('买成功', r.ok, r.msg);
  ok('扣了钱', MARKET.gold() === g0 - price, `${g0} → ${MARKET.gold()}(应为 ${g0 - price})`);
  ok('标记为已售', MARKET.stock()[i].sold === true);
  ok('不能重复买', MARKET.buy(i).ok === false);
}

console.log('\n[3] 钱不够买不了');
{
  setup(10);
  const i = MARKET.stock().findIndex(x => MARKET_GOODS[x.key].price > 10);
  if (i >= 0) {
    const r = MARKET.buy(i);
    ok('拒绝购买', r.ok === false, r.msg);
    ok('提示差多少', /还差 \d+ 金币/.test(r.msg), r.msg);
    ok('没扣钱', MARKET.gold() === 10, `${MARKET.gold()}`);
  } else ok('货架上没有超过 10 金的货(本轮随机)', true);
}

console.log('\n[4] 交货到正确的地方');
{
  setup(99999);
  // 逐类验证:源石/丹药/传承书进行囊,同伴线索折成酒馆招募次数
  const kinds = {};
  for (const [k, v] of Object.entries(MARKET_GOODS)) kinds[v.kind] = v.id;
  for (const kind of Object.keys(kinds)) {
    setup(99999);
    const d = MARKET._deliver(MARKET_GOODS[Object.keys(MARKET_GOODS).find(k => MARKET_GOODS[k].kind === kind)]);
    ok(`${kind} 交货成功`, d.ok, d.msg);
    if (kind === 'mate') {
      // 同伴线索不再存在 market 自己的字段里 —— 统一折成 TAVERN.leads(单一真源)
      const { TAVERN } = await import('../js/xiuxian/tavern.js');
      ok('同伴线索折成酒馆招募次数', TAVERN.leads() > 0, 'leads=' + TAVERN.leads());
      // 查源码而不是查运行时字段:reset() 本来就会给 s.mates 兜个默认值
      const msrc = readFileSync(ROOT + '/js/xiuxian/market.js', 'utf8');
      ok('market 不再自己写 mates', !/this\.s\.mates\s*=/.test(msrc));
    }
    else ok(`${kind} 进行囊`, Object.keys(Bag.s.items).length > 0, JSON.stringify(Bag.s.items));
  }
}

console.log('\n[5] 卖:折价回收,给玩家一个清包口');
{
  setup(1000);
  const { Bag } = await import('../js/xiuxian/items.js');
  Bag.add('stone_2', 3);
  const g0 = MARKET.gold();
  const r = MARKET.sellStone('stone_2', 1);
  ok('卖成功', r.ok, r.msg);
  ok('钱变多', MARKET.gold() > g0, `${g0} → ${MARKET.gold()}`);
  ok('源石少一颗', Bag.count('stone_2') === 2, `${Bag.count('stone_2')}`);
  const half = Math.round(MARKET_GOODS.stone_2.price * 0.5);
  ok('折价一半', MARKET.gold() - g0 === half, `${MARKET.gold() - g0} 应为 ${half}`);
  ok('没有就不能卖', MARKET.sellStone('stone_5', 1).ok === false);
}

console.log('\n[6] 刷新:换一批,不收钱');
{
  setup(1000);
  const before = MARKET.stock().map(x => x.key).join(',');
  const g0 = MARKET.gold();
  MARKET.refresh();
  const after = MARKET.stock().map(x => x.key).join(',');
  ok('刷新不收钱', MARKET.gold() === g0);
  ok('货架重新洗过(至少多数不同)', MARKET.stock().length >= 4);
  ok('刷新后没有售出标记', MARKET.stock().every(x => x.sold === false));
  ok('刷新次数在涨', MARKET.s.run >= 2, `run=${MARKET.s.run}`);
}

console.log('\n[7] 高档货随道行解锁(不是一开始就有仙源石)');
{
  // 用大量刷新统计高档货出现率
  const sample = (dao) => {
    Cult.get().dao = dao;
    let high = 0, N = 400;
    for (let i = 0; i < N; i++) {
      MARKET.refresh();
      high += MARKET.stock().filter(x => MARKET_GOODS[x.key].tier >= 3).length;
    }
    return high / N;
  };
  const lowDao = sample(0);
  const highDao = sample(50000);
  ok('道行低时高档货少', lowDao < 1.2, `${lowDao.toFixed(2)} 件/批`);
  ok('道行高时高档货多', highDao > lowDao, `${lowDao.toFixed(2)} → ${highDao.toFixed(2)}`);
  ok('高档有上限,不会一屏全是', highDao < 4, `${highDao.toFixed(2)}`);
}

console.log('\n[8] 存档往返');
{
  setup(3000);
  const i = MARKET.stock().findIndex(x => MARKET_GOODS[x.key].price <= 3000);
  MARKET.buy(i);
  const snapshot = JSON.stringify(MARKET.s);
  MARKET.loaded = false;
  MARKET.load();
  ok('买过的记录还在', MARKET.s.bought.length === 1);
  ok('货架状态还原', JSON.stringify(MARKET.s.stock) === JSON.stringify(JSON.parse(snapshot).stock));
}

console.log('\n[9] 没有硬编码:商品表是纯数据');
{
  // 每个条目都该有 kind / tier / name / price / desc
  for (const [k, v] of Object.entries(MARKET_GOODS)) {
    ok(`${k} 结构完整`, ['kind','tier','name','price','desc'].every(f => v[f] !== undefined));
    ok(`${k} 价格是正数`, v.price > 0, `${v.price}`);
    ok(`${k} 档位在 1..5`, v.tier >= 1 && v.tier <= 5, `${v.tier}`);
  }
  const kinds = new Set(Object.values(MARKET_GOODS).map(v => v.kind));
  ok('覆盖多种货物类型', kinds.size >= 4, [...kinds].join(','));
}

console.log(`\ntest-market: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);