// ===== 装备页版式门禁(XX-GEAR-LAYOUT-001) =====
//
// 判什么:
//   owner 看装备页截图后的原话 ——「都是排版问题…都是卡片式的设计？？」
//   拆成四条可机械判据:版式分层 / 背包装得下且滑得动 / 边界清晰 / 有富余空间。
//   CSS 这层能机械判的是「有没有把该给的东西给了」,判不了的(好不好看)在文末写明。
//
// 为什么这个门禁的写法是「先纯函数、再反向注入」:
//   本仓库栽过的坑是**永远通过的门禁** —— 解析失败当通过、匹配写反当通过。
//   所以这里:judge(cssText) 是纯函数(不碰磁盘),
//   G5 拿**合成样本**喂它、逼它报错,证明它有能力红;G6 再单独断言解析器真解析到东西。
//   自检用的样本与被测的 css/gear.css 完全无关 —— 自检不与被测状态耦合。
//
// 运行: node tests/gear-layout-regression.mjs
//   0 = 通过   1 = 判出问题   2 = **门禁自身失效**(解析器退化了,不产出结论)
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const CSS_REL = 'css/gear.css';

// ════════════════════════════════════════════════════════════
// 纯函数区:解析 / 判定。不读磁盘,可被合成样本直接调用。
// ════════════════════════════════════════════════════════════

/** 剥块注释,但**用等量空格替换**(保持行数与列数不变)——
 *  tests/lint-tokens.mjs 栽过这个坑:逐行剥注释时,多行注释的中间行会整行漏过。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

/** 选择器串里 :has(X) 里的 X 提升成并列的一段,好让「同一个复合选择器」的判定能复用。 */
function flattenHas(sel) {
  return sel.replace(/:has\(([^)]*)\)/g, ' $1 ');
}
/** 选择器 → 复合段数组([['.a','.b'], ['.c']]) —— **不**展平 :has() */
function rawCompounds(sel) {
  return sel.split(/\s*([>+~])\s*|\s+/).filter(Boolean)
    .filter(s => s !== '>' && s !== '+' && s !== '~')
    .map(part => part.match(/\.[A-Za-z_][\w-]*/g) || []);
}
/** 选择器 → 复合段数组([['.a','.b'], ['.c']]) */
function compounds(sel) {
  return rawCompounds(flattenHas(sel));
}
/** 声明串 → {prop: value} */
function parseDecls(body) {
  const d = {};
  for (const piece of body.split(';')) {
    const i = piece.indexOf(':');
    if (i < 0) continue;
    const p = piece.slice(0, i).trim().toLowerCase();
    const v = piece.slice(i + 1).trim();
    if (p) d[p] = v;
  }
  return d;
}
/** 找与 css[open] 配对的 '}' 下标(带嵌套计数) */
function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return -1;
}
/**
 * CSS → 规则表 [{sel, media, line, decls}]
 * 刻意支持 @media/@supports 内嵌:写在 @media 里的规则照样算「有定义」,
 * 但 G1 只认非嵌套(media === null)的规则 —— 否则把契约类名藏进一个永远不匹配的
 * 媒体查询里也能骗过门禁。
 */
