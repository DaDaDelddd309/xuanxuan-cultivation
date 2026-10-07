// ===== 回合制剧情战斗 · 表现层 =====
// 立绘 / 场景 / 逐段文本 / 技能栏 / 宿敌过场 / 战败分支 / BGM 状态机
// 契约:只调 battle.js 的纯函数,不改动它们。

import { Cult } from './index.js';
import { makeEnemy, playerAct, enemyAct, availableArts, canUseArt, isDead, playerDead } from './battle.js';
import { REALMS } from './realms.js';
import { artName, artFull } from './arts.js';
import { BGM } from './relations.js';

const BG = { duel:'assets/bg/duel.jpg', cave:'assets/bg/cave.jpg', sect:'assets/bg/sect.jpg' };
const SCENE_BY_TYPE = { elite:'duel', boss:'duel', secret:'cave', field:'duel' };

const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export const Duel = {
  root: null, S: null, busy: false,

  // ---------- 入口 ----------
  start(cfg) {
    if (!this.root) this.build();
    const ps = Cult.get();
    const pIdx = Math.max(0, REALMS.findIndex(r => r.id === ps.realm));

    // 敌人:按节点类型选档案 + 境界缩放
    const key = cfg.node.type === 'boss' ? 'devil'
      : cfg.node.type === 'elite' ? 'yao' : 'wanderer';
    const e = makeEnemy(key);
    // 血量继承:自动阶段打完的比例(秘境首次遭遇 = 满血 1.0)
    const autoRatio = cfg.node.type === 'secret' ? 1.0 : 0.4;
    e.hpMax = 100;
    e.hp = Math.max(1, Math.round(100 * autoRatio));
    e.title = cfg.foe.name;
    e.name = cfg.foe.name;
    e.realm = REALMS[cfg.foe.realmIdx] ? `${REALMS[cfg.foe.realmIdx].name}` : e.realm;
    e.dmg = Math.round(10 + cfg.foe.realmIdx * 6 + (cfg.foe.stronger ? 4 : 0));
    if (cfg.foe.isNemesis) e.dmg = Math.round(e.dmg * Cult.nemesis.powerBoost());

    this.S = {
      cfg, e,
      hero: {
        name: '轩轩', title: `${REALMS[pIdx].name}${ps.layer}层`,
        img: cfg.hero.img,
        hpMax: 100 + pIdx * 30,
        hp: 100 + pIdx * 30, arts: ps.arts, isSuper: ps.artifacts,
        cooldown: {}, dmgReduce: 0,
      },
      round: 0, over: false,
    };

    // ---- BGM:宿敌 / 越级大佬 / 普通 ----
    BGM.forBattle({ isNemesis: cfg.foe.isNemesis, enemyStronger: cfg.foe.stronger });

    this.root.classList.remove('hidden');
    this.paint();
    this.intro();
  },

  build() {
    const r = $('div', 'xx-duel hidden');
    r.innerHTML =
      `<div class="xx-duel-bg" id="xd-bg"></div>
       <div class="xx-duel-vig"></div>
       <div class="xx-turn" id="xd-turn"></div>
       <div class="xx-hp l"><span class="xx-hp-n" id="xd-hpn"></span><div class="xx-hp-b"><i id="xd-hpb"></i></div></div>
       <div class="xx-hp r"><span class="xx-hp-n" id="xd-epn"></span><div class="xx-hp-b"><i id="xd-epb"></i></div></div>
       <div class="xx-fighter l" id="xd-hf">
         <div class="xx-rod"></div>
         <div class="xx-face"><img id="xd-himg" alt=""></div>
         <div class="xx-rod"></div>
       </div>
       <div class="xx-fighter r" id="xd-ef">
         <div class="xx-rod"></div>
         <div class="xx-face"><img id="xd-eimg" alt=""></div>
         <div class="xx-rod"></div>
       </div>
       <div class="xx-skills" id="xd-sk"></div>
       <div class="xx-box">
         <div class="xx-box who" id="xd-who"></div>
         <div class="xx-box txt" id="xd-txt"></div>
       </div>
       <div class="xx-defeat hidden" id="xd-defeat"></div>`;
    document.getElementById('app').appendChild(r);
    this.root = r;
    r.querySelector('#xd-sk').addEventListener('click', ev => {
      const b = ev.target.closest('[data-art]');
      if (b && !this.busy) this.playerTurn(b.dataset.art);
    });
    r.querySelector('#xd-txt').addEventListener('click', () => { if (this.skipType) this.finishType(); });
  },

  close() {
    this.root && this.root.classList.add('hidden');
    BGM.stop();
    this.S = null;
  },

  // ---------- 渲染 ----------
  paint() {
    const S = this.S; if (!S) return;
    const q = id => this.root.querySelector('#' + id);
    const bg = q('xd-bg');
    const want = BG[SCENE_BY_TYPE[S.cfg.node.type] || 'duel'];
    if (bg.dataset.src !== want) { bg.dataset.src = want; bg.style.backgroundImage = `url(${want})`; }
    requestAnimationFrame(() => bg.classList.add('on'));

    q('xd-himg').src = S.hero.img;
    q('xd-eimg').src = S.cfg.foe.img;
    q('xd-hf').classList.add('on');
    q('xd-ef').classList.add('on');
    this.paintHp();
  },
  paintHp() {
    const S = this.S; if (!S) return;
    const q = id => this.root.querySelector('#' + id);
    const hpPct = Math.max(0, S.hero.hp / S.hero.hpMax * 100);
    const hpEPct = Math.max(0, S.e.hp / S.e.hpMax * 100);
    q('xd-hpb').style.width = hpPct + '%';
    q('xd-epb').style.width = hpEPct + '%';
    q('xd-hpn').textContent = `${S.hero.name} ${Math.max(0, S.hero.hp)}/${S.hero.hpMax}`;
    q('xd-epn').textContent = `${Math.max(0, S.e.hp)}/${S.e.hpMax} ${S.e.title}`;
  },

  // 打字机:逐段自动播放,可点击跳过
  say(who, text, cb) {
    const q = id => this.root.querySelector('#' + id);
    q('xd-who').textContent = who;
    const el = q('xd-txt');
    el.textContent = ''; this.skipType = false;
    const cur = $('span', '', '');
    const cur2 = $('span', 'cursor');
    el.append(cur, cur2);
    let i = 0;
    const step = () => {
      if (this.skipType) { cur.textContent = text; this.finishType(); return; }
      if (i >= text.length) { this.finishType(); return; }
      cur.textContent += text[i++];
      this._th = setTimeout(step, 26);
    };
    this.finishType = () => {
      clearTimeout(this._th);
      cur.textContent = text; this.skipType = false;
      if (cb) setTimeout(cb, 260);
    };
    step();
  },

  turnFlash(text, enemy) {
    const el = this.root.querySelector('#xd-turn');
    el.textContent = text;
    el.className = 'xx-turn' + (enemy ? ' enemy' : '');
    void el.offsetWidth;
    el.classList.add('on');
  },

  // ---------- 流程 ----------
  intro() {
    const S = this.S;
    if (S.cfg.foe.isNemesis) {
      this.turnFlash('宿 敌', true);
      Cult.nemesis.meet();
      BGM.play('nemesis');
    } else if (S.cfg.foe.stronger) {
      this.turnFlash('越 境', true);
      BGM.play('overlord');
    } else this.turnFlash('遭 遇');

    setTimeout(() => {
      const e = S.e;
      this.say(e.title, this.foeLine(S), () => {
        this.say(S.hero.name, this.heroLine(S), () => this.playerTurn());
      });
    }, 1150);
  },
  foeLine(S) {
    if (S.cfg.foe.isNemesis)
      return `断剑冢里又添一块碑。这一块,写的是你的名字。`;
    if (S.cfg.foe.stronger)
      return `${S.e.realm}的气息压过来,像一座山。你知道自己打不过——但你也退不了。`;
    return `${S.e.line}你退了半步,又站住了。`;
  },
  heroLine(S) {
    if (S.cfg.foe.isNemesis) return `墨影。我们又见面了。`;
    if (S.cfg.foe.stronger) return `……境界差了一整个大境。但路是我自己选的。`;
    return `既然你要拦,那就别怪我不留情。`;
  },

  playerTurn(preId) {
    const S = this.S; if (!S || S.over) return;
    const sk = this.root.querySelector('#xd-sk');

    // 预选(玩家主动点的)直接结算
    if (preId) { sk.classList.remove('on'); this.resolvePlayer(preId); return; }

    // 没有任何可用技能 → 强制普攻
    const list = availableArts(S.hero).filter(id => canUseArt(S.hero, id));
    if (!list.length) {
      sk.classList.remove('on');
      this.turnFlash('你的回合');
      this.say(S.hero.name, '气海翻涌,神通未成——只能硬撼一掌。', () => {
        const dmg = Math.max(3, Math.round(14 - S.e.def));
        S.e.hp = Math.max(0, S.e.hp - dmg);
        this.hurt('ef'); this.paintHp();
        setTimeout(() => this.enemyTurn(), 520);
      });
      return;
    }

    this.turnFlash('你的回合');
    sk.innerHTML = list.map(id => {
      const cd = S.hero.cooldown[id] || 0;
      return `<button class="xx-sk" data-art="${id}">
        <div class="xx-sk-n">${esc(artName(id))}</div>
        <div class="xx-sk-c">${cd > 0 ? `冷却 ${cd}` : artFull(id).slice(0, 8)}</div>
      </button>`;
    }).join('');
    sk.classList.add('on');
  },

  resolvePlayer(id) {
    const S = this.S;
    this.busy = true;
    const r = playerAct(S.hero, S.e, id);
    if (!r) { this.busy = false; this.playerTurn(); return; }
    this.hurt('ef'); this.paintHp();
    this.say(S.hero.name, `${r.name}!${r.text} —— 造成 ${r.dmg} 点伤害。`, () => {
      if (isDead(S.e)) { this.win(); return; }
      this.enemyTurn();
    });
  },

  enemyTurn() {
    const S = this.S;
    this.turnFlash(S.cfg.foe.isNemesis ? '墨影' : '敌 攻', true);
    setTimeout(() => {
      const r = enemyAct(S.e, S.hero);
      this.hurt('hf'); this.paintHp();
      const tail = r.crit ? '这一击,避不开。' : '你退了两步,脚下全是血。';
      this.say(S.e.title, `「${r.line}」${tail} 受到 ${r.dmg} 点伤害。`, () => {
        if (playerDead(S.hero)) { this.lose(); return; }
        S.round++;
        this.busy = false;
        this.playerTurn();
      });
    }, 780);
  },

  hurt(who) {
    const el = this.root.querySelector('#' + (who === 'hf' ? 'xd-hf' : 'xd-ef'));
    el.classList.remove('hurt'); void el.offsetWidth; el.classList.add('hurt');
  },

  win() {
    const S = this.S; S.over = true;
    this.root.querySelector('#xd-sk').classList.remove('on');
    this.turnFlash('胜');
    const pill = S.cfg.node.pill || null;
    const dao = 80 + S.e.dmg * 4 + (S.cfg.foe.isNemesis ? 400 : 0);
    setTimeout(() => {
      this.say(S.hero.name, S.cfg.foe.isNemesis
        ? `碑碎了。你踩着碎碑走出去,一句话也没说。`
        : `对手散了。你收剑,转身,像什么都没发生过。`, () => {
          if (S.cfg.foe.isNemesis) Cult.nemesis.battle('win');
          S.cfg.onWin && S.cfg.onWin({ dao, exp: 60, pill });
          this.close();
        });
    }, 900);
  },

  lose() {
    const S = this.S; S.over = true;
    this.root.querySelector('#xd-sk').classList.remove('on');
    this.turnFlash('败');
    Cult.titles.track('challenge', 1);
    setTimeout(() => {
      // 战败分支:不清档,四条路
      const box = this.root.querySelector('#xd-defeat');
      box.classList.remove('hidden');
      box.innerHTML =
        `<div class="xx-defeat-in">
           <h3>战 败</h3>
           <div class="sub">你活着。但要付出代价。</div>
           <div class="xx-chio" data-c="ruin">
             <div class="h">硬受一击,转身就走 <em>反抗</em></div>
             <div class="d">不退。修为倒退,但那股狠劲留在了骨头里。入魔值 +15。</div></div>
           <div class="xx-chio" data-c="installment">
             <div class="h">放下身家,分期偿还 <em>暂缓</em></div>
             <div class="d">欠下 300 道行,三年为期。到期不还,后果自负。</div></div>
           <div class="xx-chio" data-c="ransom">
             <div class="h">交出全部身家 <em>赎金</em></div>
             <div class="d">钱没了,修为在。人还在。</div></div>
           <div class="xx-chio" data-c="ruin" style="border-color:rgba(181,52,42,.5)">
             <div class="h">认输,任他处置 <em>认 栽</em></div>
             <div class="d">修为尽废,跌一大境。人物、地图、神通,一样不丢。</div></div>
         </div>`;
      box.querySelectorAll('.xx-chio').forEach(el => {
        el.onclick = () => {
          const c = el.dataset.c;
          box.classList.add('hidden');
          S.cfg.onLose && S.cfg.onLose(c);
          this.close();
        };
      });
    }, 900);
  },
};
