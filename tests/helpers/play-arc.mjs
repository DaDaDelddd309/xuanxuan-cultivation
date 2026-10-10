// tests/helpers/play-arc.mjs —— 「走完一条剧情线」的共用驱动
//
// 为什么抽出来:duel-echo-regression 和 story-echo-regression 各自有一份
// playArc(),两份都写成 `STORY.arrive(b.node)`。
// XX-WORLD-007(剧情改按类型锚定)之后,这么写会让两条线**同时**从绿变红 ——
// 而且报出来的错是「还没看完」/「没回声」,看着像产品缺陷,实则是测试写法过时。
//
// 一份实现,一个地方修。
//
// ⚠️ 为什么不能直接 arrive(b.node):
//   beat 写的是 `node:'n8' nodeType:'boss'`,而地图 V0.97 起按种子生成 ——
//   默认种子下 n8 实测是 **field**。story.js 的类型判定会**正确地**拒绝它。
//   story.js 没写错,是「假设 n8 永远是 boss」这个前提不成立了。
import { STORY, ARCS } from '../../js/xiuxian/story.js';
import { WORLD } from '../../js/xiuxian/world.js';

/**
 * 按 beat 的类型在当前世界里找一个真实节点。
 *
 * 优先级:
 *   ① beat 自带的 node 本身就是该类型 → 直接用它(最忠实于「剧情原本就该在那」)
 *   ② 否则找一个同类型、且本线还没用过的节点
 *   ③ 都找不到 → 退回 beat 自带的 node(旧存档/精简环境,story.js 会放行)
 *
 * ⚠️ 第一版把 ① 跳过了(写的是 `n.type===t && n.id!==target`),
 *   于是明明 n14 就是 village 却被排除,只好去找别人 ——
 *   laolao/tomb/jiangu 三条线因此推不完。
 */
export function nodeForBeat(beat, used) {
  if (!beat.nodeType) return beat.node;
  const nodes = WORLD.nodes || [];
  const self = nodes.find(n => n.id === beat.node);
  // ⚠️ beat 自带的节点类型对得上时,**必须用它**,不许「优化」成别的同类节点。
  //    tomb 线的三环都写 node:'n8' —— 它们本来就是同一个地点的连续三段
  //    (墓道 → 刻满名字的石壁 → 石将背上的字)。换成另一个 boss 节点后,
  //    tomb.js 里的 `atGuard()` 判不到 'sj',finish 直接返回
  //    「你还没走到石将跟前」—— t89 从 89/0 掉到 85/4。
  if (self && self.type === beat.nodeType) return beat.node;
  const usedSet = used instanceof Set ? used : new Set();
  // ① 优先没用过的同类型节点
  let hit = nodes.find(n => n.type === beat.nodeType && !usedSet.has(n.id));
  if (hit) return hit.id;
  // ② 同类型但都用过了 —— **仍然用它**。
  //    第二版漏了这个分支,结果退回 beat 自带的 id(类型不符),
  //    story.js 正确拒绝 → laolao/tomb/jiangu 三条线推不完。
  //    报出来的错是「没回声」,看着像功能坏了,实则是我 helper 的 fallback 写错。
  hit = nodes.find(n => n.type === beat.nodeType);
  if (hit) return hit.id;
  // ③ 世界里根本没有该类型(精简环境/假世界)→ 退回自带 id,story.js 会放行
  return beat.node;
}

/** 真实走完一条线并结案。不注入任何状态(AGENTS.md §0A 第 2 问)。
 *  @param key  线的 key
 *  @param path 结局 1 / 2
 *  @param echoFn 回声来源回调,默认返回 { text: [] }
 *  @param opts.surfaceOnly=true 时**只走地表环**,墓内房间环留给墓流程
 *         (tomb 线的末环 room:'sj' 由 tomb.js 触发;一次性全走完会让
 *          「地表走3环」这类断言失真 —— 它要验的正是「地表推满了但还没结案」)
 */
export function playArc(key, path, echoFn, opts) {
  const arc = ARCS[key];
  STORY.reset();
  STORY.start(key);
  const used = new Set();
  for (const b of arc.beats) {
    if (b.room) { if (opts && opts.surfaceOnly) break; STORY.arriveRoom(b.room); continue; }
    const target = nodeForBeat(b, used);
    used.add(target);
    STORY.arrive(target);
  }
  return STORY.finish(key, path, echoFn || (() => ({ text: [] })));
}

/** 只推进不结案(某些断言要看中途状态)。
 *  ⚠️ **不重置存档** —— 调用方常常已经 `reset()`+`start()`+`see(...)` 摆好了前置。
 *     第一版在这里又调一次 reset+start,把 t89 的 `see('shijiang')` 冲掉了,
 *     于是支线不同步、finish 判不到 'sj' —— 报错长��「结案失败」,与真实原因无关。
 */
export function walkArc(key, opts) {
  const arc = ARCS[key];
  const used = new Set();
  for (const b of arc.beats) {
    if (b.room) { if (opts && opts.surfaceOnly) break; STORY.arriveRoom(b.room); continue; }
    const target = nodeForBeat(b, used);
    used.add(target);
    STORY.arrive(target);
  }
}

/** 只走地表环(不含墓内房间)—— t89 验「地表推满但未结案」时用 */
export function walkSurface(arcKey) {
  walkArc(arcKey, { surfaceOnly: true });
}
