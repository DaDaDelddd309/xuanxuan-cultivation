// 结案回声测试 —— 工单 XX-NET-001
// 运行: node tests/story-echo-regression.mjs
//
// 背景:STORY.s.done 的读取点原本**全部**是「这条线是否已结」的门禁,
// 外加 history() 纯展示 —— 没有任何一处是「结局 A 影响了结局 B」。
// 这张网是放射状的:每条线各自跑,结案不产生横向回响。
//
// 本工单在 finish() 里把尾声首句推进流言池,让商人/鬼火能念出来 ——
// 把放射状变成网状。断言的是**结案 → 流言池 → 可消费**这条链真的通。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

// ---- 环境 shim ----
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.document = { addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: { appendChild() {} }, getElementById: () => null };
globalThis.window = {};

const { STORY, ARCS } = await import('../js/xiuxian/story.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

/**
 * 把一条线从 start 一路推到最后一环。
 * 真实调用 start/arrive/arriveRoom/finish —— 不注入状态(AGENTS.md §0A 第 2 问)。
 *
 * ⚠️ 必须按 beat 自带的键分派:地面上的线走 arrive(node),
 * 墓里的(「半句话」最后一环 room:'sj')走 arriveRoom —— 走错入口那条线根本推不动,
 * 断言会以「没回声」的形式误报成产品缺陷。
 */
function playArc(key, path) {
  const arc = ARCS[key];
  STORY.reset();
  STORY.start(key);
  for (const b of arc.beats) {
    if (b.room) STORY.arriveRoom(b.room);
    else STORY.arrive(b.node);
  }
  return STORY.finish(key, path, () => ({ text: [] }));
}

const FIRST = Object.keys(ARCS)[0];

// ————— 1. 结案必须有回声 —————
{
  const r = playArc(FIRST, 1);
  ok('走完一条线能结案', r.ok === true, JSON.stringify(r));
  ok('结案后流言池里多了一条', STORY.rumorCount() > 0, 'count=' + STORY.rumorCount());
}

// ————— 2. 回声内容 = 尾声首句,且不是第二人称 —————
{
  const arc = ARCS[FIRST];
  const last = arc.beats[arc.beats.length - 1];
  for (const [path, ep] of [[1, last.epilogue], [2, last.epilogue2]]) {
    playArc(FIRST, path);
    const r = STORY.takeRumor();
    ok(`结局${path}的结案有回声`, !!r, 'r=' + r);
    ok(`结局${path}回声不以「你」开头`, r && !/^你/.test(r), 'r=' + r);
    ok(`结局${path}回声出自尾声`, r && ep.includes(r), `r=${r} ep=${ep}`);
    ok(`结局${path}回声是一句(不含句号)`, r && r.length > 0 && r.length < ep.length, 'r=' + r);
  }
}

// ————— 3. 念过不重复 —————
{
  playArc(FIRST, 1);
  const first = STORY.takeRumor();
  const second = STORY.takeRumor();
  ok('同一条流言不会被念第二遍', first !== second || second === null,
     `first=${first} second=${second}`);
}

// ————— 4. 两种结局产生不同回声(网状而非单一出口) —————
{
  playArc(FIRST, 1); const a = STORY.s.rumors.map(x => x.text);
  playArc(FIRST, 2); const b = STORY.s.rumors.map(x => x.text);
  ok('path1 与 path2 的回声不同', a[0] !== b[0], `${a[0]} vs ${b[0]}`);
}

// ————— 5. 每条线都要有回声(不能只有红嫁衣有效) —————
{
  const bad = [];
  for (const key of Object.keys(ARCS)) {
    const r = playArc(key, 1);
    if (!r.ok || STORY.rumorCount() === 0) bad.push(key);
  }
  ok('所有线结案都有回声', bad.length === 0, '没回声的线: ' + bad.join(','));
}

// ————— 6. 容量上限 30 没被破坏 —————
{
  ok('流言池上限仍是 30', (() => {
    STORY.reset();
    for (let i = 0; i < 60; i++) STORY.pushRumor('流言' + i);
    return STORY.s.rumors.length === 30;
  })());
  ok('超容量时丢最旧的', STORY.s.rumors[0].text === '流言59',
     'first=' + STORY.s.rumors[0].text);
}

// ————— 7. 契约:消费端真存在(否则推了也没人念) —————
{
  const merch = readFileSync(ROOT + '/js/xiuxian/merchant.js', 'utf8');
  ok('商人真的消费流言池', /STORY\.takeRumor\(\)/.test(merch));
  const story = readFileSync(ROOT + '/js/xiuxian/story.js', 'utf8');
  ok('finish 内部确实调了 pushRumor', /this\.pushRumor\(echo/.test(story));
}

console.log(`\n结案回声: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项:\n  - ' + failed.join('\n  - ')); process.exit(1); }