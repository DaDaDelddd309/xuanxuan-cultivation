// ===== 立绘 / 场景 / BGM 加载器 =====
// 懒加载:用时才加载,首屏不受影响。BGM 遵守优先级调度。
import { Bus } from '../core/engine.js';

const A = {
  portrait: {
    hero: 'assets/portrait/hero.jpg',
    foe:  'assets/portrait/foe.jpg',
    aunt: 'assets/portrait/aunt.jpg',
  },
  bg: {
    duel: 'assets/bg/duel.jpg',
    cave: 'assets/bg/cave.jpg',
    sect: 'assets/bg/sect.jpg',
  },
  bgm: {
    bgm_nemesis:  'assets/bgm/nemesis.mp3',
    bgm_overlord: 'assets/bgm/overlord.mp3',
  },
};

const cache = new Map();
const inflight = new Map();

export function img(kind, name) {
  const key = kind + ':' + name;
  if (cache.has(key)) return cache.get(key);
  const p = new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('加载失败: ' + key));
    im.src = (A[kind] && A[kind][name]) || (kind === 'bgm' ? name : '');
  });
  inflight.set(key, p);
  cache.set(key, p);
  return p;
}

export function portrait(name) { return img('portrait', name); }
export function scene(name)    { return img('bg', name); }

// ---- BGM ----
// 优先级:宿敌(3) > 越级大佬(2) > 回合制(1) > 环境(0)
const PRIO = { bgm_nemesis: 3, bgm_overlord: 2, bgm_turn: 1, bgm_field: 0, bgm_town: 0 };
let cur = null, curPrio = -1, el = null, unlocked = false;

function ensureEl() {
  if (el) return el;
  el = new Audio();
  el.loop = true;
  el.volume = 0.42;
  el.preload = 'none';
  document.body.appendChild(el);
  return el;
}

// 浏览器要求用户手势后才能播
export function unlock() {
  if (unlocked) return;
  unlocked = true;
  const a = ensureEl();
  a.muted = true;
  a.play().catch(() => {});
  setTimeout(() => { a.muted = false; }, 120);
  document.removeEventListener('pointerdown', unlock);
  document.removeEventListener('keydown', unlock);
}
document.addEventListener('pointerdown', unlock);
document.addEventListener('keydown', unlock);

export function play(track) {
  const p = PRIO[track] ?? 0;
  if (cur === track) return;
  if (p < curPrio) return;           // 低优先级不打断高优先级
  const src = A.bgm[track];
  if (!src) return;
  const a = ensureEl();
  a.src = src;
  cur = track; curPrio = p;
  a.play().catch(() => { /* 自动播放限制,下次手势再试 */ });
}

export function stop() {
  curPrio = -1; cur = null;
  if (el) { el.pause(); }
}

export function setVolume(v) { if (el) el.volume = Math.max(0, Math.min(1, v)); }

// 由 relations.BGM 通过 Bus 事件驱动
Bus.on('bgm', ({ track }) => {
  if (!track) stop(); else play(track);
});
