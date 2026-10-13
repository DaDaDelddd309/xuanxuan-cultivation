#!/usr/bin/env node
// 音频电平门禁 —— 真跑 js/core/audio.js,量总线上的实际峰值
//
// 为什么要有这条(XX-AUDIT-023,2026-10-11 实测):
//
//   `lint-audio.mjs` 管的是**波形**(蜂鸣、音效名、滤波器挂没挂),
//   它一个字都没提过**音量**。而外部审计的音频审计整篇都在谈 dBFS,
//   给出的却是两条**结构上不成立**的 P0:
//
//   「P0-1 团战削波」:spawner 允许一次 50 只同帧死,enemies.js 会连发 50 次 hit,
//                     累计 +14 dBFS 硬削波。
//     → 实测:`SFX.play()` 自带按名字的全局节流表 GAPS(hit:40ms),
//       **不管 emit 方有没有节流**。100 次同帧 hit 只产生 **1 个声部**,
//       总线峰值 -20.0 dBFS。这个场景在代码里跑不出来。
//
//   「P0-2 BGM 轻 20dB」:musicBus 0.25 × master 0.2 = -45.7 dBFS,建议改 0.6。
//     → 实测 -45.7 是**单声部 RMS**,却拿去和 SFX 的**峰值**比,是两种量。
//       真跑 BGM 循环:峰值 -25.6 dBFS,正好落在 shoot(-28.0)和 pickup(-25.0)之间。
//       真按建议改 0.6 → 峰值 -18.0 dBFS,**比 coin(-23.1)还响、比 hurt(-15.9)只差 2dB**,
//       音乐盖音效。改了更糟。
//
// 所以这条门禁不钉「当前数值」,钉**三条关系**——它们能同时否掉上面两条建议,
// 又能在将来真的有人把某个 gain 乘大时变红:
//
//   ① GAPS 节流不变量:同帧 N 次同名 emit 只产生 1 个声部
//   ② 总线输出不削波,且留 ≥3 dB 余量
//   ③ BGM 循环峰值低于最响的常规音效(音乐不盖音效)
//   ④ lowpass 对琶音音高的衰减 < 1 dB(报告说「闷了」,实测 0.42~0.52 dB)
//
// 做法:塞一个假 AudioContext 进去,记录 GainParam 的自动化事件,
// 从**产品代码自己产出的事件**重建包络 —— 不是照着 _tone/_noise 重写一遍公式。
// 重写公式的话,公式抄错就是假数据(这个门禁第一版就栽在这:插值方向写反了)。
//
import { readFileSync } from 'node:fs';
// 运行: node tests/audio-level-regression.mjs

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
// ⚠️ 戳必须跟生产一致(main.js / screens.js 都是 ?v=17)。
// pathToFileURL 会把 `?` 编成 %3F,那样 Node 找不到文件 —— 用 new URL 保留真 query。
const SRC = new URL('../js/core/audio.js?v=17', import.meta.url).href;
const FS = 48000;

// ---------- 假 AudioContext:只记录,不渲染 ----------
let vt = 0;                                   // performance.now() 虚拟毫秒
globalThis.performance = { now: () => vt };
const VOICES = [];

class Param {
  constructor() { this.ev = []; this._v = 0; }
  get value() { return this._v; }
  set value(v) { this._v = v; }
  cancelScheduledValues() {}
  setValueAtTime(v, t) { this.ev.push({ t, v, k: 'set' }); this._v = v; return this; }
  linearRampToValueAtTime(v, t) { this.ev.push({ t, v, k: 'lin' }); this._v = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.ev.push({ t, v, k: 'exp' }); this._v = v; return this; }
}
class ChainNode {
  constructor() { this.gain = new Param(); }
  connect(d) { this.dest = d; return d; }
  disconnect() {}
}
class Biquad extends ChainNode {
  constructor() { super(); this.frequency = new Param(); this.Q = new Param(); this.gain._v = 1; this.type = 'lowpass'; }
}
// ⚠️ 声源节点(AudioScheduledSourceNode)**没有** gain 属性。
//   第一版给它们也挂了一个空 Param,`envAt` 对无自动化事件的参数返回当前值 0,
//   于是整条链乘成 0,scan 恒返 0 —— 而 `0 < 1.0` 是**真的**,
//   「不削波」这条断言就成了一句永远为真的空话。
class Src {
  connect(d) { this.dest = d; return d; }
  disconnect() {}
}
class Osc extends Src {
  constructor() { super(); this.frequency = new Param(); this.type = 'sine'; }
  start(t) { VOICES.push({ node: this, t0: t }); }
  stop() {}
}
class BufSrc extends Src {
  constructor() { super(); this.buffer = null; this.loop = false; }
  start(t) { VOICES.push({ node: this, t0: t }); }
  stop() {}
}
class AudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = FS; this.destination = {}; }
  createGain() { return new ChainNode(); }
  createOscillator() { return new Osc(); }
  createBiquadFilter() { return new Biquad(); }
  createBufferSource() { return new BufSrc(); }
  createBuffer(_c, len) {
    const d = new Float32Array(len);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return { getChannelData: () => d };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}
