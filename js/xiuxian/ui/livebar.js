// 修仙阁 · 「当前正在发生」动态区 —— 工单 XX-LIVE-001
//
// 存在理由(交互普查结论,owner 已认可方向):
//   内容层其实没问题 —— 篝火/灵田/屋舍的描写都有质量。
//   病根在转换层:把好文案**贴在数据旁边当注释**。
//   玩家看到一个静止的自己,而不是一个正在运转的宗门。
//   「说明书告诉你状态,游戏让你经历状态变化。」
//
// 这一份只解三件事里最便宜、见效最快的那件:
//   在**每一页顶部**加一条动态区,把「此刻正在推进的东西」说清楚。
//   不重排 14 个页签、不重做 UI、不新增任何状态。
//
// —— 三条硬纪律,后面每段代码都受它约束 ——
//
// 1.【不造新状态】
//   全部读现成字段,没有新字段、没有新存档 key、没有新持久化:
//     · CAMP.s.lit / CAMP.s.fuelEnd / CAMP.s.totalSec     (camp.js:28-37)
//       fuelEnd 本身就是**真实时间戳**,「还剩几分钟」是减法,不是新增状态。
//     · BUILD.s.placed[].bid / .plantAt                     (build.js:27,164-166)
//       plantAt 是下种时写下的成熟时间戳,同样不需要另开字段。
//     · QUEST.s.active                                     (quest.js:59)
//   查不到就写「没有」,绝不编一个字段出来。
//
// 2.【不许静态化】
//   分钟数必须随 Date.now() 走,否则它只是一行贴着的说明文字 ——
//   恰恰是这一条工单要治的病。离页必须清定时器:
//   本项目栽过「定时器泄漏」「重复点击」两类坑,修仙阁反复切页会把定时器堆起来。
//
// 3.【没在发生的时候要开口】
//   14 个页签里只有一部分有进行中的事。其余页签留白会被读成
//   「加载失败」或「这里什么都没有」—— 比没有更糟。
//   所以零态是一句**明写的话**(此刻没有什么在发生 / 篝火 · 此刻没有在烧),不是空条。
//
// —— 样式约束 ——
// 本文件**不引入任何新类名**。css/ 不归我管,所以动态区只复用
// 页面上已经到处在用的 .xx-card / .xx-label / .xx-val / .xx-dim / .xx-bar,
// 样式与其它卡片天然一致,不需要 CSS 代理开工。

import { CAMP } from '../camp.js';
import { BUILD } from '../build.js';
import { BUILDINGS } from '../bestiary.js';
import { QUEST } from '../quest.js';
import { esc } from './dom.js';

// 零态的第一行。**不许空** —— 见文件头纪律 3。
const QUIET = '此刻没有什么在发生';
const TICK_MS = 1000;      // 分钟数每分钟才跳一次,1s 是为了让燃料条缩得顺
const ID = 'xx-livebar';

/**
 * 篝火 —— 全项目唯一一处「玩家离开也在走」的时钟。
 * 用 fuelEnd - now 现算,不缓存分钟数:缓存下来它就静止了(纪律 2)。
 */
function campItem(now) {
  const s = CAMP.s;
  if (s.lit && s.fuelEnd > now) {
    const min = Math.max(0, Math.ceil((s.fuelEnd - now) / 60000));
    // 条宽按 ui/arts.js 的 vCamp 同一口径:当前燃料 ÷ (当前燃料 + 背里还能投的燃料)。
    // 投一次柴就涨,烧一分钟就缩 —— 于是「火焰随燃料变小」是看得见的,不是文案。
    //
    // ⚠️ 背里没有源石时**不画条**:分母只剩当前燃料,比值恒等于 100%,
    // 烧到最后一分钟那条还是满的 —— 那是一根会骗人的条,比没有更糟。
    // 这种时候唯一可信的信号是那个在走的分钟数。
    const cap = CAMP.maxFuel();
    return {
      k: '篝火',
      v: min > 0 ? `燃料 ${min} 分钟 · 火随燃料变小` : '燃料不足 1 分钟 · 火将熄',
      tick: true,
      bar: cap > 0 ? Math.max(0, Math.min(100, min / (cap + min) * 100)) : null,
    };
  }
  if (s.lit) return { k: '篝火', v: '燃料尽了,只剩灰', quiet: true };
  return { k: '篝火', v: '此刻没有在烧', quiet: true };
}

/**
 * 灵田 —— plantAt 是下种时写下的成熟时间戳(build.js:78)。
 * 没下种的田**不进动态区**:那是状态,不是正在发生的事。
 */
