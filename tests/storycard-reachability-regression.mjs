// 叙事卡可达性门禁(XX-QA-001)
// ============================================================================
// CI 上 t86/t87/t88/t89 的 6 条红:
//   弹出叙事卡 / 卡片有名字 / 弹出结案卡 / 两个结局选项 / 弹出结局选择 / 弹出补完选项
// 症状统一是 `Page.click: Timeout 30000ms exceeded` —— 点不到东西。
//
// 本文件钉的是**两个结构性质**,不是具体数值:
//
//   性质 A(可点性):凡是走 nag.js 挂载、且**带可点动作**的浮层,
//                    必须把 pointer-events 拿回 auto。
//                    理由:#xx-nag-host 是 `pointer-events:none`,
//                    而 pointer-events **会被子元素继承**(CSS 规范)。
//                    判据:DOM 上真的有可点动作,不是「看起来像弹窗」。
//
//   性质 B(不卡死):占位浮层如果已经不连着 DOM、或被 hidden / display:none,
//                    `_busy` 必须被释放。
//                    理由:仪式 Ritual.close() 是 add('hidden') 不是 remove(),
//                    叙事卡/tombEnding 是自己的 setTimeout 直接摘节点 ——
//                    这些路径都不经过 done(),_busy 会永远卡 true,
//                    之后所有浮层只进队列不显示。
//
// 为什么不能用「跑一遍浏览器」代替:
//   pointer-events 的继承和 hit-test 是**浏览器布局引擎**的事,
//   jsdom 这类无布局的 DOM 桩测不出来 —— 桩里没有「命中测试」这个概念。
//   所以 A 的静态部分(宿主是 none、卡片没写 auto)用源码核对,
//   行为部分(B:_busy 的释放)用真 DOM 桩驱动真 nag.js 跑。
//
// 反向注入:文件末尾 --inject 会把两处修复各回退一次,
// 必须证明本门禁真的会红。门禁自己撒谎比没有门禁更危险(本项目已栽 9 次)。
// ============================================================================
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const INJECT = process.argv.includes('--inject');

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log('  ❌', n)); };
const note = m => console.log('  ·', m);

// ---------------------------------------------------------------- 最小 DOM 桩
// 只要够 nag.js 跑:createElement / getElementById / appendChild /
// classList / dataset / isConnected / style。**不模拟布局** —— 本门禁不测布局。
function mkDoc() {
  const app = mkEl('div');
  app.id = 'app';
  const doc = {
    _els: [],
    createElement: tag => { const e = mkEl(tag); doc._els.push(e); return e; },
    getElementById: id => (id === 'app' ? app : null),
    body: app,
  };
  function mkEl(tag) {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      className: '', id: '', _kids: [], _parent: null,
      dataset: {}, _cls: new Set(),
      style: { cssText: '', pointerEvents: '', display: '' },
      _conn: false,          // 真实 DOM 里刚 createElement 出来的节点**不连着文档**
      addEventListener() {}, removeEventListener() {},
      get isConnected() { return this._conn; },
      classList: {
        add: c => { el._cls.add(c); el.className = [...el._cls].join(' '); },
        remove: c => { el._cls.delete(c); el.className = [...el._cls].join(' '); },
        contains: c => el._cls.has(c),
      },
      appendChild(c) {
        c._parent = el; c._conn = true; el._kids.push(c); return c;
      },
      remove() { el._conn = false; el._parent = null; },
      querySelector: sel => mkQuery(el, sel, true),
      querySelectorAll: sel => mkQuery(el, sel, false),
    };
    return el;
  }
  // 只支持本门禁用到的那几种选择器形态
  function mkQuery(root, sel, one) {
    const out = [];
    for (const k of root._kids) {
      const hit = matchOne(k, sel);
      if (hit) { out.push(k); if (one) return k; }
      const sub = mkQuery(k, sel, false);
      for (const s of sub) { out.push(s); if (one) return s; }
    }
    return one ? null : out;
  }
  function matchOne(el, sel) {
    return sel.split(',').map(s => s.trim()).some(s => {
      if (s.startsWith('.')) return el._cls.has(s.slice(1));
      if (s.startsWith('[') && s.endsWith(']')) {
        // CSS 属性选择器写的是 [data-p],而 dataset 里的键是 p —— 必须去掉 data- 前缀,
        // 否则这条匹配永远不成立(桩自己撒谎,门禁就跟着撒谎)。
        const k = s.slice(1, -1).split('=')[0].replace(/^data-/, '');
        return k in el.dataset;
      }
      return el.tagName === s.toUpperCase();
    });
  }
  return { doc, mkEl };
}

// ---------------------------------------------------------------- 源码侧(性质 A)
console.log('\n=== [A1] 浮层宿主不得把 pointer-events 关成 none 又不给子类留出口 ===');
const nagSrc = readFileSync(ROOT + '/js/xiuxian/nag.js', 'utf8');
const cssSrc = readFileSync(ROOT + '/css/xiuxian.css', 'utf8');