globalThis.window = globalThis;
globalThis.AudioContext = AudioContext;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

const { SFX } = await import(SRC);
SFX.init();
const ctx = SFX.ctx;

// ---------- 从自动化事件重建包络 ----------
// 段 i = ev[i].t 处的 ev[i].v → ev[i+1].t 处的 ev[i+1].v,插值方式看 ev[i+1].k;
// 最后一段延伸到 +∞(WebAudio 在 ramp 结束后保持目标值)。
function envAt(p, t) {
  const ev = p.ev;
  if (!ev.length) return p._v;          // 无自动化 ⇒ 保持当前值
  if (t < ev[0].t) return 0;            // 节点还没启音
  if (ev.length === 1) return ev[0].v;
  let i = 0;
  for (let k = 0; k < ev.length - 1; k++) { if (t >= ev[k].t) i = k; else break; }
  const a = ev[i], b = ev[i + 1];
  const span = b.t - a.t;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
  if (b.k === 'exp') {
    const av = Math.max(1e-9, a.v), bv = Math.max(1e-9, b.v);
    return av * Math.pow(bv / av, f);
  }
  return a.v + (b.v - a.v) * f;
}
function busOf(v) {
  let n = v.node;
  while (n) { if (n === SFX.sfxBus) return 'sfx'; if (n === SFX.musicBus) return 'music'; n = n.dest; }
  return '?';
}
// 链的终点就是 destination,所以 sfxBus/musicBus/master 的增益已经乘在里面,外面不要再乘一遍
function voiceAt(v, t) {
  if (t < v.t0) return 0;
  let g = 1, n = v.node;
  while (n) {
    if (n.gain) { g *= envAt(n.gain, t); if (g < 1e-7) return 0; }
    n = n.dest;
  }
  return g;
}
function scan(from, to, bus, step = 1 / 2000) {
  let peak = 0;
  for (let t = from; t <= to; t += step) {
    let sum = 0;
    for (const v of VOICES) if (busOf(v) === bus) sum += voiceAt(v, t);
    if (sum > peak) peak = sum;
  }
  return peak;
}
function reset() { VOICES.length = 0; SFX._last = {}; vt = 1000; ctx.currentTime = 1.0; }
function at(ms) { vt = ms; ctx.currentTime = ms / 1000; }   // 音频时钟必须跟着 performance.now 走
const dB = x => (x <= 0 ? -Infinity : 20 * Math.log10(x));

// ---------- 场景 ----------
const FRAME = 16.7;

// 同一个名字在同帧被 emit N 次 → 实际发声几个?
function throttleProbe(name, n) {
  reset();
  for (let i = 0; i < n; i++) { at(1000); SFX.play(name); }
  return VOICES.length;
}

// 一秒团战:每帧射一发 + 命中一件,加上拾取/金币/中伤/冲刺/蒸汽联动
function busyCombat(frames, names) {
  reset();
  let emitted = 0;
  for (let f = 0; f < frames; f++) {
    at(1000 + f * FRAME);
    for (const nm of names) { SFX.play(nm); emitted++; }
  }
  return { emitted, voices: VOICES.length, peak: scan(1.0, 1.0 + frames * FRAME / 1000 + 0.5, 'sfx') };
}

const REALISTIC = ['shoot', 'hit', 'pickup', 'coin', 'hurt', 'dash', 'synergy'];
const EVERYTHING = REALISTIC;

// 单发音效峰值
function singlePeak(name) {
  reset(); at(1000); SFX.play(name);
  return { peak: scan(1.0, 1.9, 'sfx'), voices: VOICES.length };
}

