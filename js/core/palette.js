// ===== 绘制色板(canvas 用) =====
// V0.99 · 工单 XX-PAL-003
//
// 为什么不能直接用 CSS 变量:
//   canvas 的 fillStyle / strokeStyle 读不了 var(--xxx) ——
//   那是在 canvas 上下文里取样式字符串,不是 CSS 层。
//   所以绘制色必须有一个 JS 侧的常量表。
//
// 色值与 css/palette.css 严格一致(改一处必须改两处,
// 由 tests/lint-palette.mjs 校验两边不许漂移)。

export const PAL = {
  // 墨阶
  ink:      '#080706',
  ink2:     '#131110',
  ink3:     '#1c1917',
  ink4:     '#2a2522',

  // 纸阶
  paper:      '#ece5d3',
  paperDim:   '#c9c0ab',
  paperFaint: '#8a8378',

  // 金(唯一亮点)
  gold:     '#c9a227',
  goldDim:  '#8a6f1c',

  // 朱砂 / 青玉
  cinnabar: '#8c3a2e',
  jade:     '#5a7a6a',

  // 语义例外
  hp:   '#7a2b24',
  qi:   '#3d6b7a',
  xp:   '#4a7a4e',
  crit: '#a03a2e',
};

// 常用语义别名 —— 写代码时用这些,不要直接写色值
export const C = {
  普通伤害: PAL.paperDim,
  暴击:     PAL.crit,
  联动:     PAL.jade,
  中毒:     PAL.paperFaint,
  墨色:     PAL.ink4,
  血量:     PAL.hp,
  灵力:     PAL.qi,
  经验:     PAL.xp,
  强调:     PAL.gold,
  危险:     PAL.cinnabar,
};

export default PAL;