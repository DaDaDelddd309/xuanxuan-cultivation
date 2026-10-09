// ===== 回合制剧情战斗 · 表现层 =====
// 立绘 / 场景 / 逐段文本 / 技能栏 / 宿敌过场 / 战败分支 / BGM 状态机
// 契约:只调 battle.js 的纯函数,不改动它们。

import { Cult } from './index.js';
import { makeEnemy, playerAct, enemyAct, availableArts, canUseArt, isDead, playerDead } from './battle.js';
import { REALMS } from './realms.js';
import { artName, artFull, superSet, isSuper } from './arts.js';
import { BGM } from './relations.js';

const BG = { duel:'assets/bg/duel.jpg', cave:'assets/bg/cave.jpg', sect:'assets/bg/sect.jpg' };
const SCENE_BY_TYPE = { elite:'duel', boss:'duel', secret:'cave', field:'duel' };

const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));


// —— 每类敌人的专属台词 ——
// 一律短句。反派解释自己为什么强大,就等于把紧张感拆了。
const FOE_LINES = {
  moying:   `「你不该来。」`,
  heifeng:  `「这条道是我清出来的。想走?先问我的剑。」`,
  shougu:   `「守谷的活儿干了两百年。你算第几任来送命的?」`,
  youfang:  `「听闻轩氏出了个狠人。巧了,我也是。」`,
};
const HERO_LINES = {
  moying:   `「……这名字,我不该记得。」`,
  heifeng:  `「清路的不止你一个。」`,
  shougu:   `「两百年前没人拦得住我。今天试试。」`,
  youfang:  `「狠人不多。两个一起,正好。」`,
};
const FOE_HIT = {
  moying:   `「碑上是你的名字。」`,
  heifeng:  `「路,断了。」`,
  shougu:   `「谷里的规矩,由我定。」`,
  youfang:  `「接得住再说。」`,
};

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
    // 血量继承(D-01):
    //   cfg.hpRatio 是**局内实际打剩的比例**(main.js 从 boss 身上量出来的)。
    //   没有传才回退到原来的猜测值(秘境首次遭遇 = 满血)。
    //   之前写死 0.4,导致局内砍了半天进回合制 boss 又是满血 —— 白打。
    const autoRatio = typeof cfg.hpRatio === 'number'
      ? Math.max(0.05, Math.min(1, cfg.hpRatio))
      : (cfg.node.type === 'secret' ? 1.0 : 0.4);
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
        hp: 100 + pIdx * 30, arts: ps.arts, isSuper: superSet(ps.arts),
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
  // 开场白(XX-ARCH-009)
  // 设计原则(owner 原话):「反派死于废话多」。
  // 所以每句**只说一件事**,不给对方解释立场的余地,也不给自己抒情的机会。
  // 越级时不说"我比你强",只让对方**动手** —— 台词越短,压迫感越强。
  foeLine(S) {
    if (S.cfg.foe.isNemesis)
      return `断剑冢里又添一块碑。这一块,写的是你的名字。`;
    const key = S.cfg.foe.key || '';
    if (FOE_LINES[key]) return FOE_LINES[key];
    if (S.cfg.foe.stronger)
      return `${S.e.realm}的气息压过来,像一座山。你知道自己打不过——但你也退不了。`;
    return `${S.e.line}你退了半步,又站住了。`;
  },
  heroLine(S) {
    if (S.cfg.foe.isNemesis) return `墨影。我们又见面了。`;
    if (S.cfg.foe.stronger) return `……差了一整个大境。但路是我自己选的。`;
    if (HERO_LINES[S.cfg.foe.key]) return HERO_LINES[S.cfg.foe.key];
    return `既然你要拦,那就别怪我不留情。`;
  },
  // 出招时的短促一击 —— 不解释,只报数
  foeHitLine(S) {
    if (S.cfg.foe.isNemesis) return `「这一剑,替那些碑。」`;
    return FOE_HIT[S.cfg.foe.key] || null;
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
      const sup = isSuper(id);
      const lv = S.hero.arts[id] || 0;
      // 伤害预估,让超武的强度可见
      const mul = sup ? 2.2 : 1 + (Math.max(0, lv-1)) * 0.15;
      const est = Math.max(1, Math.round((10 + lv * 4) * mul) - S.e.def);
      return `<button class="xx-sk ${sup ? 'sup' : ''}" data-art="${id}">
        ${sup ? '<span class="xx-sk-tag">超武</span>' : ''}
        <div class="xx-sk-n">${esc(artName(id))}</div>
        <div class="xx-sk-c">${cd > 0 ? `冷却 ${cd}` : `威力 ${est}`}</div>
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
