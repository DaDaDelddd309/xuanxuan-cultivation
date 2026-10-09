// ===== 双结局文案 · 唯一真源(XX-AUDIT-018)=====
//
// 技术债 P1-3:「奈何无人共」/「此生无悔」这对立结局在 spine.js 与
// tomb.js 各存一份,改文案要改两处,漏一处玩家就会看到
// 「墓里刻的是 A、结算弹的是 B」。
//
// 【为什么单独成文件,而不是直接从 tomb.js 读】
//   试过让 spine.js `import { WORDS } from './tomb.js'`,结果**把测试打红了**:
//     ReferenceError: document is not defined
//       at js/xiuxian/assets.js:68
//   依赖链是 tomb → story / index / items → assets,
//   而 assets.js 顶层就执行 `document.addEventListener(...)`。
//   tests/test-spine.mjs 只 mock 了 localStorage,直接被这条链带崩。
//
//   结论:**结局文案是纯数据,不该拖着半条 UI 依赖链走。**
//   抽成本文件后 spine.js 只多一条零依赖 import,测试无需加 mock。
//
// 【本次只统一了「结局名」】
//   spine.js 的结算赋值已改读本文件。
//   tomb.js 的 WORDS 仍保留完整叙事(note / after / path),
//   那部分语境独有(墓碑刻痕 vs 主线结算),**不是重复,不要合并**。
//   见 TICKETS XX-AUDIT-018 剩余部分。
//
// ⚠️ 改动结局名时记得同步 tomb.js 的 WORDS[].text。

export const OUTCOMES = {
  unlone: '奈何无人共',   // 补「共」这半 —— 有人一起走
  noless: '此生无悔',     // 补「悔」这半 —— 独自活下来
};

// 注:这里原本还导出过一个 `outcomeOf(which)` 取值函数。
// 新写完就被 lint-deadexport 判为死导出(0 引用),已删。
// 现状:spine.js 直接取 OUTCOMES[key] 并自己兜底,不需要额外包装。
// 若将来别处要用,再加回来即可 —— 别为了「可能有用」提前留着。