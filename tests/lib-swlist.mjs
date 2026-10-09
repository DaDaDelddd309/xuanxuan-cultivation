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