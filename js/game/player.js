// 玩家:属性/成长/移动/受伤/经验
import { Input } from '../core/input.js?v=17';
import { PAL } from '../core/palette.js';
import { Bus } from '../core/engine.js?v=17';
import { drawSprite, has } from '../sprites.js?v=17';

// 注意:portrait / role / title / bio / arc 是**修仙阁人物页**要读的展示字段(V0.98 补)。
// 之前这五个字段根本不存在,而 ui.js 的 vPeople() 直接 `PORTRAIT[c.portrait] || PORTRAIT.hero`
// —— 结果四个角色全部渲染同一张 hero.jpg,另外四行直接显示 undefined。
// 放在这里是因为模板已经依赖 CHARACTERS;若以后要拆层,连同模板一起迁,别只改一半。
export const CHARACTERS = {
  knight: {
    name: '剑客', weapon: 'knife', sprite: 'hero_knight', hp: 120, might: 1.0, speed: 144, armor: 1,
    damageTakenMult: 0.82,
    trait: '铁壁：受到伤害 -18%',
    desc: '一剑风流,自带 1 点护甲 · 初始武功:剑气', cost: 0,
    portrait: 'knight', role: '起 手', title: '负剑下山',
    bio: '最早走到山下的那个。别人是来修仙的,他是来还愿的 —— 一桩旧婚事,一截没烧完的红布。\n他话少,受得住打,所以活得最久。',
    arc: '红 嫁 衣 · 愿 牌',
  },
  mage: {
    name: '道人', weapon: 'wand', sprite: 'hero_mage', hp: 80, might: 0.95, speed: 137, cdMult: 0.85,
    areaMult: 1.18, xpMult: 1.12,
    trait: '灵脉：技能范围 +18%，经验获取 +12%',
    desc: '御风之术,冷却 -15% · 初始武功:御风', cost: 300,
    portrait: 'mage', role: '看 路', title: '问道青炉',
    bio: '活得太久,所以什么都知道,也什么都不肯说。\n他见过三次青石村变成废墟。你问起来,他就说「风大」。',
    arc: '半 句 话 · 异 兽',
  },
  ranger: {
    name: '游侠', weapon: 'bow', sprite: 'hero_ranger', hp: 95, might: 1.0, speed: 163, magnet: 30,
    crit: 0.20, critDmg: 1.75,
    trait: '猎心：暴击率 20%，暴击伤害 175%',
    desc: '身法迅捷、拾取范围大 · 初始武功:贯日', cost: 800,
    portrait: 'ranger', role: '走 路', title: '循迹白牛',
    bio: '哪条道没人走,他走哪条。地图上多出来的那些线,大半是他踩出来的。\n他不认路,只认脚印。',
    arc: '第 三 百 一 柄',
  },
  white: {
    name: '白衣剑仙', weapon: 'knife', sprite: 'hero_white', hp: 95, might: 1.18, speed: 152, cdMult: 0.92,
    crit: 0.12,
    trait: '剑心通明：攻击 +18%，冷却 -8%，暴击率 12%',
    desc: '一袭白衣,负剑下山,人剑合一 · 初始武功:剑气', cost: 2000,
    portrait: 'white', role: '断 局', title: '人 剑 合 一',
    bio: '碑上第三百零一柄剑的主人。碑上没有名字,只有一句「他还在练」。\n他把结局留给了别人,自己走进了墓里。',
    arc: '双 结 局',
  },
};

export class Player {
  constructor(charId) {
    const c = CHARACTERS[charId];
    this.charId = charId; this.char = c;
    this.x = 0; this.y = 0; this.facing = 1; this.animT = 0; this.moving = false;
    this.iframes = 0; this.hurtT = 0;
    this.level = 1; this.xp = 0; this.pendingLevels = 0;
    this.weapons = [];
    this.dash = { t: 0, cd: 0, dur: 0.18, dx: 1, dy: 0 };
    // 防御类内功状态：护盾优先吸收伤害，反伤由 weapons.js 监听 player-hurt 事件结算。
    this.shield = 0;
    this.shieldMax = 0;
    this.shieldRegen = 0;
    this.reflectRatio = 0;
    this._g = null;
    this.bonusesBase = {
      mightMult: 1, cdMult: 1, hpFlat: 0, hpMult: 1, speedMult: 1,
      magnetFlat: 0, xpMult: 1, goldMult: 1, armorFlat: 0, areaMult: 1, regenFlat: 0,
      damageTakenMult: 1, lifestealPct: 0,
    };
    // 纯净基线 —— recalc() 每局/每级都从这里重建,避免装备加成被反复累加
    this.bonuses = { ...this.bonusesBase };
    this.charBonus = {
      cdMult: c.cdMult || 1,
      magnetFlat: c.magnet || 0,
      areaMult: c.areaMult || 1,
      xpMult: c.xpMult || 1,
      damageTakenMult: c.damageTakenMult || 1,
      crit: c.crit || 0.1,
      critDmg: c.critDmg || 1.6,
    };
    this.recalc();
    this.hp = this.stats.maxHp;
  }

