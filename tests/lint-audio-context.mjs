// lint-audio-context · 全项目只允许**一个** AudioContext
//
// 为什么需要它(2026-10-11 实踩,XX-AUDIO-CTX):
//   js/core/audio.js:67   this.ctx = new AC();                  ← 第一个
//   js/xiuxian/ambience.js:30  ctx = new AudioContext();        ← 第二个
//
//   而 ambience.js 的节点建在**它自己**的 ctx 上,总线却用 `SFX.musicBus`
//   —— 那是 audio.js 的 ctx 里的节点。跨 context 连线必然抛:
//     InvalidAccessError: cannot connect to an AudioNode
//     belonging to a different audio context
//
//   后果不是「氛围音可能没响」,而是**确定地不响**:
//   `out.connect(bus)` 一抛,紧跟着的 `gain.linearRampToValueAtTime`(淡入)
//   根本执行不到。而且每次调用抛一遍 —— 实测局内 19 秒 300+ 条。
//
// 为什么值得单独一条 lint:
//   · `lint-audio` 查的是**波形**(蜂鸣/音效名),与 context 归属正交,查不到这个
//   · DOM/文本断言也查不到:节点是创建成功的,只是连线抛错,页面照常渲染
//   · 更糟的是这类异常在 CI 日志里很吵,容易被当成噪音 grep 掉
//     —— **我自己就犯过**:整轮都在 `grep -av "AudioNode"`。
//     所以这条 lint 的价值有一半在"让这个问题变成红灯",而不是在"跑得快"。
//
// 判据从被检查对象自身取:数「实例化 AudioContext 的地方」有几处。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const JS_DIR = join(ROOT, 'js');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(f)) out.push(p);
  }
  return out;
}

/** 去掉注释 —— 否则「注释里提到 new AudioContext」会被当成一次实例化。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')        // 行注释(避开 http://)
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');  // 字符串字面量
}

// 三种写法都算「这里 new 了一个 context」
const PATTERNS = [
  /new\s+AC\s*\(/,
  /new\s*\(\s*window\.(?:webkit)?AudioContext/,
  /new\s+(?:window\.)?(?:webkit)?AudioContext\s*\(/,
];

const hits = [];
for (const f of walk(JS_DIR)) {
  const src = stripComments(readFileSync(f, 'utf8'));
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (PATTERNS.some(re => re.test(line))) {
      hits.push({ file: relative(ROOT, f), line: i + 1, text: line.trim().slice(0, 70) });
    }
  });
}

let fails = 0;
const ok = (n, c, extra = '') => {
  if (!c) fails++;
  console.log(`  ${c ? '✅' : '❌'} ${n}${extra ? ` — ${extra}` : ''}`);
};

console.log('【AudioContext 实例化点】');
for (const h of hits) console.log(`  · ${h.file}:${h.line}  ${h.text}`);

ok('全项目恰好一处 new AudioContext', hits.length === 1,
   hits.length === 0 ? '一处都没有 —— 查一下是不是被改名绕过了' : `实测 ${hits.length} 处`);
ok('那唯一一处在 core/audio.js(全局唯一的持有者)',
   hits.length === 1 && hits[0].file === join('js', 'core', 'audio.js'),
   hits.length === 1 ? hits[0].file : '—');

// 反向注入已手工验过(见 commit 正文):往 js/xiuxian/ 塞一个
// `new (window.AudioContext)()` 的探针文件 → 本 lint 立刻 2 项红,删掉恢复全绿。

console.log(`\n失败 ${fails} 项` + (fails ? '' : ' · 全部通过'));
process.exit(fails ? 1 : 0);
