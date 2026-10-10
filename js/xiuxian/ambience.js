// ===== 昼夜 · 场景切换与氛围音 =====
// 不是一个布尔值。白天/黄昏/夜晚各有色调、雾浓度、音景,
// 切换时有过渡。夜里怪物更强,篝火更重要。

import { DAY } from './items.js';
import { SFX } from '../core/audio.js?v=17';
import { CHRONICLE } from './chronicle.js';

export const PHASES = {
  dawn:  { key:'dawn',  name:'晨', tint:'#3a3020', fog:0.18, hue:-8,  bright:0.9,
           amb:'birds', d:'天光微亮,露气未消。妖物最弱的时候。',
           mul:0.82, safe:true },
  day:   { key:'day',   name:'昼', tint:'#4a4436', fog:0.06, hue:0,   bright:1.05,
           amb:'wind',  d:'日头正高。视野最清。',
           mul:1.0, safe:true },
  dusk:  { key:'dusk',  name:'暮', tint:'#5a3a28', fog:0.22, hue:14,  bright:0.82,
           amb:'crow',  d:'日落西山,妖气渐起。',
           mul:1.25, safe:false },
  night: { key:'night', name:'夜', tint:'#141a2e', fog:0.42, hue:-24, bright:0.55,
           amb:'wolf',  d:'夜色压山。点燃篝火。',
           mul:1.65, safe:false },
};

// 用 WebAudio 合成氛围音(不打包任何外部音频,零版权风险)
let ctx = null, nodes = [], cur = null, timer = null;

function ensureCtx() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return null; }
  return ctx;
}

function stopAll() {
  for (const n of nodes) { try { n.stop ? n.stop() : n.disconnect(); } catch {} }
  nodes = [];
}

// 各阶段的氛围音:低频风声 / 夜虫 / 远犬吠
function buildAmb(phase, vol) {
  const c = ensureCtx();
  if (!c) return;
  stopAll();
  // ⚠️ 原来 out.connect(c.destination) —— 绕过了 SFX 的 musicBus。
  // 结果:UI 上关掉「音乐」只降 musicBus,环境音照样响;
  // 而且第一次任意点击 ambience.init() 就自动开声,玩家根本没得选。
  // 表现就是关掉音乐后还有一层「蜂鸣」(白天那个 1400Hz triangle)。
  // 现在挂到 musicBus —— 音乐开关对它生效。
  const out = c.createGain();
  out.gain.value = 0;
  const bus = (typeof SFX !== 'undefined' && SFX && SFX.musicBus) ? SFX.musicBus : c.destination;
  out.connect(bus);
  out.gain.linearRampToValueAtTime(vol * 0.5, c.currentTime + 2.2);   // 淡入

  // 底噪:低频滤波白噪 = 风
  const len = c.sampleRate * 3;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random()*2 - 1;
    last = (last + 0.02*w) / 1.02;      // 布朗噪声,更像风
    d[i] = last * 3.2;
  }
  const src = c.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = phase.key==='night' ? 320 : phase.key==='dusk' ? 500 : 700;
  const g = c.createGain(); g.gain.value = phase.key==='night' ? 0.55 : 0.32;
  src.connect(f); f.connect(g); g.connect(out);
  src.start();
  nodes.push(src, f, g);

  // 夜虫已删除(XX-AUDIO-004 · owner 授权我决定)。
  //
  // 原来是夜/黎明叠一层 osc.frequency = 3200/2600Hz 的**纯 sine**,
  // 配 LFO 0.28Hz 调幅。听起来是「嗡————嗡————」的**周期性蜂鸣**,
  // 不是虫鸣 —— 虫鸣之所以像虫鸣靠的是高频**脉冲**,持续音+慢 LFO
  // 恰恰是电子蜂鸣的特征。
  //
  // 而同一个文件里已经有先例:日间那声 1400Hz triangle 就是因为
  // 「落在人耳最敏感的频段,听起来就是蜂鸣」被删的。夜虫 3200Hz
  // 比它还高 2.3 倍,同一类投诉的同一类音源。
  //
  // 来历查证:全仓库只有 CHANGELOG.md:901 提过它,那是
  // 「WebAudio 实时合成、零外部音频文件」的实现记录,不是产品理由。
  // 详见 TICKETS.md XX-AUDIO-004。
  //
  // 风声底噪(上面那段)全部保留 —— 它承载「昼夜不同」,是氛围音真正的表达。
}

export const Ambience = {
  vol: 0.5,
  enabled: false,

  init() {
    // 首次用户手势后开声
    const go = () => {
      this.enabled = true;
      this.apply(true);
      document.removeEventListener('pointerdown', go);
      document.removeEventListener('keydown', go);
    };
    document.addEventListener('pointerdown', go);
    document.addEventListener('keydown', go);
  },

  // 切换到当前时段(带过渡)
  apply(force) {
    const ph = PHASES[DAY.phase().key] || PHASES.day;
    if (!force && cur === ph.key) return;
    cur = ph.key;
    if (this.enabled) buildAmb(ph, this.vol);
    // 通知 UI 做色调过渡
    document.documentElement.style.setProperty('--xx-day-tint', ph.tint);
    document.documentElement.style.setProperty('--xx-day-fog', ph.fog);
    document.documentElement.style.setProperty('--xx-day-bright', ph.bright);
    Bus_on('dayphase', ph);
  },

  phase() { return PHASES[DAY.phase().key] || PHASES.day; },
  isNight() { return DAY.isNight(); },
  // 怪物强度系数(昼夜)
  mobMul() { return this.phase().mul; },
  setVol(v) { this.vol = v; if (cur) buildAmb(this.phase(), v); },
  stop() { stopAll(); this.enabled = false; cur = null; },
};

// 轻量事件总线(避免额外依赖)
let _subs = {};
function Bus_on(ev, fn) { (_subs[ev] = _subs[ev] || []).push(fn); }
export const onDayPhase = fn => Bus_on('dayphase', fn);

// —— 切换音效:黄昏/夜晚转场时的「锣」——
export function phaseChime(from, to) {
  const c = ensureCtx();
  if (!c || !Ambience.enabled) return;
  // 转夜:低沉钟鸣;转晨:清脆磬声
  const night = to === 'night';
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = night ? 'sine' : 'triangle';
  osc.frequency.setValueAtTime(night ? 180 : 880, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(night ? 90 : 660, c.currentTime + 1.6);
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(night ? 0.28 : 0.16, c.currentTime + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 2.2);
  // ⚠️ XX-PLAY-003:原来这里是 `g.connect(c.destination)` —— **绕过了 musicBus**。
  //   这是 buildAmb 之外的**第二条**绕过路径,后果一样:玩家在 UI 上把「音乐」关掉,
  //   环境音没了、这声锣照样敲。属于「我明明关了,它还在响」那一类投诉。
  //   现在与 buildAmb 走同一条总线 —— 音乐开关对它同样生效。
  const bus = (typeof SFX !== 'undefined' && SFX && SFX.musicBus) ? SFX.musicBus : c.destination;
  osc.connect(g); g.connect(bus);
  osc.start(); osc.stop(c.currentTime + 2.4);
}