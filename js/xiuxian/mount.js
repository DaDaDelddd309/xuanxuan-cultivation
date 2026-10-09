// ===== 坐骑 / 宠物 =====
// 和灵伴(companion.js)的分工:
//   灵伴 = 谁陪你(有台词、有好感、有路线)
//   坐骑 = 你骑什么/带什么(纯数值增益,无剧情)
// 两者互不冲突,叠加生效。
//
// 设计约束:
//  · 坐骑不打断游戏。骑上就生效,不需要点任何东西。
//  · 每条坐骑必须有差异化效果,不能只是「数字更大」。
//  · 宠物要真的上场打,不是纯装饰数值。
import { SAVE_KEYS } from './save-keys.js';
import { STORY } from './story.js';
import { TOMB } from './tomb.js';
import { QUEST } from './quest.js';

const K = SAVE_KEYS.mount;

// 坐骑图鉴。kind: ride(骑) / pet(带)
//   ward   篝火护栏半径 +px
//   pickup 局内自动拾取半径倍率(×1.x)
//   speed  局内移动速度 +%
//   atk    宠物攻击(仅 pet)
//   desc   它是什么、为什么给你
export const MOUNTS = {
  tongyaji: {
    id:'tongyaji', kind:'ride', name:'通 途 驹', from:'青石村',
    ward:18, pickup:0.10, speed:4, atk:0,
    lore:'村里拉货的老马。走得不快,但它认得每一条能绕开妖的路。',
    give:'它跟你到营地那天,只说了一句:往东别走夜路。',
    how:'通途驹在青石村。回村里待着,它会自己过来。',
  },
  langyixue: {
    id:'langyixue', kind:'ride', name:'狼 裔 雪', from:'黑风岭',
    ward:34, pickup:0.18, speed:9, atk:0,
    lore:'黑风岭的独狼,毛色像雪。它不让任何人骑,直到那天。',
    give:'它不是被收服的。它是自己跟上来的 —— 走了三十里没出声。',
    how:'狼裔雪在黑风岭(n5)。它不让任何人骑,除非你先在岭上活下来。',
  },
  guibiao: {
    id:'guibiao', kind:'ride', name:'归 鹤 表', from:'落云镇',
    ward:52, pickup:0.26, speed:14, atk:0,
    lore:'落云镇画在幡上的鹤。一杆朱笔点出来的,翅膀是纸做的。',
    give:'画鹤的人早就不在了。可它每年还是会回来落一次。',
    how:'归鹤表要先去落云镇(n9),看有没有人画幡。',
  },
  qiao: {
    id:'qiao', kind:'ride', name:'青 穹', from:'古战场遗迹',
    ward:70, pickup:0.35, speed:20, atk:0,
    lore:'从古战场上空飞过的东西,没人看清过全貌,只看见一道青影。',
    give:'它只让你骑一次。骑完之后,它就再也不回头了。',
    how:'青穹从古战场遗迹(n8)上空过。它只给你一次机会,错过就没了。',
  },
  stonepuppy: {
    id:'stonepuppy', kind:'pet', name:'石 俑 犬', from:'仙人墓',
    ward:0, pickup:0.45, speed:0, atk:26,
    lore:'墓里守门的石像,缺了一条腿,被人凿成了狗的样子。',
    give:'它守了千年守不动了。你把它带出来,它就一路跟着你。',
    how:'石俑犬在仙人墓里。得先见过石将,再走进那座墓,把它带出来。',
  },
  baize: {
    id:'baize', kind:'pet', name:'白 泽 幼 崽', from:'青岚秘境',
    ward:0, pickup:0.80, speed:0, atk:38,
    lore:'白泽生下来的第一只。它还没学会说话,但已经会替你看路了。',
    give:'白泽本来不生崽。是它自己非要留一只。',
    how:'白泽幼崽要你在秘境(n4)亲眼见过白泽。它见过你,才肯留一只。',
  },
  denghuo: {
    id:'denghuo', kind:'pet', name:'灯 蛾', from:'灯尸',
    ward:0, pickup:0.60, speed:0, atk:14,
    lore:'追着灯走的那种蛾子。烧掉了也不死,换个灯继续追。',
    give:'它认的不是你,是你手里那盏灯。但灯灭了它也还在。',
    how:'灯蛾要灯尸那条线有个了结。救不救它,看你的。',
  },
};

