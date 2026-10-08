// ===== 修仙阁 · 地点插画(V0.97)=====
// 工单 XX-S6-001 / XX-S6-002
//
// ★ 关键设计:插画绑定「地点类型」,不是「页签 id」
//   最初版本是按页签硬映射(第 3 个页签配第 3 张图),那等于
//   「图和内容各是各的」—— 地图页永远那一张,跟生成的村庄无关。
//   现在按 node.type 绑定:走到哪个类型的地点,就看到该类型的场景图。
//   图因此成为世界的一部分,而不是页面装饰。
//
// 美术规格见 docs/ART-GUIDELINES.md:
//   墨黑底 + 金线剪影 + 纸纹暗角,平均亮度 27-62(全暗部)
//
// 加载策略:懒加载 + 预加载当前地点。
// 迷雾态(未访问)不加载图 —— 未知之地给张剧透插画就没意思了。

const BASE = 'assets/illust/pages_webp/';

/** 地点类型 → 插画 */
export const NODE_ILLUST = {
  village: 'page-08-inn',   // 村舍灯火
  secret:  'page-02-cave',  // 洞口幽深
  boss:    'page-11-tomb',  // 幽冥殿
  elite:   'page-07-battle',// 险地厮杀
  field:   'page-09-map',   // 荒野舆图
};

/** 页签 → 插画(修仙阁 12 页;map 页不设,大地图自己按地点渲染) */
export const TAB_ILLUST = {
  realm:   'page-01-realm',
  camp:    'page-10-tower',
  arts:    'page-03-sword',
  bag:     'page-06-sect',
  people:  'page-04-pill',
  title:   'page-05-array',
  fam:     'page-12-market',
  build:   'page-10-tower',
  dex:     'page-11-tomb',
  quest:   'page-07-battle',
  sys:     'page-02-cave',
  map:     null,   // 大地图按地点渲染,不用页签图
};

export function nodeIllustUrl(node) {
  if (!node) return null;
  const name = NODE_ILLUST[node.type];
  return name ? BASE + name + '.webp' : null;
}

export function tabIllustUrl(tabId) {
  const name = TAB_ILLUST[tabId];
  return name ? BASE + name + '.webp' : null;
}

// ————————————————————— 图层控制 —————————————————————

const loaded = new Set();

/** 预加载(不阻塞) */
export function preload(url) {
  if (!url || loaded.has(url)) return;
  loaded.add(url);
  const im = new Image();
  im.decoding = 'async';
  im.src = url;
}

/**
 * 挂到元素上。同一张图重复设置会被跳过,避免重排。
 * @param {HTMLElement} el
 * @param {string|null} url
 */
export function applyBg(el, url) {
  if (!el) return;
  if (!url) {
    el.style.backgroundImage = '';
    el.classList.remove('has-illust');
    return;
  }
  if (el.dataset.illust === url) return;
  el.dataset.illust = url;
  preload(url);
  el.style.backgroundImage = 'url(' + url + ')';
  el.classList.add('has-illust');
}

export function clearBg(el) {
  if (!el) return;
  delete el.dataset.illust;
  el.style.backgroundImage = '';
  el.classList.remove('has-illust');
}

/** 预热一批图(进修仙阁时把常用几张预取,消除首次等待) */
export function warmup() {
  for (const k in NODE_ILLUST) {
    const u = BASE + NODE_ILLUST[k] + '.webp';
    if (!loaded.has(u)) { loaded.add(u); const im = new Image(); im.decoding = 'async'; im.src = u; }
  }
}