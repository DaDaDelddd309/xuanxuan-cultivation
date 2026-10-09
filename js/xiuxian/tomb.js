// ===== 仙人墓 · 地下层 =====
// 墓不在图上。古战场遗迹(n8)往下挖,才到得了门口。
// 设计:独立子地图,5 个房间,玩家自己走。不打断,不弹窗。
// 契约:纯数据 + 纯状态。渲染在 ui.js。
import { SAVE_KEYS } from './save-keys.js';
import { OUTCOMES } from './outcomes.js';
import { STORY } from './story.js';
import { Cult } from './index.js';
import { Bag, SCROLLS } from './items.js';

const K = SAVE_KEYS.tomb;

// 墓里的五个房间。edge 是走得过去的相邻关系。
// 排布:墓道在最外,主墓在最里。石将守在主墓门外。
export const ROOMS = [
  {
    id:'dk', name:'墓 道', x:0, y:1, edge:['qd'],
    text:'墓道不长,却走了很久。\n两壁刻满了字,全是同一个名字 —— 七千遍。\n中间有几处刻得很深,笔画里还嵌着石屑,像是刻的时候手在抖。',
    beat:'没有人来上坟。所以他把自己的名字刻了七千遍,好让这墙不至于空着。',
  },
  {
    id:'ce', name:'侧 室', x:1, y:0, edge:['qd'],
    text:'一间没落灰的侧室。\n案上摊着半卷碑文拓片,墨迹到「此生」两个字就断了,断口很齐 —— 不是没写完,是纸没了。\n拓片背面有人用指甲刻了一行小字:\n「第四次了。」',
    beat:'他自己回来过四回。第四次,连纸都没带够。',
  },
  {
    id:'qd', name:'前 殿', x:1, y:1, edge:['dk','ce','sj'],
    text:'供桌上三炷香还燃着,香灰积了一寸 —— 不对,香是新的。\n石鼎里插满了断兵,长短不一,都是外面捡回来的。他自己的剑早就不在了,却把别人的剑供在这儿。\n石碑上刻着他的生平,最后一行是四个字:\n「化神期大能」。',
    beat:'碑上只写了这四个字。他生前大概也觉得,到了这一步,别人记住的也就这四个字。',
  },
  {
    id:'sj', name:'石 将 前', x:2, y:1, edge:['qd','zm'], guard:true,
    text:'石将站在墓门前,一手按着门,一手垂着。\n它背上原本刻着一句话,被凿掉了一半。剩下的三个字是:\n「此生不悔」。\n它不拦你。它只是挡着。',
    beat:'它守了千年,不是因为忠于墓主。是因为那半句话还没说完,它不敢开门。',
  },
  {
    id:'zm', name:'主 墓', x:3, y:1, edge:['sj'], end:true,
    text:'门后没有棺椁,没有尸骨,什么遗物都没有。\n只有两张席。\n一张坐着人 —— 盘膝,面朝门,姿势端正,像是在等对面那张席有人来。\n另一张是空的,干干净净,连灰都没有。\n他是对着那张空席坐化的。',
    beat:'碑文最后一行是他的名字,刻得比前面七千个都深。\n他不是在等谁来看他。他是在等一个人坐下,好把憋了千年的那句话说完。\n他没等到。',
  },
];

export const ROOM_BY_ID = Object.fromEntries(ROOMS.map(r=>[r.id,r]));

// 补完那句话 —— 两个结局
// ⚠️ text 从 outcomes.js 取,不再各写一份(XX-AUDIT-018)。
//   note / after 是墓碑语境的独有叙事,与主线结算不同,**刻意不合并**。
export const WORDS = [
  { path:1, text:OUTCOMES.unlone,
    note:'你把空席上那份沉默接了过来。\n他攒了千年的那句话,终于有人听完了。',
    after:'石将跪下去,墓门自己开了。\n风从主墓里出来的时候,带着一千年的香灰味。' },
  { path:2, text:OUTCOMES.noless,
    note:'你把那三个字补完整了。\n他其实早就不悔了 —— 他悔的是没人听见。',
    after:'石将站起来,第一次自己转过身,面朝大门。\n它下班了。门没开 —— 不用开了。' },
];