function parseRules(css) {
  const s = stripComments(css);
  const rules = [];
  const stack = [];
  let prelude = '';
  let i = 0;
  const lineOf = idx => s.slice(0, idx).split('\n').length;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      const p = prelude.trim();
      prelude = '';
      if (p.startsWith('@')) {
        const name = (p.split(/[\s(]/)[0] || '').toLowerCase();
        if (name === '@keyframes' || name === '@-webkit-keyframes') {   // 内容不是样式规则
          const e = matchBrace(s, i);
          if (e < 0) break;
          i = e + 1; continue;
        }
        if (/@media|@supports|@layer|@container/.test(name)) stack.push(p);
        i++; continue;
      }
      if (!p) { i++; continue; }
      const end = matchBrace(s, i);
      if (end < 0) break;
      const line = lineOf(i);
      const decls = parseDecls(s.slice(i + 1, end));
      for (const sel of p.split(/,(?![^()]*\))/).map(x => x.trim()).filter(Boolean)) {
        rules.push({ sel, media: stack.length ? stack[stack.length - 1] : null, line, decls });
      }
      i = end + 1;
      continue;
    }
    if (ch === '}') { if (stack.length) stack.pop(); prelude = ''; i++; continue; }
    prelude += ch; i++;
  }
  return rules;
}
/** 规则表里,是否存在「未嵌套、且某个复合选择器同时含这些类」的规则 */
function ruleFor(rules, cls) {
  const need = cls.map(c => c.toLowerCase());
  return rules.find(r => r.media === null &&
    compounds(r.sel).some(part => need.every(n => part.includes(n))));
}
/** 取一组规则的声明并集(后者覆盖前者) */
function mergeDecls(rules) {
  const out = {};
  for (const r of rules) Object.assign(out, r.decls);
  return out;
}
/** border 简写 → style;没有就 null。用于 G4 的「空/满在几���通道上不同」 */
function borderStyle(d) {
  if (d['border-top-style']) return d['border-top-style'];
  if (d['border-style']) return d['border-style'];
  const b = d['border-top'] || d.border;
  if (!b) return null;
  const t = b.split(/\s+/);
  for (const w of t) if (w === 'dashed' || w === 'dotted' || w === 'solid' || w === 'double' || w === 'none') return w;
  return null;
}
/** 取某通道的归一化值(缩写的 border 会被拆到 style/color 两个通道上) */
function channel(d, ch) {
  if (ch === 'border-style') return borderStyle(d);
  if (ch === 'border-color') return d['border-top-color'] || d['border-color'] || (d['border-top'] || d.border || null);
  if (ch === 'background') return d.background || d['background-color'] || null;
  if (ch === 'opacity') return d.opacity || null;
  if (ch === 'box-shadow') return d['box-shadow'] || null;
  if (ch === 'padding') return d.padding || null;
  if (ch === 'min-height') return d['min-height'] || null;
  return d[ch] || null;
}

/** 契约里的 15 个类名 → 19 条必须存在的选择器(稀有度 4 档拆成 4 条) */
const CONTRACT = [
  ['.xx-gear'], ['.xx-gear-slots'], ['.xx-gear-slot'], ['.xx-gear-slot', '.drop-ok'],
  ['.xx-gear-slot-icon'], ['.xx-gear-slot-name'], ['.xx-gear-slot-item'], ['.xx-gear-slot-empty'],
  ['.xx-gear-bag'], ['.xx-gear-item'], ['.xx-gear-item-icon'], ['.xx-gear-item-name'],
  ['.xx-gear-item', '.rarity-1'], ['.xx-gear-item', '.rarity-2'],
  ['.xx-gear-item', '.rarity-3'], ['.xx-gear-item', '.rarity-4'],
  ['.xx-gear-item', '.worn'], ['.xx-gear-drag'], ['.xx-gear-hint'],
];

// 名色:这些必须走令牌。transparent / currentColor / inherit / none 是关键字不是色值。
const NAMED_COLOR = /\b(red|green|blue|yellow|orange|purple|pink|brown|gray|grey|white|black|cyan|magenta|silver|gold|beige|ivory|tan|salmon|coral|crimson|indigo|violet|azure|lavender|plum|orchid|khaki|olive|maroon|navy|teal|lime|aqua|fuchsia|whitesmoke|gainsboro|slategray|rebeccapurple)\b/i;
const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i;
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;

/**
 * 判定函数:纯函数,输入一段 CSS 文本,输出问题清单。
 * 真实文件与合成样本走的是同一条路径 —— G5 靠这一点证明它会红。
 */
