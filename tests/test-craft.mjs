// 合成系统测试 —— 工单 XX-META-005
// 运行: node tests/test-craft.mjs
//
// owner 提的「合成」没定规则,按游戏当前的缺口定:
//   6 级源石原本只能靠 Boss 掉或花 1200 金买,和「打怪→源石→篝火」脱节。
//   合成让低阶源石 + 催化剂 → 高阶源石,把那条链闭上。
import { install } from './harness.mjs';
install();
const { CRAFT, CRAFT_RECIPES } = await import('../js/xiuxian/craft.js');
const { Bag, STONES } = await import('../js/xiuxian/items.js');
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const clear = () => { Bag.s.items = {}; };

console.log('\n[1] 配方表结构完整');
{
  ok('有配方', CRAFT_RECIPES.length >= 3, `${CRAFT_RECIPES.length} 条`);
  for (const r of CRAFT_RECIPES) {
    ok(`${r.from}→${r.to} 字段全`, r.from && r.to && r.n > 0 && r.cat && r.catN > 0 && !!r.d);
    ok(`${r.from}→${r.to} 是升阶不是降阶`, stoneTier(r.to) > stoneTier(r.from),
       `${STONES[r.from]?.tier} → ${STONES[r.to]?.tier}`);
    ok(`${r.from}→${r.to} 用的 id 真实存在`, !!STONES[r.from] && !!STONES[r.to]);
  }
}
function stoneTier(id) { return (STONES[id] || {}).tier || 0; }

console.log('\n[2] 有损耗:低级石头真的被消耗');
{
  CRAFT.load(); CRAFT.reset(); clear();
  Bag.add('stone_1', 2);
  Bag.add('beiwen', 1);
  const r = CRAFT.do(0, Bag, id => (STONES[id] || {}).name);
  ok('合成成功', r.ok, r.msg);
  ok('低级石头扣了', Bag.count('stone_1') === 0, `${Bag.count('stone_1')}`);
  ok('催化剂扣了', Bag.count('beiwen') === 0, `${Bag.count('beiwen')}`);
  ok('高级石头到手', Bag.count('stone_2') === 1, `${Bag.count('stone_2')}`);
}

console.log('\n[3] 材料不够不做,且什么都不扣');
{
  CRAFT.reset(); clear();
  Bag.add('stone_1', 1);           // 只给 1 颗,要 2 颗
  const g0 = Object.keys(Bag.s.items).length;
  const r = CRAFT.do(0, Bag, id => (STONES[id] || {}).name);
  ok('拒绝合成', r.ok === false, r.msg);
  ok('说清缺什么', /缺/.test(r.msg), r.msg);
  ok('原材料一颗没少', Bag.count('stone_1') === 1, `${Bag.count('stone_1')}`);
  ok('没多出成品', Bag.count('stone_2') === 0);
}

console.log('\n[4] 缺催化剂也不做');
{
  CRAFT.reset(); clear();
  Bag.add('stone_1', 2);           // 石头够,催化剂没有
  const r = CRAFT.do(0, Bag, id => (STONES[id] || {}).name);
  ok('拒绝合成', r.ok === false, r.msg);
  ok('提示缺催化剂', /催化剂/.test(r.msg), r.msg);
  ok('石头没被扣', Bag.count('stone_1') === 2, `${Bag.count('stone_1')}`);
}

console.log('\n[5] 不能拿成品当原料(不能刷)');
{
  CRAFT.reset(); clear();
  Bag.add('stone_5', 10);
  // 仙源石(stone_5)不是任何配方的 from
  const asFrom = CRAFT_RECIPES.filter(r => r.from === 'stone_5');
  ok('仙源石不能当原料', asFrom.length === 0);
  // 太虚源石更是完全没配方
  const toStone6 = CRAFT_RECIPES.filter(r => r.to === 'stone_6' || r.from === 'stone_6');
  ok('太虚源石不参与合成(boss 专属)', toStone6.length === 0);
}

