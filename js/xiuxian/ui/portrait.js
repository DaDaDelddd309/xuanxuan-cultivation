// 立绘映射表 —— 工单 XX-AUDIT-005（ui.js 拆分时抽出的唯一一份）
//
// 为什么抽出来:
//   ① ui.js 里原本是模块级私有常量,vPeople() 一搬进 ui/bag.js 就引用不到了。
//   ② js/main.js 里本来还有一份**缩略版**(只有 hero / foe),那边的注释写着
//      「这里只取用到的几个,避免整个 ui 被拉进主循环」。
//      两份同名字的表在两个文件里,改一处忘一处就是另一处画错人 ——
//      这正是 lint-portraits.mjs 要盯的事,现在干脆让它没有第二份。
//
// V0.98 按人分图。四张卡原本全部落到 hero.jpg(CHARACTERS 没有 portrait 字段),
// 商人还复用 foe —— 一张图到处套。
export const PORTRAIT = {
  knight: 'assets/portrait/knight.jpg', mage: 'assets/portrait/mage.jpg',
  ranger: 'assets/portrait/ranger.jpg', white: 'assets/portrait/white.jpg',
  companion: 'assets/portrait/companion.jpg', momocha: 'assets/portrait/momocha.jpg',
  merchant: 'assets/portrait/merchant.jpg',
  foe: 'assets/portrait/villain-moying.jpg', hero: 'assets/portrait/knight.jpg', aunt: 'assets/portrait/companion.jpg',
};