  recalc() {
    // —— 装备加成并入 bonuses(XX-EQUIP-004)——
    // ⚠️ 之前 `main.js` 算完 `loadoutBonus()` 挂在 `this.gearBonus` 上,
    //    而 recalc() 全程只读 `this.bonuses` —— **gearBonus 在本文件出现 0 次**,
    //    也就是说整套装备的加成(含词条)全部悬空,一件都没生效。
    //    症状极隐蔽:数据层、存档、UI 全都正常,只是战斗里数字不变。
    //    现在每局 startRun 存一次 gearBonus,这里在重算时并进来。
    //
    // ⚠️ 必须从**基线**重建,不能就地累加:
    //    recalc() 每次升级都会调一遍,就地 `+=` / `*=` 会让装备加成
    //    每升一级就被再叠一次 —— 线性甚至指数膨胀,而且很难查。
    //    所以 bonusesBase 是纯净模板,bonuses 是「基线 + 装备」的当次结果。
    if (this.bonusesBase) {
      const g = this.gearBonus || {};
      const B = this.bonusesBase;
      this.bonuses = { ...B };
      // 乘算类相乘、加算类相加 —— 与 gear.js 的 loadoutBonus 同一口径
      for (const k of ['mightMult', 'cdMult', 'speedMult', 'xpMult', 'goldMult',
                       'areaMult', 'hpMult', 'damageTakenMult']) {
        if (g[k] !== undefined) this.bonuses[k] *= g[k];
      }
      for (const k of ['hpFlat', 'armorFlat', 'magnetFlat', 'regenFlat', 'lifestealPct']) {
        if (g[k] !== undefined) this.bonuses[k] += g[k];
      }
    }
    const b = this.bonuses, c = this.char;
    const oldMax = this.stats ? this.stats.maxHp : 0;
    // 等级成长：每级三维提升，缓解后期乏力
    const lv = Math.max(1, this.level || 1);
    // 攻击成长软上限:25 级前每级 +6%(25 级时 ×2.44),之后增量指数衰减,总上限 ≈×2.84
    // —— 旧曲线 60 级即 ×4.5 且无界,配合强力被动后期乘区过高;现保住前期爽感、封住挂机乱杀
    const lvOver = Math.max(0, lv - 25);
    const lvMight = 1 + (lv - 1) * 0.06 + 0.4 * (1 - Math.exp(-lvOver * 0.12));
    const lvHpFlat = (lv - 1) * 8;
    const lvSpeedMult = 1 + (lv - 1) * 0.012;
    const computedMaxHp = Math.round((c.hp + b.hpFlat + lvHpFlat) * b.hpMult);
    const maxHp = Number.isFinite(computedMaxHp) && computedMaxHp > 0 ? computedMaxHp : Math.max(1, c.hp);
    const takenMult = (this.charBonus.damageTakenMult || 1) * (b.damageTakenMult || 1);
    this.stats = {
      maxHp,
      might: c.might * b.mightMult * lvMight,
      cdMult: this.charBonus.cdMult * b.cdMult,
      speed: c.speed * b.speedMult * lvSpeedMult,
      magnet: 60 + this.charBonus.magnetFlat + b.magnetFlat,
      xpMult: this.charBonus.xpMult * b.xpMult, goldMult: b.goldMult,
      armor: c.armor + b.armorFlat,
      areaMult: this.charBonus.areaMult * b.areaMult,
      crit: this.charBonus.crit, critDmg: this.charBonus.critDmg,
      damageTakenMult: Number.isFinite(takenMult) ? Math.max(0.25, takenMult) : 1,
      regen: b.regenFlat,
      // 吸血(XX-EQUIP-004):damageEnemy 结算后按造成伤害的比例回血。
      // 没有这一行,enemies.js 里的 st.lifestealPct 永远是 undefined,
      // 整套「饮血」词条会变��又一个装了没人用的死属性。
      lifestealPct: Math.max(0, Number(b.lifestealPct) || 0),
    };
    if (!Number.isFinite(this.hp)) this.hp = this.stats.maxHp;
    if (oldMax && this.stats.maxHp > oldMax) this.hp += this.stats.maxHp - oldMax;
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp;
    if (!Number.isFinite(this.shieldMax) || this.shieldMax < 0) this.shieldMax = 0;
    if (!Number.isFinite(this.shield) || this.shield < 0) this.shield = 0;
    if (this.shield > this.shieldMax) this.shield = this.shieldMax;
  }

