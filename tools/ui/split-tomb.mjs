// 仙人墓页拆分 —— 确定性脚本(XX-AUDIT-005)
// 为什么是脚本而不是手改:手改过一次之后发现注入/还原极易留下半份状态
// (删掉 4 个壳里的第一行,另外 3 个还在,看着像还原干净了)。脚本每次从
// git 状态出发跑同一套变换,结果可复现。
import { readFileSync, writeFileSync } from 'fs';
const UI='js/xiuxian/ui.js', TOMB='js/xiuxian/ui/tomb.js';
const src=readFileSync(UI,'utf8');
const METHODS=['vTomb','tombRoom','askTombWords','tombEnding'];
const i=src.indexOf('  vTomb() {'), j=src.indexOf('  // ---------- 神通 / 悟道 ----------');
if(i<0||j<0||j<i) throw new Error('锚点找不到,ui.js 结构可能变了 —— 停下来人工看,不要猜');
const block=src.slice(i,j).trimEnd();
const found=block.match(/^  (\w+)\(/gm)?.map(x=>x.trim().slice(0,-1))??[];
if(found.length!==4 || !METHODS.every(m=>found.includes(m)))
  throw new Error('仙人墓块里的方法不是预期的 4 个,而是: '+found.join(','));

let body = block.replace(/^  (\w+)\(([^)]*)\) \{/gm, (s,n,ps)=>
  `export function ${n}(hall${ps.trim()?', '+ps:''}) {`)
  .replace(/^  (?=\S)/gm, '')
  .replace(/^\},$/gm, '}');
const nThis=(body.match(/(?<![\w.])this\.(\w+\()/g)||[]).length;
body=body.replace(/(?<![\w.])this\.(\w+\()/g, 'hall.$1');
if(/(?<![\w.])this\.\w+\(/.test(body))   throw new Error('还有 this. 没换成 hall.');
if(/^\},$/m.test(body))                throw new Error('还有对象尾逗号');
const header=`// 修仙阁 · 仙人墓页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 拆法:搬实现,ui.js 上留同名壳 \`vTomb() { return vTombImpl(this); }\`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 \`this\`)。
//
// 纪律:\`this.\` 必须全换成 \`hall.\`;对象成员结尾的 \`},\` 要去掉(顶层函数里是非法尾逗号)。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸 —— 而这几个方法很少被触发。
// 本文件由 split-tomb.mjs 生成,改动请改脚本后重跑,别手改(手改过一次留下了半份状态)。
import { TOMB, ROOMS as TOMB_ROOMS, WORDS as TOMB_WORDS } from '../tomb.js';
import { QUEST } from '../quest.js';
import { esc, toast } from './dom.js';

`;
writeFileSync(TOMB, header+body+'\n');

const shells=`  // ---------- 仙人墓 · 地下层 ----------
  // 独立视图:墓里没有大地图,只有相邻的几间屋子。实现见 ui/tomb.js。
  vTomb() { return vTombImpl(this); },
  // 进入某间房:结算内容并展示
  tombRoom(id) { return tombRoomImpl(this, id); },
  // 补完半句话 —— 只能在石将跟前做
  askTombWords() { return askTombWordsImpl(this); },
  // 墓的结局演出
  tombEnding(r) { return tombEndingImpl(this, r); },

`;
let s2 = src.slice(0,i) + shells + src.slice(j);
s2 = s2.replace("import { Cult } from './index.js';",
  "import { Cult } from './index.js';\n"+
  "// 仙人墓页已拆出(XX-AUDIT-005)。下面 4 个是转发壳,实现见 ui/tomb.js。\n"+
  "import { vTomb as vTombImpl, tombRoom as tombRoomImpl, askTombWords as askTombWordsImpl, tombEnding as tombEndingImpl } from './ui/tomb.js';");
s2 = s2.replace(`const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const pct = (a, b) => b > 0 ? Math.min(100, Math.max(0, a / b * 100)) : 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
`, "import { $, pct, esc, toast } from './ui/dom.js';   // 共享 DOM 辅助,唯一一份(XX-AUDIT-005)\n");
s2 = s2.replace(/\nfunction toast\(msg\) \{\n[\s\S]*?\n\}\n/, '\n');
if(/function toast\(/.test(s2) || /const esc = s =>/.test(s2)) throw new Error('本地 esc/toast 没删干净');
// 每个方法名只能出现一次 —— 重复定义在对象字面量里是"后者覆盖前者",不报错
for(const m of METHODS){
  const n=(s2.match(new RegExp(`^  ${m}\\(`, 'gm'))||[]).length;
  if(n!==1) throw new Error(`ui.js 里 ${m} 出现 ${n} 次(应为 1)`);
}
writeFileSync(UI, s2);
console.log('✅ ui.js', s2.split('\n').length, '行; ui/tomb.js', (header+body).split('\n').length, '行; this.→hall.', nThis, '处');
