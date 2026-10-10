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
  arts: {   // 神通 / 悟道 / 营地 —— 工单 XX-CONTENT-001 + 营地页
    start: '  // ---------- 神通 / 悟道 ----------',
    end: '  // ---------- 家族 ----------',
    file: 'ui/arts.js',
    methods: ['artHow', 'vArts', 'vCamp'],
    imports: [
      "import { ARTS } from '../arts.js';",
      "import { ARTSTAR } from '../artstar.js';",
      "import { CAMP } from '../camp.js';",
      "import { DAY, STONE_LIST, Bag } from '../items.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
  story: {  // 剧情演出 + 支线 —— 工单 XX-ARCH-006
    start: '  showStoryBeat(b) {',
    end: '  // ---------- 领地建造 ----------',
    file: 'ui/story.js',
    methods: ['showStoryBeat', 'showLegend', 'vQuest', 'showQuestReady',
              'askStoryPath', 'showStoryDone', 'askPath', 'askSpecial', 'showQuestDone'],
    imports: [
      "import { STORY, ARCS, ARC_REWARD } from '../story.js';",
      "import { QUEST } from '../quest.js';",
      "import { SPINE } from '../spine.js';",
      "import { NAGER, NAG } from '../nag.js';",
      "import { LEGEND } from '../legend.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
  fam: {      // 家族
    start: '  // ---------- 家族 ----------',
    end: '  // ---------- 领地建造 ----------',
    file: 'ui/fam.js',
    methods: ['vFam'],
    imports: [
      "import { FAMILY } from '../family.js';",
      "import { CHRONICLE } from '../chronicle.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
  build: {    // 领地建造
    start: '  // ---------- 领地建造 ----------',
    end: '  // ---------- 图鉴(怪物 + NPC)----------',
    file: 'ui/build.js',
    methods: ['vBuild'],
    imports: [
      "import { BUILD, FIELD_PERIOD } from '../build.js';",
      "import { BUILDINGS, RICE } from '../bestiary.js';",
      "import { Bag } from '../items.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
  dexsys: {   // 图鉴 + 存档
    start: '  // ---------- 图鉴(怪物 + NPC)----------',
    end: '  // ---------- 行囊 ----------',
    file: 'ui/dexsys.js',
    methods: ['vDex', 'vSys'],
    imports: [
      "import { BUILDINGS, BESTIARY, NPCS, TIERS } from '../bestiary.js';",
      "import { Profile, Seed } from '../profile.js';",
      "import { CHRONICLE } from '../chronicle.js';",
      "import { CLOCK } from '../clock.js';",
      "import { Cult } from '../index.js';",
      "import { STONES, SCROLLS } from '../items.js';",
      "import { WORLD_INFO } from '../world.js';",
      "import { STORY } from '../story.js';",
      "import { LEGEND_LIST } from '../legend.js';",
      "import { COMPANION } from '../companion.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
  bag: {      // 行囊 + 人物 + 村庄 + 坐骑 + 全屏卡队列
    start: '  // ---------- 行囊 ----------',
    end: '  // ---------- 称号 ----------',
    file: 'ui/bag.js',
    methods: ['vBag', 'showMountGet', '_nextPending', 'empty',
              'enterVillage', 'vVillage', 'vMount', 'vPeople'],
    imports: [
      "import { STONES, STONE_LIST, SCROLL_LIST, Bag, DAY } from '../items.js';",
      "import { MOUNT, MOUNTS, MOUNT_LIST } from '../mount.js';",
      "import { CHARACTERS, TITLES, WORLD as LORE } from '../lore.js';",
      "import { Cult } from '../index.js';",
      "import { SCROLLS, GOODS } from '../items.js';",
      "import { NAGER, NAG } from '../nag.js';",
      "import { STORY } from '../story.js';",
      "import { TOMB } from '../tomb.js';",
      "import { PORTRAIT } from './portrait.js';",
      "import { esc, toast } from './dom.js';",
    ],
  },
  title: {    // 称号
    start: '  // ---------- 称号 ----------',
    end: null,          // 最后一个方法,到 Hall 对象收尾为止
    file: 'ui/title.js',
    methods: ['vTitle'],
    imports: ["import { TITLES } from '../lore.js';", "import { Cult } from '../index.js';", "import { esc } from './dom.js';"],
  },
  realm: {    // 境界
    start: '  // ---------- 境界 ----------',
    end: '  // ---------- 地图 ----------',
    file: 'ui/realm.js',
    methods: ['vRealm'],
    imports: [
      "import { REALMS, getRealm, maxLayerOf, layerCost, canBreakthrough, realmTitle, PILLS } from '../realms.js';",
      "import { CHRONICLE } from '../chronicle.js';",
      "import { pct, esc } from './dom.js';",
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
// end 可以写 null,表示"到 Hall 对象字面量收尾为止"。
// 称号页是最后一个方法,原本拿 `};` 当 end —— 而文件里 `};` 出现 10 次,
// 自检直接把它拦下来了。这比让它蒙混过去好:锚点不唯一 =区间不确定。
const i = src.indexOf(cfg.start);
if (cfg.start && src.split(cfg.start).length - 1 !== 1)
  throw new Error(`锚点 start 出现 ${src.split(cfg.start).length - 1} 次(应为 1):${cfg.start}\nui.js 结构可能变了 —— 停下来人工看,不要猜`);
let j;
if (cfg.end === null) {
  j = src.lastIndexOf('\n};');
  if (j < 0) throw new Error('找不到 Hall 对象字面量的收尾 `\n};`');
} else {
  const n = src.split(cfg.end).length - 1;
  if (n !== 1) throw new Error(`锚点 end 出现 ${n} 次(应为 1):${cfg.end}\nui.js 结构可能变了 —— 停下来人工看,不要猜`);
  j = src.indexOf(cfg.end);
}
if (j <= i) throw new Error('end 锚点在 start 之前');

// —— 自检 2:区间里的方法集合与配置完全一致 ——
// 少一个 = 有人漏搬;多一个 = 有人把别的东西顺手带进来了。
// —— 自检 2:区间里**只应有本页的实现**,不能有别的页已经拆走的壳 ——
// ⚠️ 这里翻过车,而且翻得很隐蔽:先是看到"区间里多了方法"就报错,于是我加了容错
// (isShell 把它们跳过)。结果更糟 —— 壳被当成实现又搬了一遍:
// fam 的区间跨过了 story 那 9 个壳 → fam.js 里出现 9 个假的
// `export function showStoryBeat(hall,b){ return showStoryBeatImpl(this,b); }`,
// 同时 ui.js 里那 9 个真壳**被删掉了**(脚本用变换后的内容替换整个区间)。
// 当时脚本还打印了 ✅。
//
// 正确做法不是"容错",是**剔除**:壳属于别的页,不该出现在本页的实现里。
// 剔除之后再断言剩下的方法集合 == 配置,多一个少一个都停。
// 用 src.slice(0,i)+壳+src.slice(j) 写回 ui.js,那些壳原样保留,不受影响。
const isShellLine = (l) => /^  \w+\([^)]*\) \{ return \w+Impl\(this/.test(l);
const blockLines = src.slice(i, j).split('\n');
const implBlock = blockLines.filter(l => !isShellLine(l)).join('\n');
const shellsInRange = blockLines.filter(isShellLine);
// ⚠️ 写回 ui.js 时必须把区间里原有的这些壳**原样放回去**。
// 只剔除不保留的话,`src.slice(0,i) + 本页新壳 + src.slice(j)` 会把整个区间丢掉 ——
// 那 9 个 story 的壳就没了,而 Hall 上少了方法,调用点还在,点了没反应
// (V0.89 误删 askStoryPath 就是这个形态)。
const keptShells = blockLines.filter(isShellLine);

const found = (implBlock.match(/^  (\w+)\(/gm) || []).map(x => x.trim().slice(0, -1));
const want = cfg.methods.filter(m => m !== 'vTomb');   // 已拆过的壳不在这段里
const missing = want.filter(m => !found.includes(m));
const extra = found.filter(m => !want.includes(m));
if (missing.length) throw new Error(`区间里少了方法:${missing.join(',')}`);
if (extra.length) throw new Error(`区间里多了方法:${extra.join(',')} —— 配置该更新,或代码变了`);
if (shellsInRange) console.log(`  (区间里有 ${shellsInRange} 行别页的转发壳,已剔除、不动它们)`);

// —— 变换 ——
let body = implBlock
  .replace(/^  (\w+)\(([^)]*)\) \{/gm, (s, n, ps) => `export function ${n}(hall${ps.trim() ? ', ' + ps : ''}) {`)
  .replace(/^  (?=\S)/gm, '')                                   // 去剩余缩进
  .replace(/^\},$/gm, '}')                                      // 独占一行的对象尾逗号
  // 单行方法(`showQuestReady(q) { toast(...); },`)的尾逗号在**同一行**,
  // 上面那条独占一行的规则管不到它 —— 拆 story 页时踩到,产出直接语法错。
  .replace(/^export function .*\},$/gm, l => l.slice(0, -2) + '}');
// `this.` **一律**换成 `hall.`,不只是方法调用 ——
// 踩过一次:原来只换 `this.xxx(`,于是属性读取 `this.picking` / `this._bn`
// 留在原地。这两个是 Hall 上的**数据属性**(picking: null 声明在对象里,
// _bn 是 showStoryBeat 运行时挂上去的),在独立函数里 this 是 undefined,
// 一读就 TypeError —— 而神通页正是"选了一门神通待融合"时才走这条路。
// 原生 ESM 顶层 this 是 undefined,不会退化成全局对象,所以不会静默拿到错值,
// 它会直接抛。
const nThis = (body.match(/(?<![\w.$])this\./g) || []).length;
body = body.replace(/(?<![\w.$])this\./g, 'hall.');

// —— 自检 3/4:两类"不会自己报警"的改写必须干净 ——
if (/(?<![\w.$])this\./.test(body)) throw new Error('还有 this. 没换成 hall.');
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
const finalBody = header + body.replace(/\n+$/, '\n');

// —— 自检 7:产出必须真的能解析 ——
// 前六道自检全是文本层面的,漏了一种排版就漏了(单行方法的尾逗号就是这么漏的)。
// 所以最后拿 node --check 验一遍**真解析**。不过就不写盘、不改 ui.js ——
// 宁可什么都不做,也不要留下一个语法错的 ui.js。
{
  const { execFileSync } = await import('child_process');
  const probe = ROOT + '/.split-check-' + process.pid + '.mjs';
  try {
    writeFileSync(probe, finalBody);
    execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' });
  } catch (e) {
    throw new Error('产出语法错误,已中止(未改动 ui.js):\n' +
      String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  } finally {
    try { (await import('fs')).unlinkSync(probe); } catch {}
  }
}

writeFileSync(outFile, finalBody);

// —— ui.js:留壳 + 加 import ——
// 壳保留**原签名**,不用 `(...a)` 展开:展开虽然等价,但会让 Hall.vMarket.length
// 从 1 变成 0,而且读代码的人看不出这个方法原来收什么参数。
// 工单里写明的形态就是 `vRealm(s) { return vRealm(this, s); }`。
const alias = cfg.methods.map(m => `${m} as ${m}Impl`).join(', ');
const shells = cfg.methods.map(m => {
  const sig = (implBlock.match(new RegExp(`^  ${m}\\(([^)]*)\\) \\{`, 'm')) || [])[1];
  if (sig === undefined) throw new Error(`没在区间里找到 ${m} 的签名`);
  return `  ${m}(${sig}) { return ${m}Impl(this${sig.trim() ? ', ' + sig : ''}); },\n`;
}).join('');
let s2 = src.slice(0, i) + shells + '\n'
  + (keptShells.length ? keptShells.join('\n') + '\n' : '') + src.slice(j);
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