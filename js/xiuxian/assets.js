// ===== 立绘 / 场景 / BGM 加载器 =====
// 懒加载:用时才加载,首屏不受影响。BGM 遵守优先级调度。
import { Bus } from '../core/engine.js?v=17';
import { Save } from '../core/save.js?v=17';

const A = {
  portrait: {
    hero: 'assets/portrait/hero.jpg',
    foe:  'assets/portrait/villain-moying.jpg',
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

// ---- BGM(mp3)----
// 优先级:宿敌(3) > 越级大佬(2) > 回合制(1) > 环境(0)
const PRIO = { bgm_nemesis: 3, bgm_overlord: 2, bgm_turn: 1, bgm_field: 0, bgm_town: 0 };

// XX-AUDIT-023:「音乐」开关之前**只管合成音**。
//
//   合成音走 WebAudio:SFX.setMusic() → musicBus → musicFilter → master → destination
//   mp3  走 HTMLAudioElement:el.volume = 0.42 → 扬声器
//
// 两条路**没有任何连线关系**,而 applySetting('music') 只调了 SFX.setMusic(v)。
// 结果:玩家在设置里关掉音乐,宿敌战 / 越级大佬战的 BGM 照播不误 ——
// 这是三套音频栈割裂里唯一一条玩家真能撞上的(音效开关同样管不到 mp3,
// 但 mp3 里只有 BGM,没有音效,所以只有「音乐」这一条会露馅)。
//
// 现在 mp3 也听同一份 settings.music。
const MP3_VOL = 0.42;        // mp3 侧相对音量(合成音那一侧是 SFX.master = 0.2,两套口径本就不同)
let cur = null, curPrio = -1, el = null, unlocked = false;
let enabled = null;         // null = 尚未与存档同步过;此时按「允许」处理

function musicAllowed() {
  // Save.data 在模块加载时就等于 defaults(),load() 也只会把它换成 sanitize 后的结果,
  // 而 sanitize 保证 d.settings.music 是布尔值(save.js:65 的 toBool)——
  // 所以这里读的一定在。**故意不写 try**:
  // 包一层 catch 只会把「存档结构变了」静默降级成「音乐照响」,
  // 那比抛出来难查得多,lint-silent-catch 也会把它判红。
  return Save.data.settings.music !== false;
}

function applyVolume() {
  if (!el) return;
  el.volume = enabled === false ? 0 : MP3_VOL;
}

function ensureEl() {
  if (el) return el;
  el = new Audio();
  el.loop = true;
  el.volume = enabled === false ? 0 : MP3_VOL;
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
  // 音乐关着就不播,也不记为「当前曲目」—— 记住的话之后重新打开音乐会
  // 因为 `cur === track` 而直接 return,声音再也回不来。
  if (enabled === false) { stop(); return; }
  const a = ensureEl();
  a.src = src;
  cur = track; curPrio = p;
  a.play().catch(() => { /* 自动播放限制,下次手势再试 */ });
}

export function stop() {
  curPrio = -1; cur = null;
  if (el) { el.pause(); }
}

// 由 main.js applySetting('music') 经 Bus 推过来。
// 关掉时**立刻**停掉正在播的 mp3(光在下次切歌时检查不够:
// 玩家能在宿敌战途中打开暂停把音乐关掉)。
export function setEnabled(on) {
  enabled = !!on;
  if (!enabled) { if (el) { el.volume = 0; el.pause(); } curPrio = -1; cur = null; return; }
  applyVolume();
}

// 由 relations.BGM 通过 Bus 事件驱动
Bus.on('bgm', ({ track }) => {
  enabled = musicAllowed();           // 每次切歌都以存档为准(开机时开关状态就是靠这条落地的)
  if (!track) stop(); else play(track);
});

// 「音乐」开关的变化。合成音那一侧由 SFX.setMusic 自己处理,这里只管 mp3。
Bus.on('music-setting', v => setEnabled(v));