function judge(css, knownVars = new Set()) {
  const rules = parseRules(css);
  const f = [];
  const add = (code, msg) => f.push({ code, msg });

  // —— G1 契约类名一个都不能少(少一个 = 那条元素没样式,视觉上退化成默认流)——
  for (const sel of CONTRACT) {
    if (!ruleFor(rules, sel)) add('G1', `没有规则: ${sel.join('')}`);
  }

  // —— G2 不得有字面色值;var(--xx-*) 必须真的定义过 ——
  for (const r of rules) {
    for (const [p, v] of Object.entries(r.decls)) {
      // 先把 var(--xx-gold-soft) 这类**令牌引用**抠掉再扫字面色值 ——
      // 否则 NAMED_COLOR 会把令牌名里的 "gold"/"tan" 当成字面色值。
      // (第一版就栽在这:8 条全是 var(--xx-gold*) 的假红。)
      const lit = v.replace(/var\(\s*--[\w-]+\s*(?:,[^()]*)?\)/g, 'VAR');
      const hit = HEX.exec(lit) || COLOR_FN.exec(lit) || NAMED_COLOR.exec(lit);
      if (hit) add('G2', `${r.sel} { ${p}: ${v} } 里有字面色值 ${hit[0]}(第 ${r.line} 行)`);
      for (const m of v.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (knownVars.size && !knownVars.has(m[1])) add('G2', `${r.sel} 引用了没有定义的令牌 ${m[1]}(第 ${r.line} 行)`);
      }
    }
  }

  // —— G3 背包必须真能滚,且不许被 touch-action 掐死 ——
  const bag = rules.filter(r => r.media === null && compounds(r.sel).some(p => p.length === 1 && p[0] === '.xx-gear-bag'));
  if (!bag.length) {
    add('G3', '没有 .xx-gear-bag 的规则 —— 背包区没有样式,谈不上滚动');
  } else {
    const d = mergeDecls(bag);
    const ov = d['overflow-y'] || d.overflow || '';
    if (!/(auto|scroll|overlay)/.test(ov)) add('G3', `.xx-gear-bag 的 overflow 是「${ov || '没写'}」,溢出时不产生滚动`);
    // ⚠️ 这条是本门禁最贵的一条:overflow-y:auto 但没有高度上限 ⇒ 容器跟着内容长高 ⇒ 永远滑不动。
    //    owner 说的「滑动不了」有一半就是它。
    if (!d['max-height'] && !d.height && !d['block-size']) {
      add('G3', '.xx-gear-bag 没有任何高度上限(max-height/height),overflow-y:auto 永远触发不了');
    }
    if ((d['-webkit-overflow-scrolling'] || '') !== 'touch') add('G3', '.xx-gear-bag 缺 -webkit-overflow-scrolling:touch(惯性滚动)');
    if (!/contain/.test(d['overscroll-behavior'] || d['overscroll-behavior-y'] || '')) {
      add('G3', '.xx-gear-bag 缺 overscroll-behavior*:contain(滚到边界会把外层 .xx-body 一起带着跑)');
    }
  }
  for (const r of rules) {                      // touch-action:none 出现在任何地方都不行
    const t = r.decls['touch-action'] || r.decls['touch-action-x'] || r.decls['touch-action-y'];
    if (t && /(^|[\s,])none($|[\s,])/.test(t)) {
      add('G3', `${r.sel} 写了 touch-action:${t}(第 ${r.line} 行) —— 会连纵向滚动一起禁掉,正是「向下拉不了」`);
    }
  }

  // —— G4 空槽与已穿槽必须在**非文字**通道上可区分 ——
  // ⚠️ 第一版这里写错过:拿 .xx-gear-slot-empty(子元素)去比 .xx-gear-slot + :has(...)(父框),
  //    两边 padding/min-height 天生就不同 → 恒 ≥2 个差异 → **空槽只改文字也照样绿**。
  //    实测反向注入:把虚线/底色差异全删掉,第一版 EXIT=0。现在分两层比,层内同类相比。
  // ⚠️ pure() 必须用**不展平 :has()** 的切分。
  //    展平后 `.xx-gear-slot:has(.xx-gear-slot-empty)` 里那个参数会变成一个独立复合段,
  //    于是「框」的规则被算进「元素」的规则里 —— 实测:空槽只改文字时 G4 仍 EXIT=0。
  const pure = cls => rules.filter(r => r.media === null && rawCompounds(r.sel).some(p => p.length === 1 && p[0] === cls));
  const frameHas = re => rules.filter(r => r.media === null && re.test(r.sel));
  // 通道表里**不含** color/字体 —— 只靠文字改色骗不过这两条
  const CH = ['border-style', 'border-color', 'background', 'opacity', 'box-shadow', 'padding', 'min-height'];
  const diffOf = (a, b) => {
    const da = mergeDecls(a), db = mergeDecls(b);
    return CH.filter(c => { const x = channel(da, c), y = channel(db, c); return (x || y) && x !== y; });
  };
  const eEls = pure('.xx-gear-slot-empty'), iEls = pure('.xx-gear-slot-item');
  const fEmpty = frameHas(/:has\(\s*\.xx-gear-slot-empty\s*\)/);
  const fFull = frameHas(/:has\(\s*\.xx-gear-slot-item\s*\)/);
  if (!eEls.length) add('G4', '没有 .xx-gear-slot-empty 的规则 —— 空槽没有独立样式,只能靠文字区分');
  if (!iEls.length) add('G4', '没有 .xx-gear-slot-item 的规则 —— 已穿槽没有独立样式');
  // 层 1:槽位**框**的空/满
  if (!fEmpty.length) add('G4', '没有 .xx-gear-slot:has(.xx-gear-slot-empty) —— 空槽的框和满槽长得一样,只剩文字不同');
  else if (!fFull.length) add('G4', '没有 .xx-gear-slot:has(.xx-gear-slot-item) —— 满槽的框没有单独样式');
  else {
    const d = diffOf(fEmpty, fFull);
    if (d.length < 2) add('G4', `槽位框 空/满 只在 ${d.length} 个非文字通道上不同(需 ≥2):[${d.join(',') || '无'}]`);
  }
  // 层 2:空槽提示 vs 槽里那件装备的名字(同类元素相比)
  if (eEls.length && iEls.length) {
    const d = diffOf(eEls, iEls);
    if (d.length < 2) add('G4', `空槽提示 vs 已穿装备名 只在 ${d.length} 个非文字通道上不同(需 ≥2):[${d.join(',') || '无'}]`);
  }

  // —— G8 稀有度四档必须真的分得开 ——
  // 只判「四档各写了一个颜色」不够:四档全写同一个色也满足它。
  // 判据是四档的取值**互不相同** —— 与 owner 的「边界不清晰」直接对位。
  {
    const seen = [];
    for (let i = 1; i <= 4; i++) {
      // 注意:不能用「复合段只有一个类」的写法 —— .xx-gear-item.rarity-1 是**两个**类 token
      const rs = rules.filter(r => r.media === null && compounds(r.sel).some(p => p.includes('.xx-gear-item') && p.includes(`.rarity-${i}`)));
      if (!rs.length) { add('G8', `没有 .xx-gear-item.rarity-${i} 的规则`); continue; }
      const v = mergeDecls(rs).color || null;
      if (!v) add('G8', `.xx-gear-item.rarity-${i} 没有 color 声明,品质色没落下来`);
      else seen.push(v);
    }
    if (seen.length === 4 && new Set(seen).size < 4) {
      add('G8', `四档稀有度只用了 ${new Set(seen).size} 种颜色(取值:${[...new Set(seen)].join(' / ')})—— 肉眼分不出档次`);
    }
  }

  // —— G7 拖拽幽灵必须不吃事件 ——
  // 幽灵是 pointer-events:auto 时,它自己就是最上层的命中目标,
  // JS 的 elementFromPoint 永远打在幽灵身上 → 拖到槽位放不上去,而且**不报错**。
  const ghost = rules.filter(r => r.media === null && compounds(r.sel).some(p => p.length === 1 && p[0] === '.xx-gear-drag'));
  if (ghost.length) {
    const gd = mergeDecls(ghost);
    if ((gd['pointer-events'] || '') !== 'none') {
      add('G7', `.xx-gear-drag 的 pointer-events 是「${gd['pointer-events'] || '没写'}」—— 幽灵会吃掉落点判定,装备拖到槽位放不上去`);
    }
  }
  return { findings: f, rules };
}

