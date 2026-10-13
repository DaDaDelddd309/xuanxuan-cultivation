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
  // ── 六位反派专属立绘(XX-AUDIT-011)───────────────────────────
  // 这 6 张**早就画好了**,却因为下面这行注释的判断而从未被引用:
  //   「立绘:仓库里独立立绘只有 8 张……所以反派只能用 foe/momocha/
  //     merchant/companion 这几张轮换。想让反派各有专属脸,得补美术
  //     —— 代码解决不了。」
  // **那个判断在写下的当时是对的,后来就不对了。**
  // 实测:6 张 villain-*.jpg 共 681 KB,全在 sw.js 预缓存里,
  // 即**每台设备都在下载**,而 asset-reach 检索确认它们零引用。
  // 敌人数据(`foes` 数组第 6 位)早就带了专属 key:
  //   moying / heifeng / shougu / youfang
  // 也就是说:数据早就准备好了,只差一张映射表。
  // 接上之后:反派不再轮换同一张脸 —— 这是**观感修复**,不只是带宽。
  heifeng: 'assets/portrait/villain-heifeng.jpg',
  shougu: 'assets/portrait/villain-shougu.jpg',
  youfang: 'assets/portrait/villain-youfang.jpg',
  shemie: 'assets/portrait/villain-shexie.jpg',
  nvxia: 'assets/portrait/villain-nvxia.jpg',
  yaohou: 'assets/portrait/villain-yaohou.jpg',
};

/**
 * 回合制 boss 立绘(XX-PLAY-008)。
 *
 * 背景:石像守卫 / 无常尊者是 **roguelike 层**的 boss(js/game/enemies.js),
 * 它们从来没有专属立绘。main.js 一直拿 PORTRAIT.foe(= 墨影的脸)顶着,
 * 于是打石像守卫时屏幕上站着墨影 —— XX-PLAY-005 修好了台词,脸还是错的。
 *
 * 仓库里本来就有**语义对得上**的图,而且都是零冲突的闲置资产
 * (实测 yaohou / shemie / nvxia 三张除本映射表外**零引用**,
 *   修仙阁轮换表只有 moying/heifeng/shougu/youfang 四个 key):
 *   石像守卫 → assets/mob/golem.jpg
 *     (图鉴里「山门执事」「炼骨傀」用的就是它;已看图确认:岩石躯体 +
 *      金色裂纹 + 无面罩,**就是石像守卫本人**)
 *   无常尊者 → assets/portrait/villain-yaohou.jpg
 *     (戴冠坐凤椅的正统「尊者」像,747×1000。已看图确认。
 *      这张图原属「妖后」,但妖后从未被分派过,复用不产生张冠李戴)
 *
 * ⚠️ 两张图的清晰度不同,这是**有意的取舍**,不是没留意:
 *    · golem.jpg 是 418×560,而反派立绘是 747×1000。
 *      宽高比几乎一致(0.746 vs 0.747),`img{width:100%}` 不会让布局跳变;
 *      但 290px 宽的头像槽里密度只有 1.4×(立绘 2.6×)——
 *      **石像守卫在高 DPI 手机上会比原来略糊**。
 *      语义对 > 略糊。要两全就补一张 747×1000 的石像守卫专属图,
 *      补完把下面这一行换掉即可,其它地方不用动。
 *    · 无常尊者用的是 747×1000,不糊。
 */
export const BOSS_PORTRAIT = {
  boss_golem:    'assets/mob/golem.jpg',
  boss_overlord: 'assets/portrait/villain-yaohou.jpg',
};

/** boss 取立绘:有专属就用专属,没有就退回通用反派图(不静默给错的脸)。 */
export function bossPortrait(type) {
  return BOSS_PORTRAIT[type] || PORTRAIT.foe;
}

// ===== 灵伴:按变异阶段取立绘(XX-COMPANION-006)=====
//
// 为什么需要它:docs/COMPANION-MUTATION.md 写死了「每阶段一次立绘换装」,
// 而在此之前 assets/portrait/ 里只有一张 companion.jpg —— 规格写了,
// 图没有,于是 STAGES[].bg 写进 derive() 就再没人读,COMPANION.form() 零调用点。
// 图补齐之后,这两处才**有消费方**。
// ⚠️ 2026-10-12 实测更正:图补齐后,按阶段取图走的是 **key**(见下方 JSDoc),
//   数字档位 bg 至今**产品零读**,只有 tests/mutation-regression.mjs 在断言它
//   (见「派生全部可量化形态参数」那份契约)。所以 bg 的现状是「测试锁着、产品没用」,
//   不是「没接线的美术档位」。删它要先改契约,那是产品决策,不在这道门的职权内。
//
// 形状刻意与 bossPortrait 完全一致(有专属用专属,没有退回通用),
// 理由和它一样:**不静默给错的脸**。阶段图缺失时退回原立绘,
// 而不是给个 undefined 让 <img> 裂开 —— 裂图在暗底页面上比旧图更显眼。
export const COMPANION_PORTRAIT = {
  sealed: 'assets/portrait/companion_sealed.jpg',
  awaken: 'assets/portrait/companion_awaken.jpg',
  reveal: 'assets/portrait/companion_reveal.jpg',
  morph:  'assets/portrait/companion_morph.jpg',
  true:   'assets/portrait/companion_true.jpg',
};

/**
 * 灵伴取立绘。
 * @param {string} [stage] MUTATION.STAGES 的 **key**（sealed/awaken/reveal/morph/true）。
 *                       缺省 / 认不出 → 退回通用灵伴立绘。
 * @returns {string} 图片路径（保证非空）
 *
 * ⚠️ 这里**只认 key,不认数字下标**。原来 JSDoc 写的是「索引或 key」,
 *   但数字走进来会一路落到 fallback 返回通用图 —— 文档承诺的能力代码并没有实现。
 *   已于 2026-10-12 把文档改成实际行为:唯一的调用方(bag.js)传的就是
 *   `MUTATION.STAGES[m.stage].key`。想支持数字下标请先补调用方,别只补文档。
 */
export function companionPortrait(stage) {
  if (stage === undefined || stage === null) return PORTRAIT.companion;
  const key = typeof stage === 'string' ? stage : null;
  if (key && COMPANION_PORTRAIT[key]) return COMPANION_PORTRAIT[key];
  return PORTRAIT.companion;
}