// BGM 一个完整 8 步循环的峰值。
// gain 省略 = 用**产品代码里的现值**。
// ⚠️ 第一版这里写死了 0.25/0.40/0.6 三个数当入参,于是把 audio.js 的
//    musicBus.gain 从 0.25 改成 0.6 时门禁**照样绿** ——
//    断言里存了一份参数的副本,就等于和产品实现脱钩。
//    门禁要能判产品,就不能自己持有被测的那个值。
function bgmLoop(gain) {
  reset(); at(1000);
  if (gain !== undefined) {
    SFX.musicBus.gain.ev.length = 0; SFX.musicBus.gain._v = gain;
  }
  SFX.musicOn = true; SFX._step = 0; SFX._nextT = 1.08;
  const end = 1.0 + 8 * 0.21;
  let guard = 0;
  while (SFX._nextT < end && guard++ < 500) {
    at(SFX._nextT * 1000 - 0.02);
    SFX._schedule();
    if (SFX._nextT < end - 0.0002) SFX._nextT += 0.0001;
  }
  return { peak: scan(1.0, end, 'music'), voices: VOICES.length, gain: SFX.musicBus.gain._v };
}

// RBJ Audio EQ Cookbook · LPF 幅频响应(采样率已约掉)
function lpDb(f, fc, Q, fs = FS) {
  const cw = Math.cos(2 * Math.PI * fc / fs), al = Math.sin(2 * Math.PI * fc / fs) / (2 * Q);
  const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al, k = (1 - cw) / 2;
  const b1 = 1 - cw;
  const w = 2 * Math.PI * f / fs;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = k / a0 + (b1 / a0) * c1 + (k / a0) * c2;
  const ni = -((b1 / a0) * s1 + (k / a0) * s2);
  const dr = 1 + (a1 / a0) * c1 + (a2 / a0) * c2;
  const di = -((a1 / a0) * s1 + (a2 / a0) * s2);
  const d = Math.hypot(dr, di);
  return d < 1e-12 ? -Infinity : 20 * Math.log10(Math.hypot(nr, ni) / d);
}

// ---------- 断言 ----------
let pass = 0, fail = 0;
const failed = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failed.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
// 「量到 0」和「不削波」在数字上长得一模一样 —— 0 < 1.0 永远成立。
// 所以任何一次测量都必须先证明这条总线**真的有信号**,否则后面所有
// 「峰值 < 阈值」的断言都只是空话(本门禁第一版就栽在这,报告了一个
// -Infinity dBFS 的峰值却判了绿)。
const sane = (label, m) => {
  const good = m.peak > 0 && m.voices > 0;
  ok(`${label}:探针确实量到了信号(声部 ${m.voices},峰值 ${m.peak.toExponential(2)})`, good,
    '量到 0 说明探针坏了,不能拿来判「不削波」');
  return good;
};