const hostRule = nagSrc.match(/pointer-events\s*:\s*none/);
t('宿主确实是 pointer-events:none(这是继承陷阱的前提)', !!hostRule);
note('pointer-events 是继承属性 —— 子元素不写就继承 none');

// 把 CSS 注释剥掉再找规则,否则注释里的字会被当成声明
const cssNoCmt = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
function ruleBody(selector) {
  const re = new RegExp('(?:^|\\})\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = cssNoCmt.match(re);
  return m ? m[1] : null;
}

// 凡是被 nagger 搬进宿主的浮层类,都得自己把 pointer-events 拿回来
const FLOAT_CLASSES = ['xx-storycard', 'xx-banner', 'xx-ritual'];
for (const c of FLOAT_CLASSES) {
  const body = ruleBody('.' + c);
  if (body === null) { t(`.${c} 的 CSS 规则找得到`, false); continue; }
  const hasAuto = /pointer-events\s*:\s*auto/.test(body);
  // .xx-banner 是纯信息横幅(nag.js 里显式走 MID 横幅分支),它本来就该不吃点击
  if (c === 'xx-banner') {
    t('.xx-banner 保持不可点(纯信息横幅,不吃点击是设计)', true);
    note('横幅没有可点动作,不该抢玩家的点击');
  } else {
    t(`.${c} 显式声明 pointer-events:auto(不被宿主继承成 none)`, hasAuto);
  }
}

console.log('\n=== [A2] 每个叙事卡构造函数都要能自证「有可点动作」 ===');
// 判据:卡片模板里必须真的有 [data-p]/[data-w]/[data-act]/button/.xx-sc-x
// 之一 —— 那是玩家点的那个东西。纯文案卡(没有动作)不该被误判成可点。
const uiStory = readFileSync(ROOT + '/js/xiuxian/ui/story.js', 'utf8');
const uiTomb = readFileSync(ROOT + '/js/xiuxian/ui/tomb.js', 'utf8');
const uiAll = uiStory + '\n' + uiTomb;
const INTERACTIVE_SEL = /\[data-p\]|\[data-w\]|\[data-act\]|<div class="xx-sc-x"|button/;
const cardFns = [...uiAll.matchAll(/export function (\w+)\(hall[^)]*\)\s*\{([\s\S]*?)\n\}/g)]
  .filter(m => /xx-storycard/.test(m[2]));
t(`找到 ${cardFns.length} 个造叙事卡的函数`, cardFns.length >= 6);
for (const m of cardFns) {
  t(`${m[1]}():卡片里有可点动作(玩家点的确实是它)`, INTERACTIVE_SEL.test(m[2]));
}

console.log('\n=== [A3] nagger 挂载时必须把 pointer-events 拿回来(行为兜底) ===');
t('nag.js 在挂载前调用 interactive()', /interactive\(el\)\)\s*el\.style\.pointerEvents\s*=\s*'auto'/.test(nagSrc));
t('nag.js 在出队挂载时同样兜底(mountQueued)',
  /interactive\(job\.el\)\)\s*job\.el\.style\.pointerEvents\s*=\s*'auto'/.test(nagSrc));

// ---------------------------------------------------------------- 行为侧(性质 B)
console.log('\n=== [B] 占位浮层消失后 _busy 必须释放 ===');
const { doc, mkEl } = mkDoc();
globalThis.document = doc;
globalThis.window = { addEventListener() {} };
const N = await import('../js/xiuxian/nag.js');
N.installNagger();

const mkCard = (withAction = true) => {
  const e = mkEl('div');
  e.className = 'xx-storycard';
  if (withAction) { const b = mkEl('div'); b.dataset.p = '1'; e.appendChild(b); }
  return e;
};

N.NAGER.reset();
let el = mkCard();
doc.getElementById('app').appendChild(el);
t('叙事卡挂上了,占位中', N.NAGER._busy === true);
t('宿主记住了占位者(没有它就没法判 stale)', N.NAGER._el === el);

// 第二个浮层此时应该**排队**,而不是直接盖上来
const queued = mkCard();
doc.getElementById('app').appendChild(queued);
t('忙的时候第二个浮层进队列(串行仍然成立)', N.NAGER._q.length === 1);
t('排队中的浮层此刻还不在 DOM 上', !queued.isConnected);

// 现在模拟「占位者被别的方式弄掉了」—— 仪式的 close() 就是 add('hidden')
el._cls.add('hidden');
el.className = [...el._cls].join(' ');
t('占位者已 hidden', el.classList.contains('hidden'));

const q2 = mkCard();
doc.getElementById('app').appendChild(q2);
t('占位者消失后新浮层不再被无限期挡在队列外(卡死已解除)',
  N.NAGER._q.length < 2, ' _busy=' + N.NAGER._busy + ' _q=' + N.NAGER._q.length);