export const TOMB = {
  s: { in:false, at:null, seen:[], done:false, path:0, flag:{} },

  load() {
    const def = () => ({ in:false, at:null, seen:[], done:false, path:0, flag:{} });
    this.s = def();
    try {
      const r = localStorage.getItem(K);
      if (!r) return this.s;
      const d = JSON.parse(r) || {};
      this.s = { ...this.s, ...d };
      if (!Array.isArray(this.s.seen)) this.s.seen = [];
      if (!this.s.flag || typeof this.s.flag !== 'object') this.s.flag = {};
    } catch {
      // 存档坏了:回落到干净初始态,别把半个墓留给玩家
      this.s = def();
    }
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // —— 入口:石将见过才知道墓在哪儿 ——
  known() { return !!STORY.met('shijiang'); },
  enter() {
    if (this.s.done) return { ok:false, msg:'这里的事,已经了结了' };
    if (this.s.in) return { ok:false, msg:'你还在墓里' };
    if (!this.known()) return { ok:false, msg:'你不知道墓在哪儿' };
    this.s.in = true; this.s.at = 'dk';
    this.save();
    // 站进墓道就算到了,不用再点一次
    return { ok:true, room:this.room(), seen:this._enterOnce(ROOM_BY_ID.dk) };
  },
  leave() { this.s.in = false; this.s.at = null; this.save(); },

  room() { return this.s.at ? ROOM_BY_ID[this.s.at] : null; },
  // 走过没(用于 UI 画已探索)
  seen(id) { return this.s.seen.includes(id); },

  // —— 走动 ——
  move(to) {
    if (!this.s.in) return { ok:false, msg:'你不在墓里' };
    const from = ROOM_BY_ID[this.s.at];
    if (!from || !from.edge.includes(to)) return { ok:false, msg:'过不去' };
    this.s.at = to; this.save();
    return { ok:true, room:this.room() };
  },

  // 首次进入某房间 → 记下,并给该房间的收获
  _enterOnce(room) {
    if (this.s.seen.includes(room.id)) return null;
    this.s.seen.push(room.id);
    this.s.flag[room.id] = true;
    this.save();
    return this._roomGift(room);
  },

  // 每间房的实际产出(不是白给的叙事文本)
  _roomGift(room) {
    const got = { dao:0, scroll:null, text:[] };
    if (room.id === 'ce') {
      // 侧室:半卷碑文拓片
      got.scroll = 'beiwen';
      Bag.add('beiwen', 1);
      got.text.push('碑文拓片 ×1');
    }
    if (room.id === 'zm') {
      // 主墓:坐化之人的毕生所悟
      got.dao = 1800;
      Cult.get().dao += 1800;
      got.text.push('道行 +1800');
      Cult.commit();
    }
    return got;
  },

  // 结算一个房间:文字 + 首次进入的收获
  settle(id) {
    const r = ROOM_BY_ID[id];
    if (!r) return null;
    const first = this._enterOnce(r);
    // 走到石将跟前 → 触发「半句话」叙事线的最后一环
    let arcBeat = null;
    if (r.id === 'sj') {
      const got = STORY.arriveRoom('sj');
      if (got && got.length) arcBeat = got[0];
    }
    return {
      name:r.name, text:r.text, beat:r.beat,
      gift: first, first: !!first, arcBeat,
    };
  },

  // 走到石将前:能补完那句话
  atGuard() { return this.s.in && this.s.at === 'sj'; },
  // 主墓要不要开了
  canFinish() { return this.atGuard(); },

  // —— 补完半句话(结局) ——
  finish(path) {
    if (this.s.done) return { ok:false, msg:'这件事,你已经了结了' };
    if (!this.canFinish()) return { ok:false, msg:'你还没走到石将跟前' };
    if (path !== 1 && path !== 2) return { ok:false, msg:'没得选' };

    // 主墓必须真的走到过,否则结尾没分量
    if (!this.s.seen.includes('zm')) {
      // 强行开门:石将让路,但主墓的内容由 finish 补上
      this.s.seen.push('zm'); this.s.at = 'zm';
    }
    const w = WORDS[path-1];
    const got = { dao:0, scroll:null, text:[] };
    // 结局不同 → 拿的东西不同
    if (path === 1) {
      got.dao = 3200; Cult.get().dao += 3200;
      got.text.push('道行 +3200');
    } else {
      got.scroll = 'scroll_4'; Bag.add('scroll_4', 1);
      got.text.push(`${SCROLLS.scroll_4 ? SCROLLS.scroll_4.name : '传承'} ×1`);
    }
    Cult.commit();
    this.s.done = true; this.s.path = path; this.s.in = false; this.s.at = null;
    this.save();

    // 把结局交回叙事线,让「半句话」按同一条路结案
    let arcDone = null;
    try { arcDone = STORY.finish('tomb', path, null); } catch {}

    // 支线「半句话」同步了结(结局一致,不再重复发奖)
    // 由 ui 层在结案后调用 QUEST.settleShijiang(path) —— 避免循环依赖
    const questDone = false;

    return { ok:true, path, words:w.text, note:w.note, after:w.after,
             reward:got, arc: !!(arcDone && arcDone.ok), quest:questDone };
  },

  // 结局留下的痕迹 —— 碑文最终刻成什么样
  epitaph() {
    if (!this.s.done) return null;
    return this.s.path === 1
      ? '「此生不悔 —— 奈何无人共」\n后面跟了一行小字:有人替他坐了一回。'
      : '「此生无悔」\n刻痕很深,像是终于说完了。';
  },

  progress() { return { seen:this.s.seen.length, total:ROOMS.length, done:this.s.done }; },
};
