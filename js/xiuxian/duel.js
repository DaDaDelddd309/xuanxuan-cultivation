// ===== 回合制剧情战斗 · 表现层 =====
// 立绘 / 场景 / 逐段文本 / 技能栏 / 宿敌过场 / 战败分支 / BGM 状态机
// 契约:只调 battle.js 的纯函数,不改动它们。

import { Cult } from './index.js';
import { makeEnemy, playerAct, enemyAct, availableArts, canUseArt, isDead, playerDead } from './battle.js';
import { REALMS } from './realms.js';
import { artName, artFull, superSet, isSuper } from './arts.js';
import { BGM } from './relations.js';
import { STORY, ARCS } from './story.js';   // V0.99 结局回声(XX-NET-002)

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

// —— 局内 boss 的台词(XX-PLAY-005)——
//
// 原来 main.js 把 key 写死成 'moying',于是打石像守卫/无常尊者进回合制,
// 屏幕上出现的是墨影的立绘、说的是墨影的台词。owner 报「石像守卫叫你不该来」即此。
//
// 这两个是 roguelike 的 sprite(不是修仙阁反派),各有各的来历,不该借墨影的嘴。
// 仍然守 duel 的调性骨架(见 XX-ARCH-009):短句、只说一件事、不解释立场。
const FOE_LINES_BOSS = {
  boss_golem:    `「……你踩到我了。」`,
  boss_overlord: `「这条路的规矩,是我定的。」`,
};

// ————————————————————————————————————————————————————————————
// 工单 XX-NET-002:台词按**已结的结局**分支
//
// 之前 Duel 台词只按「敌人是谁」分(FOE_LINES / HERO_LINES / FOE_HIT),
// 完全不看玩家结过什么案。所以即使 §XX-NET-001 把结案变成了流言、
// 变成了网状,真到单挑时墨影依然只会说「你不该来」——
// 他不会提起碑上多了什么。这是「文案写到了,机制没接上」的典型。
//
// 这里让台词读 STORY.s.done:玩家结过什么,对手就说得出什么。
//
// ⚠️ 优先级高于敌人默认台词,但**低于**宿敌与越级那两句
//    (那两句是 duel 的调性骨架,不能被结局覆盖)。
// ⚠️ 台词仍然短句、仍然不给对方解释立场的余地 —— 与上面那段设计注释同守。
// ————————————————————————————————————————————————————————————

/** 哪些线结了会惊动墨影 */
const ECHO_WATCHERS = ['tomb', 'jiangu'];

/** 从 STORY.s.done 里,取对手"听说了"的第一条已结线索 */
function echoOf(S) {
  const done = S && S.story && S.story.done;
  if (!done) return null;
  const e = ECHO_WATCHERS.find(k => done[k]);
  if (!e) return null;
  const d = done[e];
  const arcName = (S.arcNames && S.arcNames[e]) || '那座墓';
  return { arc: e, arcName, path: d.path, epilogue: d.epilogue || '' };
}

const FOE_LINES_ECHO = {
  moying: p => p.path === 1
    ? `「空席。我刻了三百年的名字,最后自己坐上去了。」`
    : `「石将跪了。你替它把话说完了 —— 就没我什么事了。」`,
  heifeng: p => p.path === 1
    ? `「清路的不止我一个。但那条路,现在有人替我走了。」`
    : `「听说墓里那半句话被补全了。补的是你不悔的那版。」`,
  shougu: p => p.path === 1
    ? `「共过的人,一起死。你倒真敢往下走。」`
    : `「两百年前没人拦得住我。你现在倒像是拦住了谁。」`,
  youfang: p => p.path === 1
    ? `「狠人不多。你刚从墓里出来,又算一个。」`
    : `「听说有个轩氏把墓烧了。巧了,我也是。」`,
};

const HERO_LINES_ECHO = {
  moying: p => p.path === 1
    ? `「……墨影。你的碑上,这次没有我的名字。」`
    : `「石将能下班了。你呢?」`,
  heifeng: p => p.path === 1
    ? `「你清了那条路。现在轮到我走。」`
    : `「你补的是你不悔那句。我认。」`,
  shougu: p => p.path === 1
    ? `「一起死,这话我说过。既然你回来了,那就不算完。」`
    : `「两百年的规矩,你没破。这就够了。」`,
  youfang: p => p.path === 1
    ? `「墓里那位替我说了半句话。剩下半句我自己说。」`
    : `「狠人现在有三个了。」`,
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

    // story / arcNames:XX-NET-002 台词按已结结局分支用。
    // ⚠️ 必须在**开打前**抓一份快照塞进 S —— 决斗过程中结案状态不会变,
    // 但如果这里偷懒写 `get story(){ return STORY.s }`,一旦对手把某条线结了,
    // 同一场决斗里前后两句台词会来自不同世界线。快照更符合"开打那一刻的你"。
    this.S = {
      cfg, e,
      story: STORY.s,
      arcNames: Object.fromEntries(Object.keys(ARCS).map(k => [k, ARCS[k].name])),
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
    // XX-NET-002:结局分支。放在宿敌之后、敌人默认之前。
    const p = S.story && S.story.done ? echoOf(S) : null;
    if (p && FOE_LINES_ECHO[key]) return FOE_LINES_ECHO[key](p);
    if (FOE_LINES_BOSS[key]) return FOE_LINES_BOSS[key];   // XX-PLAY-005:局内 boss 各有自己的
    if (FOE_LINES[key]) return FOE_LINES[key];
    if (S.cfg.foe.stronger)
      return `${S.e.realm}的气息压过来,像一座山。你知道自己打不过——但你也退不了。`;
    // 通用小妖走**自己的**随机台词(`${S.e.line}`),不是固定句。
    // ⚠️ 我第一版在这里换成了固定兜底句,被 duel-echo-regression 的
    //    「普通小妖台词不受结局影响」当场打红 —— 那是既有设计,不该动。
    //    XX-PLAY-005 的真根因只是 main.js 把 key 写死成 'moying',
    //    而 FOE_LINES_BOSS 已经接住了 boss_golem / boss_overlord。
    return `${S.e.line}你退了半步,又站住了。`;
  },
  heroLine(S) {
    if (S.cfg.foe.isNemesis) return `墨影。我们又见面了。`;
    if (S.cfg.foe.stronger) return `……差了一整个大境。但路是我自己选的。`;
    // XX-NET-002:结局分支。放在越级之后 —— 那句是调性骨架,不能被覆盖。
    const p = S.story && S.story.done ? echoOf(S) : null;
    if (p && HERO_LINES_ECHO[S.cfg.foe.key]) return HERO_LINES_ECHO[S.cfg.foe.key](p);
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