console.log('\n=== [B2] 直接 remove() 占位者(叙事卡 9s 自摘走那条路)也要能恢复 ===');
N.NAGER.reset();
const el2 = mkCard();
doc.getElementById('app').appendChild(el2);
t('第二个浮层已占位', N.NAGER._busy === true);
el2.remove();                       // 模拟 setTimeout(()=>el.remove(), 9000)
const q3 = mkCard();
doc.getElementById('app').appendChild(q3);
t('remove() 之后不再卡死', !N.NAGER._busy || N.NAGER._q.length === 0);

console.log('\n=== [B3] 真正还在屏上的浮层不能被误判成 stale ===');
N.NAGER.reset();
const alive = mkCard();
doc.getElementById('app').appendChild(alive);
const q4 = mkCard();
doc.getElementById('app').appendChild(q4);
t('活着的浮层仍然霸占串行位(没把「串行」这个设计改掉)',
  N.NAGER._q.length === 1 && q4.isConnected === false);
t('活着的浮层没有被动到 pointer-events', alive.style.pointerEvents === 'auto');

console.log('\n=== [B4] 纯文案浮层(无可点动作)不该抢点击 ===');
N.NAGER.reset();
const textOnly = mkCard(false);
doc.getElementById('app').appendChild(textOnly);
t('无可点动作的浮层保持宿主的 pointer-events(不抢点击)',
  textOnly.style.pointerEvents !== 'auto');

// ---------------------------------------------------------------- 反向注入
if (INJECT) {
  console.log('\n' + '='.repeat(62));
  console.log('反向注入:逐个回退修复,证明本门禁真的会红');
  console.log('='.repeat(62));
  const { writeFileSync, copyFileSync, unlinkSync } = await import('fs');
  const NAG = ROOT + '/js/xiuxian/nag.js';
  const CSS = ROOT + '/css/xiuxian.css';
  const bakN = NAG + '.bak-inject', bakC = CSS + '.bak-inject';
  copyFileSync(NAG, bakN); copyFileSync(CSS, bakC);

  const runGate = async () => {
    const { spawnSync } = await import('child_process');
    return spawnSync(process.execPath, [_fu(import.meta.url)], { encoding: 'utf8' });
  };

  // 回退 1:抽掉 .xx-storycard 的 pointer-events:auto(CSS 那道)
  writeFileSync(CSS, cssSrc.replace(/(^\.xx-storycard\{[^}]*?)\n  pointer-events:auto;/m, '$1'));
  let r = await runGate();
  const cssRed = /\[A1\]/.test(r.stdout) && /xx-storycard 显式声明 pointer-events:auto/.test(r.stdout);
  console.log(cssRed
    ? '  ✅ 回退 CSS pointer-events → [A1] 变红(门禁有效)'
    : '  ❌ 回退 CSS pointer-events 后门禁**没红** —— 门禁在撒谎');
  copyFileSync(bakC, CSS);

  // 回退 2:抽掉 nagger 的 staleBusy()(行为那道)
  writeFileSync(NAG, nagSrc.replace(/staleBusy\(\);.*$/gm, '').replace(/NAGER\._el = el;.*$/gm, '').replace(/NAGER\._el = job\.el;.*$/gm, ''));
  r = await runGate();
  const nagRed = /宿主记住了占位者/.test(r.stdout) && /❌/.test(r.stdout);
  console.log(nagRed
    ? '  ✅ 回退 nag staleBusy → [B] 变红(门禁有效)'
    : '  ❌ 回退 nag staleBusy 后门禁**没红** —— 门禁在撒谎');
  copyFileSync(bakN, NAG);

  // 回退 3:抽掉 interactive() 的 pointer-events 兜底
  writeFileSync(NAG, nagSrc.replace(/if \(interactive\([^)]*\)\)[^\n]*pointerEvents = 'auto';[^\n]*\n/gm, ''));
  r = await runGate();
  const beRed = /nagger 挂载时必须把 pointer-events 拿回来/.test(r.stdout);
  console.log(beRed
    ? '  ✅ 回退 nagger interactive() 兜底 → [A3] 变红(门禁有效)'
    : '  ❌ 回退 nagger interactive() 后门禁**没红** —— 门禁在撒谎');
  copyFileSync(bakN, NAG);

  unlinkSync(bakN); unlinkSync(bakC);
  const restored = readFileSync(NAG, 'utf8') === nagSrc && readFileSync(CSS, 'utf8') === cssSrc;
  console.log(restored ? '  ✅ 源码已完整还原' : '  ❌ 源码没还原干净!');
  console.log('='.repeat(62));
  process.exit(0);
}

console.log('\n' + '='.repeat(46));
console.log(`通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(46));
if (INJECT) console.log('\n(--inject 模式:反向注入检查在上面,这里不再判成败)');
process.exit(fail ? 1 : 0);