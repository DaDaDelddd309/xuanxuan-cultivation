// tests/lint-tune-floor.mjs —— 相对倍率不得为 0(除「显式关闭」语义之外)
// 运行: node tests/lint-tune-floor.mjs
//
// 背景(2026-10-11 实测并已上线):
//   NODE_TUNING.village.loot 写成 { gemBias: 0, coinBias: 0 }。
//   这套代码里 loot / spawn 的值是**相对倍率**(runcfg.js 开头自己写着
//   「数值是『相对倍率』,不是绝对值」),所以 0 意味着「乘 0」——
//   而青石村是固定起点(worldgen),于是从村庄出发的第一局
//   372 只怪、总经验 0、总铜钱 0,无法升级。
//   该 bug 随 XX-LINK-001 一起上线(xuanxuan-v099s / build 20261011-0120)。
//
//   为什么 90+ 门禁一条都没拦住:它们验的都是「接线对不对」,
//   没有一条验过「倍率取值合不合法」。
//   数据写错、逻辑正确 —— 这类缺陷只有直接读值才能发现。
//
// ★ 豁免必须**按节点 + 按键**,不能按组豁免。
//   同一个「0」在两处含义相反:
//       spawn.eliteRate: 0  → 「村庄不刷精英」   ← 有意的关闭
//       loot.gemBias: 0     → 「一颗宝石都不给经验」 ← 笔误
//   第一版若按组豁免,village.spawn 整组放过,loot.gemBias 会被一起放过。
//   所以白名单逐条写理由,且反向注入必须覆盖「误豁免」这一面。

import { NODE_TUNING, DEFAULT_TUNING } from '../js/xiuxian/runcfg.js';

// 有「关闭」语义的倍率:该节点有意为之,不是笔误
const ALLOW_ZERO = {
  'village.spawn.eliteRate': '村庄不刷精英 —— 本意',
};

let bad = 0;
const all = { ...DEFAULT_TUNING, ...NODE_TUNING };

// 自检:门禁自身失效时必须明说,不能输出「全部合法」
if (!Object.keys(all).length) {
  console.log('  ❌ 没读到任何节点配置 —— 门禁自身失效,别信结论');
  process.exit(2);
}

let checked = 0;
for (const [name, cfg] of Object.entries(all)) {
  for (const group of ['spawn', 'loot']) {
    for (const [k, v] of Object.entries(cfg[group] || {})) {
      if (typeof v !== 'number') continue;
      checked++;
      const id = `${name}.${group}.${k}`;
      if (v !== 0) continue;
      if (ALLOW_ZERO[id]) { console.log(`  ⚠️  ${id} = 0 —— 白名单豁免:${ALLOW_ZERO[id]}`); continue; }
      bad++;
      console.log(`  ❌ ${id} = 0`);
      console.log(`       相对倍率乘 0 = 该项产出恒为 0。`);
      console.log(`       若确实要「关闭」,请把理由加进本文件的 ALLOW_ZERO 并写明它怎么表达。`);
    }
  }
}
console.log(bad
  ? `\n为 0 的相对倍率:${bad} 处`
  : `✅ ${Object.keys(all).length} 个节点 / ${checked} 个倍率取值全部合法`);
process.exit(bad ? 1 : 0);