// ════════════════════════════════════════════════════════════
// G5 反向注入自检:合成样本 —— 不碰真实文件
// ════════════════════════════════════════════════════════════
const GOOD = `
.xx-gear{display:flex;gap:18px}
.xx-gear-slots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.xx-gear-slot{border:1px solid var(--xx-line-2);background:var(--xx-bg-1);padding:10px}
.xx-gear-slot:has(.xx-gear-slot-item){background:var(--xx-bg-2);border-style:solid}
.xx-gear-slot:has(.xx-gear-slot-empty){border-style:dashed;background:transparent}
.xx-gear-slot.drop-ok{border-color:var(--xx-gold);box-shadow:0 0 0 2px var(--xx-gold-soft)}
.xx-gear-slot-icon{width:42px;height:42px;background:var(--xx-ink-3)}
.xx-gear-slot-name{color:var(--xx-paper-dim)}
.xx-gear-slot-item{border-top:1px solid var(--xx-line-2);color:var(--xx-paper)}
.xx-gear-slot-empty{border-top:1px dashed var(--xx-line-1);color:var(--xx-paper-faint);background:transparent}
.xx-gear-bag{overflow-y:auto;max-height:min(58vh,440px);-webkit-overflow-scrolling:touch;
  overscroll-behavior-y:contain;touch-action:pan-y}
.xx-gear-item{border:1px solid var(--xx-line-1);background:var(--xx-bg-1);color:var(--xx-paper-dim)}
.xx-gear-item-icon{width:38px;height:38px}
.xx-gear-item-name{font-size:11.5px}
.xx-gear-item.rarity-1{color:var(--xx-paper-faint)}
.xx-gear-item.rarity-2{color:var(--xx-jade)}
.xx-gear-item.rarity-3{color:var(--xx-qi)}
.xx-gear-item.rarity-4{color:var(--xx-cinnabar)}
.xx-gear-item.worn{border-color:var(--xx-gold-dim);background:var(--xx-bg-2)}
.xx-gear-drag{position:fixed;pointer-events:none}
.xx-gear-hint{padding:9px 12px;color:var(--xx-paper-dim)}
`;
const G5_CASES = [
  // 第一项期望「零问题」而不是「包含某个码」——
  // 写成后者的话,好样本里混进任何一条假红都会被放过(第一版就是这么放过 8 条 var(--xx-gold*) 假红的)。
  ['好样本', GOOD, []],
  ['删掉背包的 overflow-y', GOOD.replace('overflow-y:auto;', ''), ['G3']],
  ['背包只有 auto 没有高度上限', GOOD.replace('max-height:min(58vh,440px);', ''), ['G3']],
  ['加上 touch-action:none', GOOD.replace('touch-action:pan-y', 'touch-action:none'), ['G3']],
  ['漏掉 .xx-gear-drag', GOOD.replace('.xx-gear-drag{position:fixed;pointer-events:none}', '.xx-gear-ghost{position:fixed}'), ['G1']],
  ['漏掉 .xx-gear-item.rarity-3', GOOD.replace('.xx-gear-item.rarity-3{color:var(--xx-qi)}', ''), ['G1']],
  ['写死字面色值', GOOD.replace('color:var(--xx-jade)', 'color:#6f8f6a'), ['G2']],
  ['空槽与已穿槽只剩文字不同', GOOD.replace('.xx-gear-slot-empty{border-top:1px dashed var(--xx-line-1);color:var(--xx-paper-faint);background:transparent}',
    '.xx-gear-slot-empty{border-top:1px solid var(--xx-line-2);color:var(--xx-paper)}'), ['G4']],
  // 第一版 G4 的漏网之鱼:只删掉空槽的框规则,文字差异留着 → 必须红
  ['空槽的框规则被删', GOOD.replace('.xx-gear-slot:has(.xx-gear-slot-empty){border-style:dashed;background:transparent}', ''), ['G4']],
  ['四档稀有度压成同一色', GOOD.replace('color:var(--xx-qi)}', 'color:var(--xx-jade)}'), ['G8']],
  ['把契约类藏进注释里', '/* .xx-gear-drag{position:fixed} */\n' + GOOD.replace('.xx-gear-drag{position:fixed;pointer-events:none}', '.xx-gear-ghost{position:fixed}'), ['G1']],
  ['幽灵吃了点击', GOOD.replace('.xx-gear-drag{position:fixed;pointer-events:none}', '.xx-gear-drag{position:fixed;pointer-events:auto}'), ['G7']],
];