function fieldItems(now) {
  const out = [];
  const placed = BUILD.s.placed || [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (!p || p.bid !== 'bld_field' || !p.plantAt) continue;
    const name = (BUILDINGS[p.bid] || {}).name || '灵田';
    if (p.plantAt > now) {
      const min = Math.ceil((p.plantAt - now) / 60000);
      out.push({ k: name, v: `第 ${i + 1} 格 · 还剩 ${min} 分钟收成`, tick: true });
    } else {
      // 已熟未收:这是真的**悬在空中的事**(不点收获就一直挂着),该占一条。
      out.push({ k: name, v: `第 ${i + 1} 格 · 已熟,等你去收`, quiet: true });
    }
  }
  return out;
}

/** 支线在手 = 有一件事真的在办。读 QUEST.s.active,不造新状态。 */
function questItem() {
  let list = [];
  try { list = QUEST.activeList() || []; } catch { return null; }
  if (!list.length) return null;
  return list.length === 1
    ? { k: '支线', v: `${list[0].title} · 尚在追查`, quiet: true }
    : { k: '支线', v: `${list.length} 条 · 都还在追查`, quiet: true };
}

/**
 * 距下一阶还差多少燃烧分钟。
 * **只在火真的在烧时才报** —— 火灭了 totalSec 就不再走,
 * 那时候报一个不动的数字等于把注释贴回数据旁边(纪律 1、3)。
 */
function tierItem(now) {
  if (!(CAMP.s.lit && CAMP.s.fuelEnd > now)) return null;
  const nx = CAMP.next();
  if (!nx) return null;
  const needSec = nx.need - CAMP.s.totalSec;
  if (needSec <= 0) return null;
  return { k: '营地', v: `距「${nx.name}」还需烧 ${Math.ceil(needSec / 60)} 分钟`, quiet: true };
}

/** 收集此刻正在发生的事(纯读,无副作用;now 显式传入,门禁才能喂两个不同时间) */
export function livebarItems(now = Date.now()) {
  const items = [campItem(now)];
  for (const f of fieldItems(now)) items.push(f);
  const q = questItem();
  if (q) items.push(q);
  const t = tierItem(now);
  if (t) items.push(t);
  return items;
}

/** 内层(不含外壳)。定时器只换这一段,不碰页面其余部分。 */
export function renderInner(items) {
  const live = items.filter(i => !i.quiet);
  let h = `<div class="xx-label">此 刻 正 在 发 生</div>`;
  if (live.length) {
    const [head, ...rest] = live;
    h += `<div class="xx-val">${esc(head.k)} · ${esc(head.v)}</div>`;
    if (head.bar != null) h += `<div class="xx-bar s"><i style="width:${Math.round(head.bar)}%"></i></div>`;
    for (const i of rest) h += `<div class="xx-dim">${esc(i.k)} · ${esc(i.v)}</div>`;
  } else {
    h += `<div class="xx-val">${QUIET}</div>`;
  }
  // 静的那几条也开口:「没在烧」「已熟等收」都是玩家此刻真正要知道的事,
  // 藏起来等于没发生(纪律 3)。
  for (const i of items.filter(x => x.quiet)) h += `<div class="xx-dim">${esc(i.k)} · ${esc(i.v)}</div>`;
  return h;
}

/** 外壳。**永远返回非空串** —— 调用点无条件拼在页面最前面。 */
export function livebarHTML(tabId, now = Date.now()) {
  return `<div class="xx-card" id="${ID}" data-livebar="1" data-tab="${esc(tabId || '')}">` +
    renderInner(livebarItems(now)) + `</div>`;
}

// —— 定时器:让「正在发生」真的是活的,但离页/切页不留野定时器 ——
let _timer = null, _host = null, _tab = null, _last = '';

/** 收掉定时器。可重复调用(close 与每次重挂都会调一遍)。 */
export function livebarOff() {
  if (_timer != null) { clearInterval(_timer); _timer = null; }
  _host = null; _tab = null; _last = '';
}

/**
 * 在渲染后挂上。**每次都先收旧的** —— 不先收的话,反复切页签会一份份叠加,
 * 正是本项目栽过的「定时器泄漏」那一类。
 */
export function livebarOn(bodyEl, tabId) {
  livebarOff();
  if (!bodyEl) return;
  _host = bodyEl; _tab = tabId;
  // 没有随时间变的东西 → 不挂定时器。零态不该留下一颗每秒空转的野定时器。
  if (!livebarItems().some(i => i.tick)) return;
  _timer = setInterval(onTick, TICK_MS);
}

function onTick() {
  const host = _host;
  if (!host) { livebarOff(); return; }
  const el = host.querySelector('#' + ID);
  if (!el) { livebarOff(); return; }      // 条没了(离页/被换掉)→ 收手,不留野定时器
  const items = livebarItems();
  const html = renderInner(items);
  if (html !== _last) { _last = html; el.innerHTML = html; }
  // 燃料尽了/田熟了 → 没有在变的东西了,定时器自己退休。
  if (!items.some(i => i.tick)) livebarOff();
}
