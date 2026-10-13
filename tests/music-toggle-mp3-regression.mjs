#!/usr/bin/env node
// mp3 BGM 必须听「音乐」开关 —— 回归门禁(XX-AUDIT-023)
//
// 背景:本项目有**三套**音频栈,它们的音量控制互不相干:
//
//   ① core/audio.js   WebAudio 合成音 + 合成 BGM  → SFX.master(0.2) / SFX.musicBus(0.25)
//   ② xiuxian/assets.js  HTMLAudioElement 播 mp3   → el.volume(0.42)   ← 本门禁的对象
//   ③ xiuxian/ambience.js 合成环境音              → SFX.musicBus(已接上,XX-AUDIO-004)
//
// 而设置面板的「音乐」开关只做了 `SFX.setMusic(v)` —— 只管 ①③。
// ② 那一套走的是完全独立的 <audio> 元素,**没有任何一条线**把开关接过去。
//
// 玩家能撞到的表现:宿敌战 / 越级大佬战的 BGM 是 mp3,
// 玩家在设置里把音乐关掉,战斗音乐照播不误。
//
// 为什么值得单独一条门禁:
//   · lint-audio 只查波形,查不到音量开关的覆盖面
//   · 「设置面板生效」这种接线,两边各自单测都是绿的
//     (assets.js 单测:开关传来我处理了;main.js 单测:我 emit 了)
//     只有**从 Bus 事件走一遍**才知道两头真的接上了
//   · 这类缺陷不会报错、不会崩,只是「有个东西不听使唤」,
//     玩家只会归因为「这游戏做工糙」
//
// 运行: node tests/music-toggle-mp3-regression.mjs
import { readFileSync } from 'node:fs';

// ---------- DOM / Audio / storage 桩 ----------
const created = [];
class FakeAudio {
  constructor() {
    this.loop = false; this.volume = 1; this.muted = false; this.preload = '';
    this.src = null; this._playing = false;
    this.playCalls = 0; this.pauseCalls = 0;
    created.push(this);
  }
  play() { this._playing = true; this.playCalls++; return Promise.resolve(); }
  pause() { this._playing = false; this.pauseCalls++; }
}
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {} },
  getElementById: () => null,
};
globalThis.Audio = FakeAudio;
globalThis.window = globalThis;

const { Bus } = await import(new URL('../js/core/engine.js?v=17', import.meta.url).href);
const { Save } = await import(new URL('../js/core/save.js?v=17', import.meta.url).href);
const assets = await import(new URL('../js/xiuxian/assets.js?v=17', import.meta.url).href);

let pass = 0, fail = 0;
const failed = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failed.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const el = () => created[created.length - 1];
const TRACK = 'bgm_nemesis';

console.log('\n[1] 接线:设置面板那一侧必须真的广播出去');
{
  // 只读源码断言 —— main.js 带 DOM/引擎依赖,整份加载代价太大;
  // 但「applySetting 里有没有 emit」正是本门禁最容易被人悄悄删掉的一行。
  const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const seg = src.slice(src.indexOf('function applySetting'), src.indexOf('function applySetting') + 900);
  ok('applySetting 里有 SFX.setMusic(v)', /SFX\.setMusic\(v\)/.test(seg));
  ok('applySetting 里同时广播 music-setting 给 mp3 那一套',
    /Bus\.emit\(\s*['"]music-setting['"]/.test(seg),
    '少了这行,assets.js 的处理器永远收不到开关变化');
  const asrc = readFileSync(new URL('../js/xiuxian/assets.js', import.meta.url), 'utf8');
  ok('assets.js 订阅了 music-setting', /Bus\.on\(\s*['"]music-setting['"]/.test(asrc));
}

console.log('\n[2] 存档里音乐是关的 → mp3 一次都不该播');
{
  created.length = 0;
  Save.reset();
  Save.data.settings.music = false;
  Bus.emit('bgm', { track: TRACK });
  ok('关音乐时切歌不创建 <audio> 元素', created.length === 0, `实测创建了 ${created.length} 个`);
  ok('关音乐时切歌不播放', created.length === 0 || el().playCalls === 0);
}

console.log('\n[3] 音乐开着 → mp3 正常播,且拿到 MP3_VOL');
{
  created.length = 0;
  Save.data.settings.music = true;
  Bus.emit('bgm', { track: TRACK });
  ok('开音乐时切歌会创建 <audio>', created.length === 1, `实测 ${created.length} 个`);
  ok('开音乐时确实 play() 了', el().playCalls === 1, `playCalls=${el().playCalls}`);
  ok('mp3 src 指向宿敌 BGM', /nemesis\.mp3$/.test(String(el().src)), String(el().src));
  ok('mp3 音量用 MP3_VOL(0.42),不是合成音的 master 0.2', Math.abs(el().volume - 0.42) < 1e-9,
    `volume=${el().volume}`);
}

console.log('\n[4] 播着的时候关开关 → 立刻停,并且不留下「记住的当前曲目」');
{
  // ⚠️ 这里**不能**重置 created —— assets.js 的 `cur` 还记着 [3] 播的那首,
  //    同一首再来一次会被 `if (cur === track) return` 挡掉(这是对的,
  //    不该重复起播)。要测开关行为就得沿着同一次会话往下走。
  //
  // ⚠️ 而且必须**先写存档再广播**,照抄 main.js applySetting 的顺序。
  //    只广播不写存档的话,下一次切歌时 assets.js 的 musicAllowed() 会
  //    按存档(还是 true)把 enabled 翻回去 —— 那不是产品缺陷,
  //    是测试没按真实调用路径走。
  const before = { play: el().playCalls, pause: el().pauseCalls };

  Save.data.settings.music = false;
  Bus.emit('music-setting', false);
  ok('关开关会 pause() 正在播的 mp3', el().pauseCalls > before.pause, `pauseCalls ${before.pause}→${el().pauseCalls}`);
  ok('关开关会把 mp3 音量归 0', el().volume === 0, `volume=${el().volume}`);
  ok('关开关时元素确实已停止播放', el()._playing === false);

  // 「记住的当前曲目」这个坑:如果关的时候不把 cur 清掉,
  // 之后重新打开音乐再切到同一首,`cur === track` 会直接 return,声音再也回不来。
  Save.data.settings.music = true;
  Bus.emit('music-setting', true);
  const volAfter = el().volume;
  ok('重新打开音乐后音量恢复 MP3_VOL', Math.abs(volAfter - 0.42) < 1e-9, `volume=${volAfter}`);

  Bus.emit('bgm', { track: TRACK });
  ok('重新打开音乐后同一首曲目能再次播放', el().playCalls > before.play,
    `playCalls ${before.play}→${el().playCalls}`);
}

console.log('\n[5] 关着的时候即使收到切歌事件也不能偷偷出声');
{
  Save.data.settings.music = false;
  Bus.emit('music-setting', false);
  const playBefore = el().playCalls;
  Bus.emit('bgm', { track: 'bgm_overlord' });   // 换一首,排除 `cur === track` 的早退
  ok('关音乐时切到另一首也不会 play', el().playCalls === playBefore,
    `playCalls ${playBefore}→${el().playCalls}`);
  ok('关音乐时切歌会把音量保持在 0', el().volume === 0, `volume=${el().volume}`);
  ok('assets.stop() 存在且可调用', typeof assets.stop === 'function');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} mp3 音乐开关门禁:${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);