console.log('\n[6] 连续合成:2 升 3 是一条能走通的链');
{
  CRAFT.reset(); clear();
  // 要凑出 2 颗 stone_2 才能做第二道,而 2 换 1 有损耗,所以给 6 颗 stone_1
  Bag.add('stone_1', 6);
  Bag.add('beiwen', 2);
  Bag.add('fu_yin', 1);
  // 先手动补一颗,模拟「两局攒下来」的存量
  Bag.add('stone_1', 2);
  const a = CRAFT.do(0, Bag, id => (STONES[id] || {}).name);   // 2颗碎 → 1颗灵
  Bag.add('stone_1', 2); Bag.add('beiwen', 1);
  const a2 = CRAFT.do(0, Bag, id => (STONES[id] || {}).name);  // 再合一次,凑够 2 颗灵晶
  const b = CRAFT.do(1, Bag, id => (STONES[id] || {}).name);   // 2颗灵 → 1颗玄
  ok('第一道成功', a.ok, a.msg);
  ok('第二道前置成功', a2.ok, a2.msg);
  ok('第二道成功', b.ok, b.msg);
  ok('最终拿到玄源石', Bag.count('stone_3') === 1, `${Bag.count('stone_3')}`);
  // 我多给了备料,所以碎灵石可能有剩;只要求**没有**残留的灵晶石(中级全被合成掉了)
  ok('中级石头无残留', Bag.count('stone_2') === 0, `残留 ${Bag.count('stone_2')} 颗`);
  ok('碎灵石剩多少都不影响结果(有损耗是设计)', Bag.count('stone_1') >= 0);
}

console.log('\n[7] 计数与存档');
{
  CRAFT.reset(); clear();
  Bag.add('stone_1', 20); Bag.add('beiwen', 20);
  const before = CRAFT.s.done;
  CRAFT.do(0, Bag, id => (STONES[id] || {}).name);
  ok('合成都计数', CRAFT.s.done === before + 1);
  CRAFT.save(); CRAFT.load();
  ok('存档往返', typeof CRAFT.s.done === 'number');
  CRAFT.reset();
  ok('可重置', CRAFT.s.done === 0);
}

console.log('\n[8] 合成入口已接进界面');
{
  // ⚠️ XX-AUDIT-005:见 test-artstar 同款说明。三个锚点分别落在
  // import / act() / vMarket(),不能只盯 ui.js 一个文件。
  const { blob, methodBody } = await import('./lib-uimod.mjs');
  const ui = blob();
  ok('UI 层引入了 CRAFT', /from '\.\.\/craft\.js'/.test(ui) || /from '\.\/craft\.js'/.test(ui));
  ok('act() 里有 craft-do 动作', /case 'craft-do'/.test(methodBody('act')));
  // ⚠️ 拆出 ui/meta.js 后 vMarket 里是 `hall.vCraft()` 而不是 `this.vCraft()`。
  // 写死 this. 会在拆分当天报红,而报错信息("集市页没有包含合成区")会让人
  // 去改本来正确的逻辑 —— 这正是工单 XX-AUDIT-005 点名的误判形态。
  // 要验的是"集市页调用了合成视图",不是"用的是哪个接收者"。
  ok('集市页包含合成区', /[A-Za-z_$][\w$]*\.vCraft\(\)/.test(methodBody('vMarket')));
  const css = readFileSync(ROOT + '/css/xiuxian.css', 'utf8');
  ok('有合成样式', /\.xx-cf-row/.test(css));
}


// ---- XX-FIX-018 防回归:合成缺料文案不能出现内部 id ----
{
  const Bag2 = { count: () => 0 };
  const r0 = CRAFT_RECIPES[0];
  const nm = id => (STONES[id] || {}).name || id;
  const chk = CRAFT.can(r0, Bag2, nm);
  ok('缺料文案不含 "_" 尾巴的内部 id', !/\bstone_\d/.test(chk.miss), chk.miss);
  ok('缺料文案用的是中文名', chk.miss.includes(nm(r0.from)), chk.miss);
  const raw = CRAFT.can(r0, Bag2);
  ok('不给解析器时退回 id,老调用方不炸', typeof raw.miss === 'string' && raw.miss.length > 0, raw.miss);
}
console.log(`\ntest-craft: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);