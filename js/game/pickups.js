// ===== 拾取物:宝石/金币/肉/磁铁/宝箱(带视口剔除与数量上限合并,保流畅) =====
import { drawSprite } from '../sprites.js?v=17';
import { PAL } from '../core/palette.js';
import { Bus } from '../core/engine.js?v=17';
import { Director } from './director.js';   // V0.99:捡宝石 = 加生成压力 + 当场兑现同档怪

// 源石掉率(XX-CACHE-001)。想调手感只改这里。
// 源石掉率(XX-BAL-003):同一条原则 —— 绝对值低,且随难度递增。
// mob 0.004(万分之四)原本就在万级,保留;elite 0.30(30%)偏高,降到 0.05。
const STONE_DROP = { elite: 0.05, mob: 0.004 };  // Boss 必掉,不走概率

const MAX_PICKUPS = 320; // 超限时最旧宝石并入相邻宝石(防后期上千掉落物拖垮绘制)

export function initPickups(g) {
  // 敌人死亡掉落:宝石/金币 + 肉(回血)+ 精英与 Boss 必掉宝箱
  Bus.on('enemy-death', e => {
    const tier = e.xp >= 5 ? 'gem_r' : e.xp >= 2 ? 'gem_g' : 'gem_b';
    g.addPickup({ kind: 'gem', x: e.x, y: e.y, sprite: tier, xp: e.xp, r: 8, t: Math.random() * 7 });
    if (Math.random() < e.coinP) g.addPickup({ kind: 'coin', x: e.x + 8, y: e.y, sprite: 'coin', gold: 3, r: 8, t: 0 });
    if (Math.random() < (e.elite ? 0.45 : 0.018))
      g.addPickup({ kind: 'meat', x: e.x - 10, y: e.y + 6, sprite: 'meat', heal: 25, r: 9, t: Math.random() * 7 });
    if (e.elite || e.boss) {
      const nChest = e.boss ? 2 : 1;
      for (let i = 0; i < nChest; i++)
        g.addPickup({ kind: 'chest', x: e.x + (i - (nChest - 1) / 2) * 26, y: e.y + 10, sprite: 'chest', r: 12, t: 0 });
    }

    // ===== 源石(V0.99 · XX-CACHE-001)=====
    // owner 的规则:「源石不是经验宝石,那是类似打了精英怪才有概率掉落的,
    //                boss 必然掉落一颗」
    //
    // 修的是什么:篝火(CAMP)完全靠源石当燃料,但局内**从来没掉过源石** ——
    // 玩家只能去修仙阁用道行兑换,于是「打怪→源石→篝火」这条链是断的。
    // 精英怪概率掉、Boss 必掉,这条链才闭合。
    //
    // 源石不是经验:捡起来给的是修仙阁的资源(照旧走存档),局内不给 xp。
    const r = Math.random();
    const stoneId = e.boss ? 'stone_3' : e.elite ? 'stone_2' : 'stone_1';
    // ⚠️ 原来写 sprite:'stone' —— 精灵表里**根本没有** stone。
    // drawSprite 找不到就静默 return,所以源石从来就没被画出来过;
    // 玩家在屏幕上看到的「一直冒」全是灵气的飘字。
    // 用 coin(唯一现成的货币精灵),品级靠 size 区分。
    const mkStone = () => g.addPickup({ kind: 'stone', id: stoneId, x: e.x, y: e.y + 18,
      sprite: 'coin', r: 11, t: 0, count: 1,
      size: e.boss ? 20 : e.elite ? 16 : 12 });
    if (e.boss) {
      mkStone();                                   // Boss 必掉
    } else if (e.elite && r < STONE_DROP.elite) {
      mkStone();                                   // 精英概率掉
    } else if (r < STONE_DROP.mob) {
      mkStone();                                   // 普通怪极低概率 —— 挂机久了总能凑够一根火
    }
  });

  // 超限合并:把最旧宝石的 xp 并入相邻宝石(每帧至多一次,摊平开销)
  const mergeOldest = () => {
    if (g.pickups.length <= MAX_PICKUPS) return;
    for (let i = 0; i < g.pickups.length; i++) {
      const a = g.pickups[i];
      if (a.kind !== 'gem') continue;
      for (let j = i + 1; j < g.pickups.length; j++) {
        const b = g.pickups[j];
        if (b.kind !== 'gem') continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < 260 * 260) {
          a.xp += b.xp;
          a.sprite = a.xp >= 5 ? 'gem_r' : a.xp >= 2 ? 'gem_g' : 'gem_b';
          g.remove(g.pickups, j);
          return;
        }
      }
      // 找不到相邻宝石就直接并入第二个宝石(任意距离,保上限)
      for (let j = i + 1; j < g.pickups.length; j++) {
        const b = g.pickups[j];
        if (b.kind === 'gem') { a.xp += b.xp; a.sprite = a.xp >= 5 ? 'gem_r' : a.xp >= 2 ? 'gem_g' : 'gem_b'; g.remove(g.pickups, j); return; }
      }
      return;
    }
  };

  g.addUpdater(dt => {
    window.__pickupTicks = (window.__pickupTicks || 0) + 1; // 探针:更新器是否在跑
    mergeOldest();
    const p = g.player;
    if (!p) return; // 主菜单态:player 尚未创建
    const mag = p.stats.magnet, mag2 = mag * mag;
    for (let i = g.pickups.length - 1; i >= 0; i--) {
      const k = g.pickups[i];
      k.t += dt;
      const dx = p.x - k.x, dy = p.y - k.y, d2 = dx * dx + dy * dy;
      if (d2 > mag2 + 900) continue; // 远离磁吸范围:跳过
      const d = Math.sqrt(d2) || 1;
      if (d < mag) { // 磁吸
        const v = 260 + (mag - d) * 3;
        k.x += dx / d * v * dt; k.y += dy / d * v * dt;
      }
      if (d < 18) { // 拾取
        if (k.kind === 'stone') {
          // 源石 → 直接进修仙阁背包。它是篝火燃料,不是局内资源。
          // 走 XX 层(全局可达),不需要把背包传进局内。
          const BR = globalThis.__xx && globalThis.__xx.Bag;
          if (BR && BR.add(k.id || 'stone_1', k.count || 1)) {
            g.spawnText(k.x, k.y - 24, '源石 +' + (k.count || 1), { color: PAL.gold, size: 13, life: 1.1 });
            Bus.emit('sfx', 'pickup');
            g.remove(g.pickups, i); continue;
          }
          // 背包没就绪(极少见):留在地上,不吞掉
        }
        if (k.kind === 'gem') {
          p.addXp(k.xp);
          // V0.99 核心闭环:捡宝石 → 加压力 → 当场刷出同档位的妖物。
          // 妖物的来源因此变成**玩家的行为**,而不是计时器。
          Director.onGemPickup(g, k);
        }
        else if (k.kind === 'coin') { g.stats.gold += Math.round(k.gold * p.stats.goldMult); }
        else if (k.kind === 'meat') {
          const heal = Math.min(k.heal, p.stats.maxHp - p.hp);
          p.hp = Math.min(p.stats.maxHp, p.hp + k.heal);
          g.spawnText(p.x, p.y - 30, '+' + Math.max(1, Math.round(heal || k.heal)) + ' 气血', { color: PAL.xp, size: 14 });
          g.addParticles(k.x, k.y, { n: 6, color: PAL.xp, speed: 80, life: 0.4, size: 3 });
          Bus.emit('sfx', 'pickup');
          g.remove(g.pickups, i); continue;
        } else if (k.kind === 'chest') { // 宝箱:大量经验 + 金币 + 回血
          const gold = Math.round((40 + Math.random() * 30) * p.stats.goldMult);
          const xp = 60;
          g.stats.gold += gold;
          p.addXp(xp);
          p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * 0.3);
          g.spawnText(p.x, p.y - 36, '开箱!经验 +' + xp + ' 金币 +' + gold, { color: PAL.gold, size: 16, life: 1.2 });
          g.addParticles(k.x, k.y, { n: 26, color: PAL.gold, speed: 170, life: 0.7, size: 4, grav: 120 });
          g.addParticles(k.x, k.y, { n: 14, color: PAL.cinnabar, speed: 130, life: 0.6, size: 3 });
          g.shake(3, 0.18);
          Bus.emit('sfx', 'chest');
          g.remove(g.pickups, i); continue;
        }
        g.addParticles(k.x, k.y, { n: 4, color: PAL.gold, speed: 70, life: 0.3, size: 3 });
        // 金币不喂压力 —— 只有宝石是"燃料"。否则捡一次钱就凭空多出妖物,
        // 玩家会很快摸出规律,机制就被看穿了。
        Bus.emit('sfx', k.kind === 'coin' ? 'coin' : 'pickup');
        g.remove(g.pickups, i);
      }
    }
  });

  // ?dev 调试钩子:按 G 把最多8颗宝石传送到脚下;标题实时显示拾取状态
  if (location.search.includes('dev')) {
    window.addEventListener('keydown', e => {
      if (e.code !== 'KeyG') return;
      let moved = 0;
      for (const k of g.pickups) {
        if (k.kind !== 'gem' || moved >= 8) continue;
        k.x = g.player.x + (Math.random() - 0.5) * 24;
        k.y = g.player.y + (Math.random() - 0.5) * 24;
        moved++;
      }
    });
    setInterval(() => {
      if (!g.player) return;
      let near = 1e9, cnt = 0;
      for (const k of g.pickups) {
        cnt++;
        const d = Math.hypot(k.x - g.player.x, k.y - g.player.y);
        if (d < near) near = d;
      }
      document.title = `拾取探针 宝石${cnt}颗 最近${Math.round(near)}px xp=${Math.round(g.player.xp)} Lv${g.player.level} 更新器帧${window.__pickupTicks || 0}`;
    }, 500);
  }

  g.addDrawer('under', ctx => {
    for (const k of g.pickups) {
      if (!g.inView(k.x, k.y, 40)) continue; // 视口剔除:视野外宝石不绘制
      const bob = Math.sin(k.t * 5) * 2.5;
      drawSprite(ctx, k.sprite, k.x, k.y + bob);
    }
  });
}
