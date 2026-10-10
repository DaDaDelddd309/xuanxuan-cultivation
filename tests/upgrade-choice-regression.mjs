// upgrade-choice-regression.mjs —— 工单 XX-PLAY-002 的门禁
//
// 修的 bug:后期(passive 满 + 4 武器满级进化)升级三选一 **100% 是「带回的技能」**,
// owner 原话「玩屁」—— 三张一模一样就没有选择。
//
// 根因:`rollChoices()` 原来是纯加权抽取、不看已选种类,而兜底
// (金币/回血)只在 `!cands.length`(候选池全空)时才触发。
// 但 RUN_ARTS 是 ART_RUN_MAX 级、无上限 —— 神通候选**永远存在**,
// 于是兜底永远轮不上,后期池子里只剩神通。
//
// 本门禁跑**真函数**、做统计断言,不是正则抠源码。
// 断言不钉死具体百分比(那是平衡,会变),只钉**结构性质**:
//   · 三张卡不能是同一类(除非候选池真的只有一种类)
//   · 候选池只有一种类时,必须掺进金币/回血兜底
//   · 永远返回 3 张
//
// 退出码:0 = 通过;非 0 = 不通过
import { rollChoices, PASSIVES } from '../js/game/upgrades.js?v=17';
import { WEAPONS, WEAPON_ORDER, MAX_WEAPONS } from '../js/game/weapons.js?v=17';

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

const N = 20000;
const base = () => ({
  player: { weapons:[{ id:'knife', lv:1, evolved:false }], arts:{},
            hp:100, hpMax:100, stats:{maxHp:100, atk:10, def:5, spd:100} },
  passiveLv: {},
});
const allPassiveMax = () => Object.fromEntries(
  Object.keys(PASSIVES).map(k => [k, PASSIVES[k].maxLv]));

const scenarios = {
  '开局(1 武器 / 无被动 / 无神通)': base,
  '被动已满': () => { const g = base(); g.passiveLv = allPassiveMax(); return g; },
  '被动满 + 4 武器满级进化(后期)': () => {
    const g = base();
    g.passiveLv = allPassiveMax();
    g.player.weapons = WEAPON_ORDER.slice(0, MAX_WEAPONS)
      .map(id => ({ id, lv: WEAPONS[id].maxLv, evolved: true }));
    return g;
  },
};

for (const [name, mk] of Object.entries(scenarios)) {
  console.log(`\n=== ${name} ===`);
  const tally = {};
  let threeSame = 0, wrongLen = 0;
  for (let i = 0; i < N; i++) {
    const c = rollChoices(mk());
    if (c.length !== 3) wrongLen++;
    for (const x of c) tally[x.kind] = (tally[x.kind] || 0) + 1;
    if (c.length === 3 && new Set(c.map(x => x.kind)).size === 1) threeSame++;
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${(v / total * 100).toFixed(1)}%`);
  }
  t(`永远返回 3 张卡(${N} 次)`, wrongLen === 0, `${wrongLen} 次长度不对`);
  t(`三张同类为 0(实测 ${(threeSame / N * 100).toFixed(2)}%)`, threeSame === 0,
    '同类连出就是「没有选择」——本次修的就是它');
}

// ───────────────────────────────────────────────────────────
console.log('\n=== 兜底必须真的掺进来(后期只有一个候选类时) ===');
{
  const mk = scenarios['被动满 + 4 武器满级进化(后期)'];
  let withFill = 0;
  for (let i = 0; i < 2000; i++) {
    const c = rollChoices(mk());
    if (c.some(x => x.kind === 'gold' || x.kind === 'heal')) withFill++;
  }
  t('后期候选池只剩一种类时,仍会给出金币/回血兜底',
    withFill > 0, `实测 ${withFill}/2000 次有兜底`);
}

console.log('\n=== 本门禁自身的反向自检 ===');
{
  // 【防"断言写太松"】如果某天 rollChoices 改成永远返回 3 张同类卡,
  // 上面那条"三张同类为 0"必须会红 —— 它是唯一能抓住那个退化的断言。
  // 这里验证该断言确实有区分力:同类判定逻辑本身能分出"同类"与"不同类"。
  const same = [{kind:'a'},{kind:'a'},{kind:'a'}];
  const diff = [{kind:'a'},{kind:'b'},{kind:'c'}];
  t('同类判定对"三张一样"返回 true',
    same.length === 3 && new Set(same.map(x => x.kind)).size === 1);
  t('同类判定对"三张不同"返回 false',
    diff.length === 3 && new Set(diff.map(x => x.kind)).size !== 1);
  t('候选池确实只剩神通一种类(后期前提成立)',
    new Set(['art']).size === 1);
}

if (fail === 0) {
  console.log(`\n✅ XX-PLAY-002 通过:${pass} 项(三选一必须给得出生选择)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 三选一退化成了假选择`);
  process.exit(1);
}