console.log('\n[1] GAPS 节流:节流表在 play() 里,和 emit 方有没有节流无关');
{
  const v = throttleProbe('hit', 100);
  ok('同帧 100 次 hit 只发 1 个声部(报告 P0-1 的场景跑不出来)', v === 1, `实测 ${v} 个`);
  const v2 = throttleProbe('hit', 50);
  ok('同帧 50 次 hit 也只发 1 个', v2 === 1, `实测 ${v2} 个`);
}
{
  // 结构性不变式:GAPS 必须**盖住 DEFS 的每一个名字**。
  // play() 里 `const gap = GAPS[name] || 0` —— 名字不在表里 gap 就是 0,
  // 那一路就完全没有节流,同帧叠加上限变成「调用次数」。
  // 这比报告设想的削波场景危险得多,而且是静默的。
  const src = readFileSync(new URL('../js/core/audio.js', import.meta.url), 'utf8');
  const gapBlock = src.slice(src.indexOf('const GAPS = {'), src.indexOf('};', src.indexOf('const GAPS = {')));
  // ⚠️ DEFS 的切片必须止于它自己的 `};` —— 取固定长度会越过边界,
  //    把后面 SFX 对象里的 init() 也当成一个音效定义。
  const defStart = src.indexOf('const DEFS = {');
  const defBlock = src.slice(defStart, src.indexOf('\n};', defStart));
  const gaps = new Set([...gapBlock.matchAll(/([a-z]+)\s*:\s*\d+/g)].map(m => m[1]));
  const defs = new Set([...defBlock.matchAll(/^\s{2}([a-z][a-z0-9]*)\s*\(\)\s*\{/gm)].map(m => m[1]));
  console.log(`     GAPS ${gaps.size} 个名字 / DEFS ${defs.size} 个定义`);
  const uncovered = [...defs].filter(d => !gaps.has(d));
  ok('每个 DEFS 音效都在 GAPS 节流表里(否则该路完全不受限)', uncovered.length === 0,
    uncovered.length ? `漏:${uncovered.join(',')}` : '');
  ok('每个音效都定了最小触发间隔', gaps.size >= 15, `GAPS 只有 ${gaps.size} 项`);
}

console.log('\n[2] 总线不削波(master 输出 < 0 dBFS,且留余量)');
const busy = busyCombat(120, REALISTIC);
console.log(`     团战场景:2 秒内 emit ${busy.emitted} 次 → 峰值 ${dB(busy.peak).toFixed(1)} dBFS`);
if (sane('团战', busy)) {
  ok('真实团战峰值 < 0 dBFS(不削波)', busy.peak < 1.0, `${dB(busy.peak).toFixed(1)} dBFS`);
  ok('真实团战峰值 ≤ -3 dBFS(留了余量)', busy.peak <= 10 ** (-3 / 20), `${dB(busy.peak).toFixed(1)} dBFS`);
}

const spam = busyCombat(120, EVERYTHING);
if (sane('极端上限', spam)) {
  ok('每帧全 emit 的极端上限仍不削波', spam.peak < 1.0, `${dB(spam.peak).toFixed(1)} dBFS`);
}

console.log('\n[3] BGM 不能盖住音效(报告建议 0.25 → 0.6,这条会红)');
const sfx = {};
for (const n of ['coin', 'hurt', 'pickup', 'hit']) sfx[n] = singlePeak(n);
const loudName = Object.keys(sfx).reduce((a, b) => (sfx[a].peak > sfx[b].peak ? a : b));
const loudestRoutine = sfx[loudName].peak;
console.log(`     最响的常规音效: ${loudName} ${dB(loudestRoutine).toFixed(1)} dBFS`);

// ① 产品现值(从 SFX.musicBus 读,不在这儿写死)
const prod = bgmLoop();
console.log(`     BGM 产品现值 musicBus=${prod.gain}:循环峰值 ${dB(prod.peak).toFixed(1)} dBFS`);
if (sane('BGM 产品现值', prod)) {
  ok('BGM(产品现值)峰值低于最响的常规音效', prod.peak < loudestRoutine,
    `BGM ${dB(prod.peak).toFixed(1)} vs ${loudName} ${dB(loudestRoutine).toFixed(1)} dBFS`);
}

// ② init() 的初值与 setMusic(true) 的 ramp 目标必须是同一个数 ——
//    audio.js:73 和 :116 各写了一份 0.25,改一个不改另一个,
//    表现是「音乐开关打开后音量莫名变了」。这里钉住两份不漂移。
{
  const initGain = SFX.musicBus.gain._v;
  SFX.musicBus.gain.ev.length = 0;
  at(2000); SFX.setMusic(true);
  const ramp = SFX.musicBus.gain.ev;
  const target = ramp.length ? ramp[ramp.length - 1].v : NaN;
  ok('setMusic(true) 的 ramp 目标 == init 里的 musicBus 增益',
    Math.abs(target - initGain) < 1e-9, `init ${initGain} vs ramp ${target}`);
  SFX.musicOn = false; SFX.setMusic(false);
}

// ③ 对照:报告建议的 0.6 会盖住 coin —— 这是「为什么那条建议不能采纳」的证据,
//    故意临时改值跑一次,跑完不写回任何全局状态。
const m6 = bgmLoop(0.6);
console.log(`     [对照] 报告建议的 musicBus=0.6:循环峰值 ${dB(m6.peak).toFixed(1)} dBFS`);
if (sane('BGM musicBus=0.6(对照)', m6)) {
  ok('反证:musicBus=0.6 会盖住 coin(所以这条建议不能采纳)', m6.peak > sfx.coin.peak,
    `${dB(m6.peak).toFixed(1)} vs ${dB(sfx.coin.peak).toFixed(1)} dBFS`);
}

console.log('\n[4] lowpass 对琶音音高的衰减 < 1 dB(报告说「旋律会闷」)');
{
  const fc = SFX.musicFilter.frequency.value, Q = SFX.musicFilter.Q.value;
  console.log(`     musicFilter: lowpass fc=${fc}Hz Q=${Q}`);
  for (const [f, label] of [[659, 'M_ARP[1]/[3]'], [698, 'M_ARP[5]']]) {
    const a = lpDb(f, fc, Q);
    console.log(`     ${f}Hz(${label}): ${a.toFixed(2)} dB`);
    ok(`${f}Hz 衰减 < 1 dB(不可闻)`, a > -1, `${a.toFixed(2)} dB`);
  }
  ok('截止频率仍是 1200Hz(抬到 1800+ 只会把蜂鸣源放回来)', fc === 1200, `fc=${fc}`);
  const buzz = lpDb(1976, fc, Q);
  ok('对蜂鸣源(110Hz 三次谐波 1976Hz)仍有 >6 dB 抑制', buzz < -6, `${buzz.toFixed(2)} dB`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 音频电平门禁:${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);