console.log('\n[G5] 反向注入自检(合成样本,不碰真实文件)');
{
  let selfFail = 0;
  for (const [name, sample, expect] of G5_CASES) {
    const r = judge(sample);
    const codes = [...new Set(r.findings.map(x => x.code))].sort();
    const hit = expect.length ? expect.every(e => codes.includes(e)) : codes.length === 0;
    if (!hit) selfFail++;
    console.log(`  ${hit ? '✅' : '❌'} ${name}: 期望 ${expect.join(',') || '(零问题)'} → 实得 [${codes.join(',') || '干净'}]`
      + (codes.length && !hit ? ` | ${r.findings[0].msg}` : ''));
  }
  // 样本本身必须解析得出规则,否则上面全是「空解析→零问题→假绿」
  const g = judge(GOOD);
  if (g.rules.length < 15) {
    selfFail++;
    console.log(`  ❌ 好样本只解析出 ${g.rules.length} 条规则 —— 解析器或样本已退化,后面全部无效`);
  } else {
    console.log(`  ✅ 好样本解析出 ${g.rules.length} 条规则(判定不是建立在空解析上)`);
  }
  if (selfFail) { console.log(`\n❌ 门禁自身失效:自检 ${selfFail} 项不过,不再判真实文件`); process.exit(2); }
}

