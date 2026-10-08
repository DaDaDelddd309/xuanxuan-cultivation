// ===== 酒馆 · 同伴(XX-META-003)=====
//
// owner 原话:「结束一局后可以……酒馆招揽下一局伙伴」
//
// 为什么同伴要"真的在场"而不是加个数值:
//   这个游戏已经有两套系统能吃到同伴的影响 ——
//     · 生成预算(Director):同伴在场时,目标怪量抬一档
//     · 篝火护栏(ward):同伴能帮你把护栏撑大
//   所以同伴不是"攻击+10%",而是**改变这一局的世界规则**。
//   这样它在画面上也是看得见的:他会走、会打、会死。
//
// 招募货币:集市上买的「同行之约 / 同门引荐 / 生死之交」三档线索。
// 线索不是直接带人,是提高遇到好同伴的概率 —— 酒馆是**赌运气**的,
// 符合肉鸽的调性(不是攒够就必得)。

const K = 'xx_tavern_v099';

// 同伴表:数据驱动,想加人就加一行
//   mods 里的键直接对应局内可用的东西:
//     dmg/might  → p.stats.might
//     magnet     → 拾取范围
//     hp         → 替玩家挡一下
//     minAlive   → Director 的保底怪量抬升
//     wardBonus  → 篝火护栏加成(像素)
//     xpMult     → 经验
//   move/shoot 决定他在场上干什么(不实现也可以,只是纯数值)
export const MATES = {
  // —— 一档:市井之徒 ——
  scavenger: {
    id: 'scavenger', name: '拾荒的瘦子', tier: 1, chance: 0.55, cost: 1,
    bio: '在死人堆里翻东西的手最快。他不打架,他只是比你先到。',
    mods: { magnet: 55, xpMult: 1.05 },
    move: 'follow', shoot: false,
    sprite: 'scavenger',
  },
  // —— 二档:会武的 ——
  bladesworn: {
    id: 'bladesworn', name: '断了刀的武人', tier: 1, chance: 0.40, cost: 1,
    bio: '他说自己的刀断了,所以现在用手。其实是刀还在,他不想欠人。',
    mods: { might: 1.08, minAlive: 2 },
    move: 'follow', shoot: true,
    sprite: 'bladesworn',
  },
  // —— 三档:懂行的 ——
  talisman: {
    id: 'talisman', name: '画符的哑巴', tier: 2, chance: 0.28, cost: 2,
    bio: '他不会说话,但他画一道符能挡一整轮妖。他画的符从来没有失效过。',
    mods: { might: 1.12, xpMult: 1.10, wardBonus: 28 },
    move: 'follow', shoot: true,
    sprite: 'talisman',
  },
  // —— 三档:真货 ——
  widow: {
    id: 'widow', name: '守寡的师姐', tier: 3, chance: 0.14, cost: 3,
    bio: '她嫁过人,人没了,从那以后她只跟死人说话 —— 死掉的那些。',
    mods: { might: 1.18, minAlive: 4, wardBonus: 40, xpMult: 1.08 },
    move: 'follow', shoot: true,
    sprite: 'widow',
  },
};

export const TAVERN = {
  s: { owned: [], active: null, log: [] },

  load() {
    try { const r = localStorage.getItem(K); if (r) this.s = { owned: [], active: null, log: [], ...JSON.parse(r) }; }
    catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  /** 集市买到线索 → 折成招募次数 */
  addLead(n = 1) {
    this.s.leads = (this.s.leads || 0) + n;
    this.save();
    return this.s.leads;
  },
  leads() { return this.s.leads || 0; },

  /**
   * 招揽。消耗一条线索,按 tier 加权抽一个同伴。
   * 线索不足 → {ok:false}
   * @returns {{ok:boolean, mate?:object, msg:string}}
   */
  recruit() {
    if (this.leads() < 1) return { ok: false, msg: '没有同行之约。集市上偶尔能买到。' };
    this.s.leads--;
    const pool = Object.values(MATES).map(m => ({ m, w: m.chance }));
    let total = 0; for (const x of pool) total += x.w;
    let r = Math.random() * total, pick = pool[0].m;
    for (const x of pool) { r -= x.w; if (r <= 0) { pick = x.m; break; } }
    this.s.owned.push(pick.id);
    this.s.active = pick.id;
    this.s.log.unshift({ id: pick.id, name: pick.name, t: Date.now() });
    if (this.s.log.length > 20) this.s.log.length = 20;
    this.save();
    return { ok: true, mate: pick, msg: `${pick.name} 愿意跟你走。` };
  },

  /** 当前出战同伴(没有则 null) */
  active() {
    const id = this.s.active;
    return id ? (MATES[id] || null) : null;
  },
  /** 主动换人:不消耗线索,直接换 */
  setActive(id) {
    if (!MATES[id]) return { ok: false, msg: '没有这个人。' };
    if (!this.s.owned.includes(id)) return { ok: false, msg: '他还没跟你走。' };
    this.s.active = id;
    this.save();
    return { ok: true, msg: `${MATES[id].name} 上场。` };
  },
  dismiss() { this.s.active = null; this.save(); return { ok: true, msg: '他先歇着。' }; },

  /** 把同伴的 mods 合并成局内要用的数值 */
  mods() {
    const m = this.active();
    return m ? Object.assign({}, m.mods) : {};
  },

  reset() { this.s = { owned: [], active: null, log: [], leads: 0 }; this.save(); },
};