export const MOUNT_LIST = Object.values(MOUNTS);

export const MOUNT = {
  s: { have:[], ride:null, pet:null },

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) {
        const d = JSON.parse(r)||{};
        this.s = { ...this.s, ...d };
        if (!Array.isArray(this.s.have)) this.s.have = [];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // —— 获得 ——
  has(id) { return this.s.have.includes(id); },
  canGet(id) {
    const m = MOUNTS[id];
    if (!m) return { ok:false, msg:'无此物' };
    if (this.has(id)) return { ok:false, msg:'已有' };
    return { ok:true, m };
  },
  get(id) {
    const chk = this.canGet(id);
    if (!chk.ok) return chk;
    this.s.have.push(id);
    // 第一个得到的自动上场,免得玩家拿到却不知道
    if (!this.s.ride && chk.m.kind === 'ride') this.s.ride = id;
    if (!this.s.pet  && chk.m.kind === 'pet')  this.s.pet  = id;
    this.save();
    return { ok:true, m:chk.m };
  },
  // 上阵
  setRide(id) {
    if (id && !this.has(id)) return { ok:false, msg:'你还没有' };
    const m = id ? MOUNTS[id] : null;
    if (m && m.kind !== 'ride') return { ok:false, msg:'那个不能骑' };
    this.s.ride = id; this.save();
    return { ok:true };
  },
  setPet(id) {
    if (id && !this.has(id)) return { ok:false, msg:'你还没有' };
    const m = id ? MOUNTS[id] : null;
    if (m && m.kind !== 'pet') return { ok:false, msg:'那个带不走' };
    this.s.pet = id; this.save();
    return { ok:true };
  },

  // —— 生效数值(汇总当前骑+带) ——
  eff() {
    const e = { ward:0, pickup:0, speed:0, atk:0 };
    for (const id of [this.s.ride, this.s.pet]) {
      if (!id) continue;
      const m = MOUNTS[id];
      if (!m) continue;
      e.ward += m.ward; e.pickup += m.pickup;
      e.speed += m.speed; e.atk += m.atk;
    }
    e.pickup = Math.round((1 + e.pickup) * 100) / 100;   // 变成倍率
    e.speed = Math.round((1 + e.speed / 100) * 100) / 100;
    return e;
  },
  // 各来源拆开(UI 要显示「谁加了多少」)
  breakdown() {
    return {
      ward:  this.s.ride ? MOUNTS[this.s.ride].ward : 0,
      pickup:(this.s.ride ? MOUNTS[this.s.ride].pickup : 0)
            + (this.s.pet  ? MOUNTS[this.s.pet].pickup : 0),
      speed: this.s.ride ? MOUNTS[this.s.ride].speed : 0,
      atk:   this.s.pet  ? MOUNTS[this.s.pet].atk : 0,
    };
  },

  // —— 局内钩子:给主循环用 ——
  pickupMul() { return this.eff().pickup; },
  speedMul()  { return this.eff().speed; },
  petAtk()    { return this.eff().atk; },

  // —— 来源解锁:和剧情挂钩,不白给 ——
  // 见过青穹 / 走完仙人墓 / 灯尸那边结案 → 各自解锁
  checkUnlocks() {
    const got = [];
    const tryGet = (id, cond) => {
      if (!this.has(id) && cond) {
        const r = this.get(id);
        if (r.ok) got.push(MOUNTS[id]);
      }
    };
    // 青穹:在古战场见过它(青穹每次都会经过)
    tryGet('qiao', STORY.met('qingqiong'));
    // 石俑犬:走完仙人墓(墓里带出来的那只)
    tryGet('stonepuppy', TOMB.s.done);
    // 白泽幼崽:在秘境见过白泽
    tryGet('baize', STORY.met('baize'));
    // 灯蛾:灯尸支线结案
    tryGet('denghuo', !!QUEST.s.done.dengshi);
    return got;
  },

  reset() { try { localStorage.removeItem(K); } catch {} },
};

// —— 背包里有没有图纸(集市/商人处兑换用)——
export const MOUNT_BLUEPRINT = {
  tongyaji:{ cost:2000, need:['stone_2'] },
  langyixue:{ cost:6000, need:['stone_3'] },
  guibiao: { cost:12000, need:['stone_4','scroll_3'] },
};