// ════════════════════════════════════════════════════════════
// G6 解析器防退化(真实文件这一侧)
// ════════════════════════════════════════════════════════════
console.log('\n[G6] 解析器防退化');
{
  const src = existsSync(ROOT + '/' + CSS_REL) ? readFileSync(ROOT + '/' + CSS_REL, 'utf8') : '';
  const rules = parseRules(src);
  const MIN = 20;
  if (rules.length < MIN) {
    console.log(`  ❌ ${CSS_REL} 只解析出 ${rules.length} 条规则(下限 ${MIN}) —— 门禁自身失效,退出 2`);
    process.exit(2);
  }
  console.log(`  ✅ 解析出 ${rules.length} 条规则(下限 ${MIN})`);
  const lines = src.split('\n').length;
  if (stripComments(src).split('\n').length !== lines) {
    console.log('  ❌ 剥注释改变了行数 —— 下面所有行号都是错的,门禁自身失效,退出 2');
    process.exit(2);
  }
  console.log(`  ✅ 剥注释保持行数(${lines} 行),行号可信`);
  const probe = parseRules('/* .xx-gear-hint{} */\n.xx-gear-hint{color:var(--xx-paper)}');
  if (ruleFor(probe, ['.xx-gear-hint']) && probe.length === 2) {
    console.log('  ❌ 注释里的规则被当成了真规则 —— 解析器退化,退出 2');
    process.exit(2);
  }
  console.log('  ✅ 注释里的同名规则不会被误认(负向对照)');
}

// ════════════════════════════════════════════════════════════
// 真实文件
// ════════════════════════════════════════════════════════════
// 令牌定义表:从 css/ 下所有样式表收集,供 G2 校验 var(--xx-*) 有没有定义
const defined = new Map();
for (const f of readdirSync(ROOT + '/css').filter(x => x.endsWith('.css'))) {
  for (const m of readFileSync(ROOT + '/css/' + f, 'utf8').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    if (!defined.has(m[1])) defined.set(m[1], m[2].trim());
  }
}
/** 顺着 var() 链解到字面值;解不动返回 null(自我引用/未定义) */
function resolveTok(name, depth = 0) {
  if (depth > 10 || !defined.has(name)) return null;
  const v = defined.get(name);
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
  if (m) return m[1] === name ? null : resolveTok(m[1], depth + 1);
  return v;
}

console.log(`\n[G1][G2][G3][G4] ${CSS_REL} 逐条判定`);
const cssSrc = readFileSync(ROOT + '/' + CSS_REL, 'utf8');
const res = judge(cssSrc, new Set(defined.keys()));

// G1 单独报一遍清单,便于人工核对「19 条到底缺哪条」
{
  const rules = res.rules;
  let n = 0;
  for (const sel of CONTRACT) {
    const r = ruleFor(rules, sel);
    if (r) n++;
    console.log(`  ${r ? '✅' : '❌'} ${sel.join('').padEnd(26)} ${r ? 'css/gear.css:' + r.line : '缺失'}`);
  }
  console.log(`  —— 契约选择器 ${n}/${CONTRACT.length}`);
}

// G2 的令牌链自检(独立于 G1~G4)
for (const [name] of defined) {
  if (!name.startsWith('--xx-')) continue;
  if (resolveTok(name) === null && defined.get(name).includes('var(')) {
    console.log(`  ❌ 令牌 ${name} 解不出字面值(${defined.get(name)}),用它的地方会掉回默认色`);
    res.findings.push({ code: 'G2', msg: `令牌 ${name} 自我引用或未定义` });
  }
}

for (const f of res.findings) console.log(`  ❌ [${f.code}] ${f.msg}`);

const byCode = c => res.findings.filter(f => f.code === c).length;
console.log(`\n判定汇总: G1 缺 ${byCode('G1')} · G2 色值/令牌 ${byCode('G2')} · G3 滚动 ${byCode('G3')} · G4 空满区分 ${byCode('G4')} · G7 幽灵吃事件 ${byCode('G7')} · G8 稀有度分档 ${byCode('G8')}`);
if (res.findings.length) {
  console.log(`\n❌ 装备页版式门禁: ${res.findings.length} 项`);
  process.exit(1);
}

// ── 静态门禁的边界(如实标注)──
// 这里判的是「该写的写没写、滚动会不会被掐死、空满两态有没有分」，
// **判不了**的:真机上滑动手感、留白多少算够、配色好不好看。
// 那部分只能靠人看截图或 CI 的浏览器套件 —— 本机没有 chromium,不假装能测。
console.log('\n✅ 装备页版式门禁全绿(静态判定;真机手感与观感不在本门禁能力内)');
process.exit(0);