  // 增加永久护盾容量并立即补满新增部分。
  addShieldCapacity(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    this.shieldMax += n;
    const before = this.shield;
    this.shield = Math.min(this.shieldMax, this.shield + n);
    return this.shield - before;
  }

  // 组合技使用：没有防御被动时也能建立一个可用的小型护盾。
  gainShield(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    this.shieldMax = Math.max(this.shieldMax, n);
    const before = this.shield;
    this.shield = Math.min(this.shieldMax, this.shield + n);
    return this.shield - before;
  }

  update(dt, g) {
    this._g = g;
    const mv = Input.move();
    this.moving = mv.x !== 0 || mv.y !== 0;

    // 冲刺:优先于普通移动;期间无敌帧+可穿越敌群
    if (this.dash.cd > 0) this.dash.cd -= dt;
    if (this.dash.t > 0) {
      this.dash.t -= dt;
      const v = this.stats.speed * 4.5;
      this.x += this.dash.dx * v * dt;
      this.y += this.dash.dy * v * dt;
      this.iframes = Math.max(this.iframes, 0.06);
      this.animT += dt;
      this._trailT = (this._trailT || 0) - dt;
      if (this._trailT <= 0) {
        this._trailT = 0.03;
        g.addParticles(this.x, this.y, { n: 2, color: '#00f0ff', speed: 15, life: 0.28, size: 4 });
      }
    } else if (Input.takeDashRequest() && this.dash.cd <= 0) {
      let dx = mv.x, dy = mv.y;
      if (!dx && !dy) { dx = this.facing; dy = 0; }
      const m = Math.hypot(dx, dy) || 1;
      this.dash.dx = dx / m; this.dash.dy = dy / m;
      this.dash.t = this.dash.dur;
      this.dash.cd = 3 * this.stats.cdMult; // 专注/疾风靴可缩短冷却
      if (this.dash.dx !== 0) this.facing = this.dash.dx > 0 ? 1 : -1;
      Bus.emit('sfx', 'dash');
    } else if (this.moving) {
      this.x += mv.x * this.stats.speed * dt;
      this.y += mv.y * this.stats.speed * dt;
      if (mv.x !== 0) this.facing = mv.x > 0 ? 1 : -1;
      this.animT += dt;
    } else this.animT = 0;

    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.stats.regen > 0 && this.hp < this.stats.maxHp) {
      this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.regen * dt);
    }
    if (this.shieldRegen > 0 && this.shield < this.shieldMax) {
      this.shield = Math.min(this.shieldMax, this.shield + this.shieldRegen * dt);
    }
    g.cam.follow(this.x, this.y, dt);
    for (const w of this.weapons) w.update(dt, g);
  }

  dashCd() { return Math.max(0, this.dash.cd); } // HUD 冷却显示用
  dashReady() { return this.dash.cd <= 0; }

  /**
   * 回血。吸血(XX-EQUIP-004)与「回春」都要走它,不要各处直接改 `hp` ——
   * 直接改会漏掉护盾与上限,也会让「实际回了多少」无从记账。
   * @returns {number} 实际回上的量
   */
  heal(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (!Number.isFinite(this.hp) || this.hp <= 0) return 0;   // 死了不回
    if (!Number.isFinite(this.stats.maxHp)) return 0;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    return this.hp - before;
  }

  takeDamage(amount) {
    if (!Number.isFinite(this.hp)) this.hp = Number.isFinite(this.stats.maxHp) ? this.stats.maxHp : 1;
    if (this.iframes > 0 || this.hp <= 0) return;
    if (!Number.isFinite(this.shield) || this.shield < 0) this.shield = 0;
    const rawAmount = Number(amount);
    const safeAmount = Number.isFinite(rawAmount) ? rawAmount : 1;
    const afterArmor = Math.max(1, safeAmount - this.stats.armor);
    const scaled = afterArmor * this.stats.damageTakenMult;
    const incoming = Number.isFinite(scaled) ? Math.max(1, Math.round(scaled)) : 1;
    const blocked = Math.min(this.shield, incoming);
    this.shield = Math.max(0, this.shield - blocked);
    const dmg = Math.max(0, incoming - blocked);
    if (dmg > 0) this.hp = Math.max(0, this.hp - dmg);
    this.iframes = 0.6; this.hurtT = dmg > 0 ? 0.25 : 0.12;
    const g = this._g;
    if (blocked > 0 && g && g.spawnText) {
      g.spawnText(this.x, this.y - 34, `护盾 -${blocked}`, { color: PAL.jade, size: 13, life: 0.7 });
      if (g.addParticles) g.addParticles(this.x, this.y, { n: 5, color: PAL.jade, speed: 80, life: 0.28, size: 3 });
    }
    Bus.emit('player-hurt', { player: this, g, rawAmount: safeAmount, mitigated: incoming, damage: dmg, blocked });
    if (dmg > 0) Bus.emit('hurt', dmg); // main 监听此事件做震屏/红晕
    else if (blocked > 0) Bus.emit('shield-hit', blocked);
    if (this.hp <= 0) { this.hp = 0; Bus.emit('runend', { victory: false }); }
  }
  addXp(n) {
    const hadPending = this.pendingLevels > 0;
    this.xp += Math.round(n * this.stats.xpMult);
    let need = xpNeed(this.level);
    while (this.xp >= need) {
      this.xp -= need; this.level++;
      this.pendingLevels++;
      need = xpNeed(this.level);
    }
    if (this.pendingLevels > 0 && !hadPending) Bus.emit('levelup', { level: this.level });
  }

  xpRatio() { return this.xp / xpNeed(this.level); }

  draw(ctx) {
    if (this.shield > 0 && this.shieldMax > 0) {
      const f = Math.max(0.18, Math.min(1, this.shield / this.shieldMax));
      ctx.save();
      ctx.globalAlpha = 0.2 + f * 0.45;
      ctx.strokeStyle = PAL.jade; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, 25 + f * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.18 + f * 0.16;
      ctx.fillStyle = PAL.jade;
      ctx.beginPath(); ctx.arc(this.x, this.y, 22 + f * 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 高像素版:4 帧走路循环 + 待机呼吸帧;新帧缺失时回退旧 _0/_1 二帧
    let name;
    if (this.moving) {
      name = this.char.sprite + '_' + (Math.floor(this.animT / 0.09) % 4);
      if (!has(name)) name = this.char.sprite + (Math.floor(this.animT / 0.16) % 2 === 1 ? '_1' : '_0');
    } else {
      name = this.char.sprite + '_idle';
      if (!has(name)) name = this.char.sprite + '_0';
    }
        // lively v3: more exaggerated, no sticker - bigger bob, squash, dust
    let bx=0, by=0, sx=1, sy=1, ang=0;
    let shadowScale=1, shadowAlpha=0.22;
    if (this.moving) {
      by = Math.sin(this.animT * 12) * 3.0;
      bx = Math.sin(this.animT * 12 + Math.PI/2) * 1.1;
      ang = Math.sin(this.animT * 12) * 0.08;
      const k = Math.abs(Math.sin(this.animT * 12));
      sy = 1 - k * 0.072;
      sx = 1 + k * 0.055;
      shadowScale = 1 - k * 0.28;
      shadowAlpha = 0.16 + k * 0.16;
      const cur = Math.floor(this.animT / 0.09) % 4;
      const prv = Math.floor((this.animT - 0.016) / 0.09) % 4;
      if (cur !== prv && (cur===0 || cur===2) && this._g) {
        this._g.addParticles(this.x, this.y+18, {n:2, color:PAL.paperDim, speed:22, life:0.22, size:2.2});
      }
    } else {
      const t = this._g ? this._g.time : 0;
      by = Math.sin(t * 1.9) * 2.2 + Math.sin(t*3.7)*0.35;
      sy = 1 + Math.sin(t * 1.9) * 0.028;
      sx = 1 - Math.sin(t * 1.9) * 0.016;
      ang = Math.sin(t * 0.9) * 0.025 + Math.sin(t*2.1)*0.01;
      bx = Math.sin(t*0.85)*0.6;
      shadowScale = 1 + Math.sin(t * 1.9) * 0.09;
      shadowAlpha = 0.21 + Math.sin(t * 1.9) * 0.05;
    }
        if (this.iframes > 0 && Math.floor(this.iframes * 12) % 2 === 0) return;
    // ground shadow: separate from sprite, stays on ground, scales with bob
    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = PAL.ink2;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 22, 18 * shadowScale, 6 * shadowScale, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    const o = { flip: this.facing < 0, sx, sy, angle: ang };
    if (this.hurtT > 0) o.tint = '#ff5555';
    drawSprite(ctx, name, this.x + bx, this.y + by, o);
  }
}

export function xpNeed(level) { return Math.floor(6 + level * 4 + level * level * 0.35); }
