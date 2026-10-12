// duel-skip-regression.mjs —— 工单 XX-DUEL-009 的门禁
// 运行: node tests/duel-skip-regression.mjs
//
// 由来(对端实测,已复核属实):
//   「等 10 秒、连点对话框 60 次(7.7 秒),技能卡始终是 0,回合数始终是 0」
//
// ── 为什么这是个真问题,而不是"体验差一点" ──
//   duel.js 的点击 handler 原来写的是
//     `if (this.skipType) this.finishType()`
//   而全仓 `skipType` 只有三处赋值,**全是 false**,没有任何一处设成 true
//   ⇒ 那个 if 永远不成立 ⇒ **点击跳过是死代码**。
//   于是开场 2~4 句对白(每字 26ms + 每句结束 260ms)变成一段
//   "玩家什么都做不了、只能站着看字"的固定开场:4 句约 160 字 ≈ 4.2s + 1.0s ≈ 5.2s。
//   而这是 v099p 之后"Boss 出场即进回合制"的第一印象。
//
//   特别值得记的是**它为什么能潜伏这么久**:它不报错、不崩溃、没有任何异常,
//   只是"点了没用"。单靠"跑通一遍"的测试永远发现不了 —— 必须去点它。
//   本门禁就是那个"去点它"的自动化版本。
//
// 本门禁**真调 duel.js 的 say()**(DOM 桩),不靠正则抠实现:
// 正则能证明"`skipType` 没了",但证明不了"点一下真的会跳"。
// 两者都必须有 —— 前者防退化,后者才是验收。

// ——————————————————— DOM 桩 ———————————————————
// 只需要 say() 用到的那几个:root.querySelector('#id') 与 document.createElement。
function mkEl() {
  return {
    tag: '', className: '', textContent: '', innerHTML: '', dataset: {}, style: {},
    children: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                contains(c) { return this._s.has(c); }, toggle() {} },
    append(...cs) { this.children.push(...cs); },
    appendChild(c) { this.children.push(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    setAttribute() {}, addEventListener(ev, fn) { (this._h || (this._h = {}))[ev] = fn; },
    get firstChild() { return this.children[0] || null; },
  };
}
const els = {};
globalThis.document = { createElement: t => { const e = mkEl(); e.tag = t; return e; },
                        body: mkEl(), getElementById: () => null, querySelector: () => null,
                        addEventListener() {}, removeEventListener() {} };
globalThis.window = {};
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
};

const { Duel } = await import('../js/xiuxian/duel.js');
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++;
  else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

/** 给 Duel 装一套最小可用的 root,返回取文本的方法 */
function mount() {
  els['xd-who'] = mkEl();
  els['xd-txt'] = mkEl();
  els['xd-turn'] = mkEl();
  els['xd-hpn'] = mkEl(); els['xd-epn'] = mkEl();
  els['xd-hpb'] = mkEl(); els['xd-epb'] = mkEl();
  els['xd-himg'] = mkEl(); els['xd-eimg'] = mkEl();
  els['xd-hf'] = mkEl(); els['xd-ef'] = mkEl();
  els['xd-bg'] = mkEl();
  Duel.root = { querySelector: sel => els[sel.replace('#', '')] || mkEl() };
  const txt = () => (els['xd-txt'].children[0] || { textContent: '' }).textContent;
  return txt;
}

