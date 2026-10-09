// 修仙阁 UI 拆分器 —— 工单 XX-AUDIT-005
//
// 为什么是脚本而不是手改（两次教训）:
//   ① 手改 + 注入验证的组合会留下半份状态:删掉 N 个壳里的第一个、其余还在,
//      还原时"看着干净"其实重了一份。对象字面量重复定义是后者覆盖前者,
//      **不报错**,所以这种错误能一路带着绿测试发布。
//   ② 每个壳都要 `this.` → `hall.`、每个方法边界都要去掉对象尾逗号 `},`,
//      漏改都不会在定义时报错,只在真执行到那一行才炸 —— 而这些方法很少被触发。
//
// 所以:每拆一页都从 git 的已知状态跑一遍同样的变换,结果可复现;
// 跑之前先跑六道自检,任何一道不过就**停下来报错**,不产出半成品。
//
// 用法: node tools/ui/split.mjs <配置名>
//   配置在 SPLITS 里,加一页就加一条,不要在脚本里写一次性代码。

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '../..');

const UI = ROOT + '/js/xiuxian/ui.js';

// —— 每页一条配置 ——
//   start : 起锚点(该页第一段注释或第一行方法)
//   end   : 止锚点(**下一段**的第一行)
//   file  : 目标文件(相对 js/xiuxian/)
//   methods: 要搬的方法,顺序必须与文件里一致
//   shellComment: 留在 ui.js 上的那段分节注释
const SPLITS = {
  tomb: {
    start: '  // ---------- 仙人墓 · 地下层 ----------',
    end: '  // ---------- 神通 / 悟道 ----------',
    file: 'ui/tomb.js',
    methods: ['vTomb', 'tombRoom', 'askTombWords', 'tombEnding'],
    imports: [
      "import { TOMB, ROOMS as TOMB_ROOMS, WORDS as TOMB_WORDS } from '../tomb.js';",
      "import { QUEST } from '../quest.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
  meta: {   // 工单 XX-META-001/003/005:集市 / 合成 / 酒馆
    start: '  // ---------- 集市(V0.99 · XX-META-001)----------',
    end: '  // ---------- 行囊 ----------',
    file: 'ui/meta.js',
    methods: ['vMarket', 'vCraft', 'vTavern'],
    imports: [
      "import { MARKET, MARKET_GOODS } from '../market.js';",
      "import { CRAFT } from '../craft.js';",
      "import { TAVERN, MATES } from '../tavern.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
};

// ——————————————————————————————————————————————
const cfg = SPLITS[process.argv[2]];
if (!cfg) {
  console.error(`用法: node tools/ui/split.mjs <${Object.keys(SPLITS).join('|')}>`);
  process.exit(2);
}

const src = readFileSync(UI, 'utf8');

// —— 自检 1:锚点存在且唯一,顺序正确 ——
for (const [label, anchor] of [['start', cfg.start], ['end', cfg.end]]) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`锚点 ${label} 出现 ${n} 次(应为 1):${anchor}\nui.js 结构可能变了 —— 停下来人工看,不要猜`);
}
const i = src.indexOf(cfg.start), j = src.indexOf(cfg.end);
if (j <= i) throw new Error('end 锚点在 start 之前');

// —— 自检 2:区间里的方法集合与配置完全一致 ——
// 少一个 = 有人漏搬;多一个 = 有人把别的东西顺手带进来了。
const block = src.slice(i, j);
const found = (block.match(/^  (\w+)\(/gm) || []).map(x => x.trim().slice(0, -1));
const want = cfg.methods.filter(m => m !== 'vTomb');   // 已拆过的壳不在这段里
const missing = want.filter(m => !found.includes(m));
const extra = found.filter(m => !want.includes(m) && !cfg.methods.includes(m));
if (missing.length) throw new Error(`区间里少了方法:${missing.join(',')}`);
if (extra.length) throw new Error(`区间里多了方法:${extra.join(',')} —— 配置该更新,或代码变了`);

// —— 变换 ——
let body = block
  .replace(/^  (\w+)\(([^)]*)\) \{/gm, (s, n, ps) => `export function ${n}(hall${ps.trim() ? ', ' + ps : ''}) {`)
  .replace(/^  (?=\S)/gm, '')                                   // 去剩余缩进
  .replace(/^\},$/gm, '}');                                     // 顶层函数没有对象尾逗号
const nThis = (body.match(/(?<![\w.])this\.(\w+\()/g) || []).length;
body = body.replace(/(?<![\w.])this\.(\w+\()/g, 'hall.$1');

// —— 自检 3/4:两类"不会自己报警"的改写必须干净 ——
if (/(?<![\w.])this\.\w+\(/.test(body)) throw new Error('还有 this. 没换成 hall.');
if (/^\},$/m.test(body)) throw new Error('还有对象尾逗号');

// —— 自检 5:视图模块不得 import Hall(循环依赖) ——
if (/import\s*\{[^}]*\bHall\b/.test(body)) throw new Error('视图模块里 import 了 Hall —— 循环依赖');

const pageName = cfg.file.split('/').pop().replace(/\.js$/, '');
const header = `// 修仙阁 · ${cfg.file.replace('ui/', '').replace('.js', '')}页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 \`${cfg.methods[0]}() { return ${cfg.methods[0]}Impl(this); }\`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 \`this\`)。
//
// 纪律:\`this.\` 必须全换成 \`hall.\`;对象成员结尾的 \`},\` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
${cfg.imports.map(s => s).join('\n')}

`;
const outFile = ROOT + '/js/xiuxian/' + cfg.file;
writeFileSync(outFile, header + body.replace(/\n+$/, '\n'));

// —— ui.js:留壳 + 加 import ——
// 壳保留**原签名**,不用 `(...a)` 展开:展开虽然等价,但会让 Hall.vMarket.length
// 从 1 变成 0,而且读代码的人看不出这个方法原来收什么参数。
// 工单里写明的形态就是 `vRealm(s) { return vRealm(this, s); }`。
const alias = cfg.methods.map(m => `${m} as ${m}Impl`).join(', ');
const shells = cfg.methods.map(m => {
  const sig = (block.match(new RegExp(`^  ${m}\\(([^)]*)\\) \\{`, 'm')) || [])[1];
  if (sig === undefined) throw new Error(`没在区间里找到 ${m} 的签名`);
  return `  ${m}(${sig}) { return ${m}Impl(this${sig.trim() ? ', ' + sig : ''}); },\n`;
}).join('');
let s2 = src.slice(0, i) + shells + '\n' + src.slice(j);
s2 = s2.replace("import { Cult } from './index.js';",
  `import { Cult } from './index.js';\n` +
  `// ${cfg.file.replace('ui/', '').replace('.js', '')}页已拆出(XX-AUDIT-005)。下面几个是转发壳,实现见 ${cfg.file}。\n` +
  `import { ${alias} } from './${cfg.file}';`);

// —— 自检 6:ui.js 上每个方法名只能出现一次 ——
// 对象字面量重复定义不报错,这正是半份状态能带着绿测试发布的原因。
for (const m of cfg.methods) {
  const n = (s2.match(new RegExp(`^  ${m}\\(`, 'gm')) || []).length;
  if (n !== 1) throw new Error(`ui.js 里 ${m} 出现 ${n} 次(应为 1)`);
}

writeFileSync(UI, s2);
console.log(`✅ ${cfg.file}: ${(header + body).split('\n').length} 行; ui.js: ${s2.split('\n').length} 行; this.→hall. ${nThis} 处; 壳 ${cfg.methods.length} 个`);