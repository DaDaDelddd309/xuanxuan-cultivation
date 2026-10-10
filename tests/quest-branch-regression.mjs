// 支线结局奖励分支化测试 —— 工单 XX-NET-003
// 运行: node tests/quest-branch-regression.mjs
//
// 背景:叙事线早就是真分支(`ARC_REWARD` 是 `[结局1, 结局2]`,
// `jiangu` 给 2000+玄源石 **vs** 2400+紫府源石,道行数字是交叉的),
// 但 8 条支线的 `reward` 全是**单一值** —— 两个结局给的东西完全一样,只换文案。
// 玩家二周目选了另一边,除了文案什么都没变,驱动力当场归零。
//
// 本工单把支线也改成真分支,`p1` 奖励**原样不动**(不动现有平衡),
// `p2` 换成不同类型的物品、语义对上该结局。
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

const { QUEST } = await import('../js/xiuxian/quest.js');
// LEGEND / LEGEND_LIST 的真源是 legend.js —— quest.js 只是 import 它们,
// 自己并不再导出。从错误的地方取会拿到 undefined(踩过一次)。
const { LEGEND, LEGEND_LIST } = await import('../js/xiuxian/legend.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d='') => { if (c) pass++; else { fail++; failed.push(n + (d?' :: '+d:'')); console.log(`  ❌ ${n} ${d}`); } };

// ————— 0. p1 原值:改动前的 8 条奖励,一个数字都不能动 —————
const P1_ORIGINAL = {
  hongyi:    { dao: 800,  scroll: 'scroll_2' },
  laolao:    { dao: 2400, scroll: 'scroll_3' },
  baize:     { dao: 0,    scroll: 'scroll_5' },
  dangkang:  { dao: 1600, scroll: 'scroll_4' },
  qingqiong: { dao: 6000, scroll: 'scroll_5' },
  jiangu:    { dao: 1800, scroll: 'scroll_3' },
  shijiang:  { dao: 2600, scroll: 'scroll_4' },
  dengshi:   { dao: 500,  scroll: 'scroll_1' },
};
for (const [k, exp] of Object.entries(P1_ORIGINAL)) {
  const q = LEGEND[k] && LEGEND[k].quest;
  ok(`${k}: 存在支线定义`, !!q);
  if (!q) continue;
  ok(`${k}: reward 已改成 [结局1, 结局2] 数组`, Array.isArray(q.reward) && q.reward.length === 2,
     `实测 ${Array.isArray(q.reward) ? q.reward.length + ' 项' : typeof q.reward}`);
  if (!Array.isArray(q.reward) || q.reward.length !== 2) continue;
  const p1 = q.reward[0];
  ok(`${k}: 结局一奖励与改动前逐字一致`, p1.dao === exp.dao && p1.scroll === exp.scroll,
     `实测 dao:${p1.dao} scroll:${p1.scroll},应为 dao:${exp.dao} scroll:${exp.scroll}`);
}

// ————— 1. 两个结局必须给**不同的东西**(这是本工单的全部意义) —————
for (const [k, q] of Object.entries(LEGEND)) {
  if (!q.quest || !Array.isArray(q.quest.reward)) continue;
  const [a, b] = q.quest.reward;
  const idOf = r => `${r.scroll || ''}|${r.item || ''}`;
  ok(`${k}: 两结局给的东西不同`, idOf(a) !== idOf(b),
     `两边都是 ${idOf(a)} —— 只换文案等于没有分支`);
}

// ————— 2. 结局二必须给「另一类」物品,而不是同一类多一本 —————
for (const [k, q] of Object.entries(LEGEND)) {
  if (!q.quest || !Array.isArray(q.quest.reward)) continue;
  const [a, b] = q.quest.reward;
  ok(`${k}: 结局一给功法、结局二给实物(或反之)`,
     (a.scroll && b.item) || (a.item && b.scroll),
     `p1=${JSON.stringify(a)} p2=${JSON.stringify(b)}`);
}

// ————— 3. 道行不得因分支而失衡:两结局差距控制在 25% 内 —————
for (const [k, q] of Object.entries(LEGEND)) {
  if (!q.quest || !Array.isArray(q.quest.reward)) continue;
  const [a, b] = q.quest.reward;
  const lo = Math.min(a.dao, b.dao), hi = Math.max(a.dao, b.dao);
  // 原来是 `path===2 ? +300 : 0`,已折进表里;基线 0 时不比倍率
  ok(`${k}: 两结局道行相差不超过 25%`, lo === 0 || (hi - lo) / lo <= 0.25,
     `${a.dao} vs ${b.dao}`);
}

// ————— 4. special 已提到 quest 层,且不再双算那 300 道行 —————
{
  const src = stripComments(readFileSync(ROOT + '/js/xiuxian/quest.js', 'utf8'));
  ok('special 不再从 reward 里读', !/reward\.special/.test(src),
     'reward 已是数组,读它必为 undefined');
  ok('special 从 quest 层读', /l\.quest\.special/.test(src));
  ok('grant 里那条 path===2?+300 已删除',
     !/dao\s*\+=\s*path\s*===\s*1\s*\?\s*0\s*:\s*300/.test(src),
     '还留着会对结局二双算 —— 已折进 reward 表');
  // 数据侧:special 确实在 quest 层
  for (const k of ['baize','dangkang','qingqiong','jiangu','shijiang']) {
    ok(`${k}: special 在 quest 层`, !!(LEGEND[k].quest.special),
       'special:' + LEGEND[k].quest.special);
  }
}

// ————— 5. grant() 两种形状都得认(数组 / 叙事线的单对象) —————
{
  const got1 = QUEST.grant([{ dao: 111 }, { dao: 222 }], 1, null);
  const got2 = QUEST.grant([{ dao: 111 }, { dao: 222 }], 2, null);
  ok('grant 认数组并按 path 取', got1.dao === 111 && got2.dao === 222,
     `p1=${got1.dao} p2=${got2.dao}`);
  const got3 = QUEST.grant({ dao: 333 }, 1, null);
  ok('grant 仍认单对象(叙事线 ARC_REWARD 走这条路)', got3.dao === 333,
     `实测 ${got3.dao}`);
}

// ————— 6. 接线契约:8 条支线一条都不能漏 —————
{
  const quests = LEGEND_LIST.filter(x => x.quest && x.quest.reward);
  ok('支线共 8 条', quests.length === 8, `实测 ${quests.length}`);
  const notArr = quests.filter(x => !Array.isArray(x.quest.reward) || x.quest.reward.length !== 2);
  ok('8 条全部改成分支', notArr.length === 0,
     '未改: ' + notArr.map(x => x.key).join(', '));
}

console.log(`\n支线结局分支: ${pass} 通过, ${fail} 失败`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);