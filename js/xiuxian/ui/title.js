// 修仙阁 · title页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vTitle() { return vTitleImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { TITLES } from '../lore.js';
import { Cult } from '../index.js';
import { esc } from './dom.js';

// ---------- 称号 ----------
//
// 这一页原本是**一面墙**:八枚印摆在那儿,整页 0 个可点元素 ——
// 没有一处告诉玩家「它什么时候会亮」「我还差几步」。
//
// 降级成「档案馆」,只在 vTitle 里补三样东西,原有内容一行不删:
//   1 · 一句话说明这页记的是什么(称号页说「路」,与支线页的「账」、图鉴页的「见闻」各说各的)
//   2 · 「在哪儿挣的」+ 真的能点过去的去处(data-tab 走的是 ui.js 已有的派发,不是假按钮)
//   3 · 「还差什么」—— 读存档里**真实记过的计数**,只读不写
//
// ⚠️ 阈值与判定全在 relations.js 的 Titles.check(),这里一个数字都不参与解锁。
//    下面这张表只是「哪个 flag 对应哪句人话」的显示映射:relations.js 以后加称号,
//    这里查不到就退回只显示 t.cond,既不崩也不会显示错的数。

/** 称号 ← 真实计数来源(只读)。label 是给玩家看的中文,flag 是存档里的键名。 */
const PROGRESS = {
  chizi:   [{ l: '挑战', f: 'challenge' }, { l: '放过', f: 'spare' }],
  rumo:    [{ l: '入魔', f: 'demon' }],
  chishui: [{ l: '宿敌', f: 'nemesis_win' }],
  buniao:  [{ l: '已拒', f: 'refuse_alliance' }],
  renxia:  [{ l: '已救', f: 'rescue' }],
};

/** 还没亮的称号:返回一句「走到哪儿了」,读不到就返回空串(不显示)。 */
function progressOf(id, flags, st) {
  if (id === 'xiuliankuang') {
    // 「修炼狂」的条件是**连着**炼多少天,那是 s.medStreak 这个活计数器,
    // 不是 flags.streak ——后者只在满 30 天那条路上 +1,用错了会显示成「已达成 1 次」。
    const n = Number(st && st.medStreak) || 0;
    return `连 炼 第 ${n} 天`;
  }
  const rows = PROGRESS[id];
  if (!rows) return '';
  return rows.map(r => `${r.l} ${Number(flags[r.f]) || 0}`).join(' · ');
}

export function vTitle(hall) {
    const got = Cult.titles.list();
    const st = Cult.get();
    const flags = (Cult.titles.s && Cult.titles.s.flags) || {};
    const left = TITLES.length - got.length;
    return `
      <div class="xx-card">
        <div class="xx-label">印 记</div>
        <div class="xx-dim">这里记的不是名头,是你走过的路。</div>
        <div class="xx-dim" style="margin-top:6px">
          ${got.length
            ? `已得 ${got.length} 枚 · 还差 ${left} 枚`
            : `一枚都还没亮 · 共 ${TITLES.length} 枚`}
        </div>
      </div>

      <div class="xx-card">
        <div class="xx-label">在 哪 儿 挣 的</div>
        <div class="xx-dim" style="margin-bottom:9px">
          印不是挑的,是下面这些地方挣来的。亮不起来,去看它走到哪儿了。
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="xx-btn" data-tab="map">遇 敌 · 挑 战 / 放 过</button>
          <button class="xx-btn" data-tab="realm">吐 纳 · 连 炼</button>
          <button class="xx-btn" data-tab="arts">融 合 · 剑 系</button>
          <button class="xx-btn" data-tab="build">契 约 · 可 拒</button>
        </div>
        <div class="xx-dim" style="margin-top:9px">
          荒野里逢战必过、放过对手、救下散修,都记在同一张卡上;
          拒绝结盟邀请在领地,剑系神通全部满级再融合在神通。
        </div>
      </div>

      ${TITLES.map(t => {
        const on = got.includes(t.id);
        const prog = on ? '' : progressOf(t.id, flags, st);
        return `<div class="xx-title-i ${on ? 'on' : 'off'}">
        <div class="xx-seal">${on ? '印' : '？'}</div>
        <div style="flex:1">
          <div style="color:${on ? 'var(--xx-gold)' : 'var(--xx-paper)'};letter-spacing:2px">${esc(t.name)}</div>
          <div class="xx-dim">${on ? esc(t.desc) : esc(t.cond)}</div>
          ${prog ? `<div class="xx-dim" style="margin-top:3px">${esc(prog)}</div>` : ''}
        </div>
      </div>`;
      }).join('')}`;
}