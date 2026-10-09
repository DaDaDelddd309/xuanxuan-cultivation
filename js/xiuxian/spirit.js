// ===== 灵气 · 连接「砍杀」与「修仙阁」 =====
// 之前的问题:砍杀和修仙阁基本是两个游戏 ——
//   · 砍杀掉的金币/经验,和修仙阁的道行/源石/背包毫无关系
//   · 修仙阁的护栏、坐骑加成全隐形,玩家在局内看不出来
//
// 现在:局内随机遇见「灵气」,自动吸取;局末结算成道行 + 源石,进修仙阁的行囊。
//
// 设计约束(项目约定):
//   · 不改原版 AI 和战斗循环 —— 只监听 Bus 事件
//   · 不打断:灵气是普通拾取物,碰到就吸,不弹窗
//   · 篝火在烧时收益更高(和现实一致:夜里聚气更快)
import { Bus } from '../core/engine.js?v=17';
import { PAL } from '../core/palette.js';
import { Cult } from './index.js';
import { Bag } from './items.js';
import { CAMP } from './camp.js';
import { gateDrop } from './loot.js';

let _on = false;

// 局内灵气累计(局末一次性结算,避免每帧写 localStorage)
const TALLY = { ling: 0, kills: 0 };

export const SPIRIT = {
  TALLY,

  // —— 装上:开始产出灵气 ——


  install(engine, g) {
    this.__installed = true;
    if (_on) return;
    _on = true;

    // 敌人死亡 → 有概率掉一颗灵气
    //
    // 坑(V0.96,踩了两次):
    // 不能用自定义 kind。原版 pickups.js 在 d<18 时会 **无条件 g.remove()**
    // 任何 kind 的拾取物,而且它的 updater 注册在 43 行,早于我们 300+ 行注册的,
    // 同帧内它先把东西删了,我们的 tick 根本看不到 —— 表现是「掉了 2 颗,累计 0」。
    //
    // 正解:借用原版认得的 kind:'gem'。它会走完整的磁吸 + 拾取 + 音效流程,
    // 我们在 Bus 的 pickup 反馈点记一笔。不改原版一行。
    // 批量累计(XX-DROP-002,owner:「一下子就有几十个怪刷出来,差不多一秒死好多怪的,
    // 如果都按照单独一个怪死亡掉落,这个卡死」)
    //
    // 原来**每只怪死都掷一次骰 + 一次查表**。一波 50 只同类型怪同时死,
    // 就跑 50 次随机 —— 而这 50 次的**期望**和「一次 +50×概率」完全等价,但后者 O(1)。
    //
    // 现在按类型累计:acc += n × rate,攒够 1 才出货。
    //   普通 0.8%/只 → 平均 125 只出一颗(跨局累计,所以不是每局必有)
    //   精英 8%     → 12 只一颗
    //   秘窟 45%    → 2 只一颗
    // 稀有度随难度递增(正/精/浓/焦),上限封顶与保底都在 loot.js 里。
    const bucket = { normal: 0, elite: 0, boss: 0 };
    let timer = 0;
    Bus.on('enemy-death', e => {
      const tier = e.boss ? 'boss' : e.elite ? 'elite' : 'normal';
      bucket[tier]++;
      // 每 8 只结算一次:够密(不丢手感)又够省(一秒几十只只跑几次)
      if (bucket[tier] < 8) return;
      const n = bucket[tier]; bucket[tier] = 0;
      const { drops: got } = gateDrop('spirit', tier, n);
      for (let i = 0; i < got.length; i++) {
        engine.addPickup({
          kind: 'gem', x: e.x + (Math.random() * 40 - 20), y: e.y + (Math.random() * 40 - 20),
          sprite: 'gem_g', r: 10, t: Math.random() * 7,
          xp: 0, __spirit: tier === 'boss' ? 3 : tier === 'elite' ? 2 : 1,
        });
      }
    });

    engine.__spiritHook = true;
  },

  // 每帧:认出被当成 gem 拾走的灵气,补记一笔。
  //
  // 原版在 d<18 时会把 spirit 当 gem 收走(xp:0 所以不给经验,但会 g.remove)。
  // 我们在它之后检查「本帧消失的 spirit」并记账 —— 用 WeakSet 避免重复。
  tick(g) {
    // ⚠️ XX-BUG-D(实测:每杀 1 只产 22 灵气,设计目标是 1.6~4.9,超 4.5~14 倍)
    //
    // 原来的判定是 `if (this._alive.has(k)) TALLY.ling += k.__spirit`,
    // 而 this._alive 在每帧末尾又被重置成「当前还活着的灵气」——
    // 于是**一颗灵气在场上待 N 帧就被记 N 次**。
    // 原意是「本帧消失的(磁吸走的那一颗)记一次」,写成了「在场就记」。
    //
    // 正确写法必须是**状态转移**:上一帧在、这一帧不在。
    // 用 Map 存 上一帧的 {灵气对象: 数值},本帧逐个比对差集。
    const list = g && g.pickups;
    const p = g.player;
    const now = new Map();
    if (list) for (const k of list) if (k.__spirit) now.set(k, k.__spirit);
    const prev = this._prev || new Map();
    this._prev = now;

    if (!p) return;                       // 玩家没了就只更新快照,不记账
    for (const [k, v] of prev) {
      if (now.has(k)) continue;          // 还在场上 —— 还没被吃掉,不算
      TALLY.ling += v;                   // 这一帧消失了 = 被磁吸收走,记一次
      this._got = (this._got || 0) + 1;
      this._burst = (this._burst || 0) + v;
      if (this._burst >= 6) {            // 飘字合并:每 6 点汇总飘一次
        g.spawnText(p.x, p.y - 32, '灵 +' + this._burst, { color: PAL.gold, size: 13, life: .8 });
        this._burst = 0;
      }
    }
  },

  // —— 局末结算:灵气 → 道行 + 源石 ——
  // 返回给结算面板显示的一行字
  settle(g, stats) {
    const ling = TALLY.ling;
    TALLY.ling = 0;
    const kills = stats?.kills || 0;
    if (ling <= 0 && kills <= 0) return null;

    // 篝火在烧 → 聚气更快(昼夜在 COMMATE 里已经影响挂机,这里只补局内)
    const boost = CAMP.burning() ? 1.25 : 1.0;

    // 收益曲线(V0.96 校准):悟一道神通要 3000-5000 道行。
    // 一局砍杀约 100-200 杀,目标给 200-500 道行 —— 大约 1/10 道神通,
    // 这样「多砍几局变强」是明显的,但不会一局就跳一级。
    const dao = Math.round((ling * 0.5 + kills * 1.2) * boost);
    const s = Cult.get();
    s.dao += dao;
    // 每 8 点灵气换 1 颗碎灵石
    // 源石:篝火 15 分钟烧一颗。一局折 30-60 颗 = 篝火能烧 8-15 小时。
    const stones = Math.floor(ling / 12);
    if (stones > 0) Bag.add('stone_1', stones);
    Cult.commit();

    return { ling, dao, stones, boost, kills };
  },

  reset() { TALLY.ling = 0; this._prev = new Map(); this._got = 0; this._burst = 0; },
};
