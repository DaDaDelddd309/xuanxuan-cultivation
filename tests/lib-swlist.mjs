// 共享:从 sw.js 里取出预缓存清单
//
// 【2026-10-10 建立】修同一个 bug 的两份拷贝。
//   sw.js 的预缓存清单是数组字面量,数组里**允许写注释** —— 而项目里
//   大量注释正引用着具体路径(例如说明某个文件"曾在清单里")。
//   lint-precache.mjs 和 test-assets.mjs 原来各自写了一份
//   `/'([^']+)'/g` 直接扫全文,于是**注释里提到的路径被当成清单项**,
//   报出「清单里有文件不存在」这种假红。
//
//   假红比漏报更危险:它训练人习惯性忽略这条检查。
//   两份拷贝改一份就会漏一份,所以抽到这里,单一真源。

/**
 * 剥掉 JS 注释,但**保留字符串字面量原样**。
 * 字符串内的 // (如 'https://cdn/x.js') 不能当注释处理,
 * 所以用状态机逐字符扫,而不是正则。
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      out += c; i++;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') { out += src[i]; i++; }
        out += src[i] ?? ''; i++;
      }
      if (i < src.length) { out += src[i]; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * 取出 sw.js 预缓存清单的全部条目(已去注释、已去掉 ./ 前缀)。
 * @param {string} swSrc sw.js 源码全文
 * @returns {string[]}
 */
export function precacheList(swSrc) {
  const clean = stripComments(swSrc);
  const blocks = [...clean.matchAll(/const\s+\w+\s*=\s*\[([\s\S]*?)\]/g)].map(m => m[1]);
  const out = [];
  for (const b of blocks)
    for (const m of b.matchAll(/'([^']+)'/g))
      out.push(m[1].replace(/^\.\//, ''));
  return out;
}

/**
 * 【2026-10-12 新增】结构化解析预缓存清单 —— 数组字面量逐个元素拆开,
 * **不只认带引号的**。
 *
 * 【为什么必须有它:一个真实假通过】
 *   `precacheList()` 与 lint-precache.mjs 都用 `/'([^']+)'/g` 抽条目。
 *   而 JS 数组**允许稀疏空洞**:`['a', , 'b']` 的 length 是 3,第 1 项是 `undefined`。
 *   空洞没有引号 ⇒ 解析阶段就被丢掉 ⇒ 它不参与任何一项检查 ⇒ 门禁照样报绿。
 *   实测阴性对照(往 sw.js 注入 `'js/main.js', , 'js/sprites.js',`):
 *       lint-precache EXIT=0  ✅ 报绿   ← 假通过坐实
 *       同批对照的「块内重复」「文件不存在」都 EXIT=1 有牙
 *   运行时后果:`cache.addAll` 里混进一个 `undefined` ⇒
 *   解析成 `<scope>/undefined` ⇒ 每次 SW install 几次无用 404。
 *   ⚠️ 这个坑本仓栽过两次:V0.98「检查方向搞反」、这次「解析不完整」——
 *      两次都是同一类:**lint 报绿但实际有问题**。
 *
 * 【刻意不用 eval】
 *   常见的修法是 `eval('[' + body + ']')`。那是**对仓库内容求值**,
 *   一份清单里手滑写进任何可执行表达式都会当场执行。
 *   本仓另有门禁禁动态代码,lint 自己更不该开这个口子。
 *   这里改成**纯字符扫描**:按顶层逗号切元素,字符串/注释已由 stripComments 处理。
 *
 * @param {string} swSrc sw.js 源码全文
 * @returns {{blockIndex:number, kind:'ok'|'hole'|'empty'|'undef'|'notstring', raw:string, text?:string}[]}
 *   kind:'ok'        正常字符串条目(text 为去掉 ./ 的值)
 *   kind:'hole'      空元素 —— 数组稀疏空洞,运行时是 undefined
 *   kind:'empty'     `''` 空字符串 —— 请求的是 scope 根,不是想要的文件
 *   kind:'undef'     显式 undefined / null / void 0 —— 与 hole 等价
 *   kind:'notstring' 展开(...X)、字符串拼接、裸标识符等非字面量形式
 *                    (调用方只能提示,不能判红 —— 见 lint-precache.mjs 里的理由)
 */
export function precacheEntries(swSrc) {
  const clean = stripComments(swSrc);
  const blocks = [...clean.matchAll(/const\s+\w+\s*=\s*\[([\s\S]*?)\]/g)];
  const out = [];
  blocks.forEach((m, bi) => {
    const body = m[1];
    // 按**顶层**逗号切分:跟踪 () [] {} 深度,字符串已由 stripComments 保住引号
    let depth = 0, start = 0;
    const push = (raw) => {
      const t = raw.trim();
      if (!t) { out.push({ blockIndex: bi + 1, kind: 'hole', raw }); return; }
      if (/^(?:undefined|null|void\s+0)$/.test(t)) {
        out.push({ blockIndex: bi + 1, kind: 'undef', raw, text: t });
        return;
      }
      const q = t[0];
      if ((q === "'" || q === '"') && t.length >= 2 && t[t.length - 1] === q) {
        const inner = t.slice(1, -1);
        if (!inner) out.push({ blockIndex: bi + 1, kind: 'empty', raw, text: inner });
        else out.push({ blockIndex: bi + 1, kind: 'ok', raw, text: inner.replace(/^\.\//, '') });
        return;
      }
      out.push({ blockIndex: bi + 1, kind: 'notstring', raw, text: t });
    };
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) { push(body.slice(start, i)); start = i + 1; }
    }
    // 末尾:**结尾的逗号不算空洞**(JS 里 [1,2,] 的 length 是 2)
    const tail = body.slice(start);
    if (tail.trim()) push(tail);
  });
  return out;
}