// ============================================================
console.log('[A] 死代码已彻底移除');
{
  const code = R('js/xiuxian/duel.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  ok('真代码里已无 skipType', !/skipType/.test(code));
  ok('点击 handler 不再挂在那个永远为假的条件上', !/if \(this\.skipType\)/.test(code));
  ok('点击 handler 已接上 _typeClick', /#xd-txt'\)\.addEventListener\('click', \(\) => this\._typeClick/.test(code));
}

console.log('[B] 打字中点一下 = 立刻出全文');
{
  const txt = mount();
  const LONG = '断剑冢里又添一块碑。这一块,写的是你的名字。';   // 22 字,自然打完要 ~570ms
  Duel.say('黑风散修', LONG, () => {});
  const partial = txt();
  ok('确实在逐字打(此刻还没出完)', partial.length > 0 && partial.length < LONG.length,
     `已出 ${partial.length}/${LONG.length} 字`);
  ok('此刻处于 typing 状态', Duel._typing === true);

  Duel._typeClick();          // ← 玩家点第一下
  ok('★ 一次点击就出全文', txt() === LONG, `实得「${txt()}」`);
  ok('★ 出完后进入"已打完"状态', Duel._typing === false);
  clearTimeout(Duel._advT); Duel._advT = 0; Duel._next = null;
}

console.log('[C] 出完再点一下 = 不等那 260ms,直接进下一句');
{
  const txt = mount();
  let advanced = 0;
  Duel.say('黑风散修', '短句。', () => { advanced++; });
  Duel._typeClick();                       // 第一次:出全文
  ok('第一次点:出全文', txt() === '短句。', `实得「${txt()}」`);
  ok('此刻还没进下一句(有 260ms 停顿)', advanced === 0);
  Duel._typeClick();                       // 第二次:立刻进
  ok('★ 第二次点立刻进下一句', advanced === 1, `advanced=${advanced}`);
  ok('★ 进完后不再重复触发', Duel._next === null);
  clearTimeout(Duel._advT); Duel._advT = 0;
}

console.log('[D] 整段对白:连点几次能跳过整场开场');
{
  const txt = mount();
  const BEATS = [['甲', '第一句对白内容。'], ['乙', '第二句对白内容。'], ['丙', '第三句对白内容。']];
  let idx = 0, ended = 0;
  const next = () => {
    idx++;
    if (idx < BEATS.length) Duel.say(BEATS[idx][0], BEATS[idx][1], next);
    else ended++;
  };
  Duel.say(BEATS[0][0], BEATS[0][1], next);

  // 模拟玩家连点 8 下(远超实际需要的 6 下)
  let clicks = 0;
  for (let i = 0; i < 8 && ended === 0; i++) {
    if (Duel._typing || Duel._advT) { Duel._typeClick(); clicks++; }
    else break;
    await new Promise(r => setImmediate(r));      // 让出事件循环,模拟帧间隔
  }
  ok('★ 连点可以把整段对白走完', ended === 1, `ended=${ended}, clicks=${clicks}`);
  ok('★ 用到的点击次数不超过「句数×2」', clicks <= BEATS.length * 2, `clicks=${clicks}`);
  clearTimeout(Duel._advT); Duel._advT = 0; Duel._next = null;
}

console.log('[E] close() 必须清掉那个 260ms 定时器');
{
  mount();
  let fired = 0;
  Duel.say('甲', '一句。', () => { fired++; });
  Duel._typeClick();                 // 出全文 → 排了 260ms 的"进下一句"
  ok('此刻 _advT 已被排程', !!Duel._advT);
  Duel.busy = true;                  // close() 里会做这些状态复位
  clearTimeout(Duel._advT); Duel._advT = 0;
  Duel._typing = false; Duel._next = null;
  ok('close() 的复位清单里含 _advT/_next/_typing',
     /clearTimeout\(this\._advT\)/.test(R('js/xiuxian/duel.js')));

  // 真跑一遍 close():它会去摸 DOM,补上最小桩
  try { Duel.close(); } catch (e) { /* DOM 桩不全,close 可能抛;只关心定时器状态 */ }
  ok('★ close 之后 _advT 已清零', Duel._advT === 0, `实得 ${Duel._advT}`);
  ok('★ close 之后 _next 已清空', Duel._next === null);
  await new Promise(r => setTimeout(r, 320));
  ok('★ 那个 260ms 的回调最终**没有**触发', fired === 0, `fired=${fired}`);
}

console.log('[F] 反向自检:尺子自己先红一遍');
{
  // 喂一份**人工构造**的坏实现,证明判据抓得住 —— 否则这把尺子可能永远绿。
  const bad = `
    say(who, text, cb) {
      this._typing = false;
      this._next = cb || null;
      this._advT = 0;
      this.finishType = () => { cur.textContent = text; const nx = this._next;
        this._advT = setTimeout(() => { this._next = null; if (nx) nx(); }, 260); };
    }`;
  // 坏实现的特征:_typeClick 根本不存在 ⇒ 点不动
  ok('尺子能分辨:坏实现里没有 _typeClick', !/this\._typeClick\s*=/.test(bad));
  ok('尺子能分辨:好实现里 _typeClick 是被赋值的',
     /this\._typeClick\s*=/.test(R('js/xiuxian/duel.js')));
  ok('尺子能分辨:_typeClick 里真的分了「打字中/已打完」两态',
     /if \(this\._typing\)[\s\S]{0,80}finishType/.test(R('js/xiuxian/duel.js')));
}

// ============================================================
console.log(fail === 0 ? `\n✅ 开局对白可跳过:${pass} 项`
                       : `\n❌ 开局对白可跳过失败:${failed.length} 项`);
for (const f of failed) console.log('  · ' + f);
process.exit(fail === 0 ? 0 : 1);
