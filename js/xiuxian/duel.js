// ===== 回合制剧情战斗 · 表现层 =====
// 立绘 / 场景 / 逐段文本 / 技能栏 / 宿敌过场 / 战败分支 / BGM 状态机
// 契约:只调 battle.js 的纯函数,不改动它们。

import { Cult } from './index.js';
import { makeEnemy, playerAct, enemyAct, availableArts, canUseArt, isDead, playerDead, tickCooldown } from './battle.js';
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

// ————————————————————————————————————————————————————————————
// 护体:敌人伤害与玩家血量之间那条**缺失的缓冲**
// ————————————————————————————————————————————————————————————
//
// 病(实测,不是推演)。全仓只有 battle.js:98 读 `s.dmgReduce`
// (`* (1 - (s.dmgReduce||0))`),而唯一写它的地方是下面 Duel.start 里的
// `dmgReduce: 0` —— 一根接满了水的管子。敌我之间没有任何缓冲层。
// 于是胜负由一个**定值**决定:「玩家打死敌人要几个回合」对
// 「敌人打死玩家要几个回合」。这两个数都不受玩家操作影响
// (enemyAct 只吃 e.dmg 与那个恒 0 的系数),差值为负就恒负。
//
//   真人实跑 Duel.start(240 种子/格,tests/duel-difficulty-gradient-regression.mjs),
//   新手·单神通(炼气,hp 100,满级 jianqi 伤害与强制普攻同为 12/回合):
//     敌人              e.dmg   改前胜率   改后胜率   护体
//     小妖·炼气           10      100.0%    100.0%    0.0%
//     精英·筑基           16       99.2%     99.2%    0.0%
//     越境·筑基           20       76.7%     76.7%    0.0%
//     boss·金丹           26       77.5%     77.5%    0.0%
//     宿敌·金丹(结怨 0)   26       77.5%     77.5%    0.0%
//     宿敌·结怨(结怨 75)  42        0.0%     27.9%   24.4%   ← 恒负就死在这一行
//     宿敌·深仇(结怨 150) 57        0.0%      0.0%   33.3%   ← 护体封顶后仍打不过
//
// 宿敌那一列的 e.dmg 随 grudge 走:relations.js powerBoost() = 1+min(1.2, grudge*0.008),
// 每打赢一场 +20(打输 +35,但那一半目前结构上不可达)。所以「恒负」不是宿敌的出厂值,
// 是**结怨攒深之后**才发作 —— 这也解释了为什么按「宿敌·金丹」取样时量到的不是 0%。
//
// 0.0% 的含义不是「难」,是「无论出什么牌都赢不了」——
// 锤子的原话:难打还留着「绕路」的可能性,恒负把博弈从根上取消了。
// 炼气新手打死一个 40 血的宿敌要 3.33 回合,而结怨 75 的宿敌 2.29 回合就能打死他。
//
// ⚠️ 这一档**不是**冷却层造成的:把 artCd 临时置 0(玩家每回合都有牌),
//   宿敌·结怨 的胜率仍然是 0.0%(见交付报告的隔离实验)。冷却层影响的是
//   「玩家有没有第二次决策」(PROBE-6/PROBE-10),那是 battle.js 的活。
//
// 为什么**不给全局减伤**:全局减伤会把上表里越境 76.7% / boss 77.5% 这两格
// 真实的难度一起抹平成恒胜(实测统一 25% 减伤时 新手行变成 100/100/100/99/30,
// flat 格子反而从 21 涨到 22)—— 把「难打」换成「恒胜」,只是换一个洞。
//
// 修法:只补缺失的那一条 —— **任何敌人都不得在少于 MIN_EXCHANGES 个回合内打死玩家**。
// 需要多少护体就给多少,封顶 MAX_GUARD。预算本来就够的敌人护体恒为 0,
// 胜率一个百分点都不动(上表左边四行改前改后逐格相同);只有「第一回合就定生死」
// 的那一档被托起来。
const MIN_EXCHANGES = 3;    // 玩家至少能挨满 3 个回合
const MAX_GUARD = 1 / 3;    // 护体最多挡掉三分之一 —— 再多就不像护体,像认输

/**
 * 算出这场决斗该给玩家多少护体。
 * enemyAct 的浮动是 0.85~1.25(battle.js:98),均值 1.05;
 * 暴击不进预算 —— 它是 15% 的意外,不是常态伤害。
 * @returns {number} 减伤比例,恒 ∈ [0, MAX_GUARD]
 */
function guardOf(heroHpMax, foeDmg) {
  const avgHit = foeDmg * 1.05;
  // NaN 防护沿用上面 hpRatio 那段的同款理由:这里多一层 Math.min/max,
  // 一旦 cfg.foe.realmIdx 是 undefined,e.dmg 就是 NaN,护体会变成 NaN,
  // 而 (1 - NaN) 会让 enemyAct 的伤害整体变 NaN ⇒ 玩家血量恒不落 ⇒ 架永远打不完。
  if (!Number.isFinite(avgHit) || avgHit <= 0) return 0;
  const need = 1 - heroHpMax / (MIN_EXCHANGES * avgHit);   // >0 ⇒ 三回合之内必死
  if (!(need > 0)) return 0;
  return Math.min(MAX_GUARD, need);
}

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
    // ⚠️ NaN 防护:Math.min/Math.max 对 NaN 一律返回 NaN,
    //   而 hpRatio 来自 main.js 对 boss.hp/boss.hpMax 的除法 ——
    //   只要 hpMax 是 0 或 undefined,ratio 就是 NaN/1(Infinity)。
    //   后果:isDead(NaN) 恒 false ⇒ **敌人永远打不死**,玩家必输且毫无线索。
    //   门槛写的是「1..100 的整数」,NaN 连门槛都过不去。
    const raw = typeof cfg.hpRatio === 'number' ? cfg.hpRatio : NaN;
    const autoRatio = Number.isFinite(raw)
      ? Math.max(0.05, Math.min(1, raw))
      : (cfg.node.type === 'secret' ? 1.0 : 0.4);
    e.hpMax = 100;
    e.hp = Math.max(1, Math.round(100 * autoRatio));
    e.title = cfg.foe.name;
    e.name = cfg.foe.name;
    e.realm = REALMS[cfg.foe.realmIdx] ? `${REALMS[cfg.foe.realmIdx].name}` : e.realm;
    e.dmg = Math.round(10 + cfg.foe.realmIdx * 6 + (cfg.foe.stronger ? 4 : 0));
    if (cfg.foe.isNemesis) e.dmg = Math.round(e.dmg * Cult.nemesis.powerBoost());

    // 护体:回合数预算不够时才兜底(见文件头 guardOf 的注释)。
    // 与 hp/hpMax 共用同一个式子 —— 玩家恒以满血入场这条既有约定(B11)不动。
    const heroHpMax = 100 + pIdx * 30;
    const guard = guardOf(heroHpMax, e.dmg);

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
        hpMax: heroHpMax,
        hp: heroHpMax, arts: ps.arts, isSuper: superSet(ps.arts),
        cooldown: {}, dmgReduce: guard,
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
    // XX-DUEL-009:点击对白区 = 两段式(打字中出全文 / 出完后进下一句)。
    // 实现全在 say() 里,这里只做转发 —— 判据留在 typewriter 那一处,免得两处分叉。
    r.querySelector('#xd-txt').addEventListener('click', () => this._typeClick && this._typeClick());
  },

  close() {
    this.root && this.root.classList.add('hidden');
    BGM.stop();
    // ⚠️ XX-DUEL-005(P0):busy 必须在这里复位。
    //
    // busy 是 resolvePlayer(:358)置 true 的,全仓只有两处复位:
    // :360(playerAct 返回 null 的早退)和 :378(敌攻后**活下来**才走到)。
    // 而赢(:363)和输(:376)两条终局路径都是**先 return**,根本到不了 :378。
    // 原来这里只清了 S,没清 busy ⇒ 它是个**单向闩**:第一场决斗一结束
    // (不论胜负),busy 永远停在 true,而技能栏的点击闸门正是
    // :193 `if (b && !this.busy)` ⇒ 第二场起按钮照常渲染、点击被无声吞掉,
    // 玩家看到的是一场永远打不完的架。
    //
    // 为什么能拖到现在:12 轮自动化、87 局,**一次都没打到过 Boss**。
    // 一局里通常只有一场决斗,所以「第二场」这个前提从没被满足过。
    this.busy = false;
    // XX-DUEL-009:`skipType` 已删(它三处赋值全是 false,点击跳过是死代码)。
    // 换成打字机真正的三个状态。`_advT` 必须一起清 —— 它是那个 260ms 的
    // "进下一句"定时器,不清的话 close() 之后它仍会触发,对着已经拆掉的
    // DOM 调 next(),报一个跟决斗毫无关系的错。
    clearTimeout(this._advT);
    this._advT = 0;
    this._typing = false;
    this._next = null;
    clearTimeout(this._th);
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
    // 护体要**看得见**:玩家看不到的减伤就是暗改难度,被发现了只会觉得被做手脚。
    // 这一档平时是空的(预算够的敌人护体为 0),只有真兜底的那几场才亮出来。
    const gd = S.hero.dmgReduce ? ` · 护体 -${Math.round(S.hero.dmgReduce * 100)}%` : '';
    q('xd-hpn').textContent = `${S.hero.name} ${Math.max(0, S.hero.hp)}/${S.hero.hpMax}${gd}`;
    q('xd-epn').textContent = `${Math.max(0, S.e.hp)}/${S.e.hpMax} ${S.e.title}`;
  },

  // 打字机:逐段自动播放,**可点击跳过**(XX-DUEL-009)
  //
  // ⚠️ 原来这里有个 `skipType`:点击 handler 写的是
  //    `if (this.skipType) this.finishType()`,而全仓**三处赋值全是 false**
  //    (close() / 本函数开头 / finishType()),没有任何一处设成 true ——
  //    那个 if 永远不成立,**点击跳过是死代码**。
  //    后果:开场 2~4 句对白,每字 26ms、每句结束再等 260ms
  //    (4 句约 160 字 ≈ 4.2s + 1.0s ≈ 5.2s),玩家每场开场都得站着看五秒不能动。
  //    而这是 v099p 之后"Boss 出场即进回合制"的第一印象。
  //    (对端连点 60 次无效后报上来,复核属实 —— 见 tests/duel-skip-regression.mjs)
  //
  // 修法是**还原它本来就想做的事**,不是新发明:
  //    正在打字 → 点一下 = 本句立刻出全文
  //    已经出完 → 再点一下 = 不等那 260ms,直接进下一句
  // 两个状态共用同一份出口,所以不存在"跳过只能跳一半"这种中间态。
  say(who, text, cb) {
    const q = id => this.root.querySelector('#' + id);
    q('xd-who').textContent = who;
    const el = q('xd-txt');
    el.textContent = '';
    this._typing = true;              // 正在逐字打
    this._next = cb || null;          // 本句结束后去哪(下一句 / 进玩家回合)
    this._advT = 0;                   // 排程中的"进下一句"定时器
    const cur = $('span', '', '');
    const cur2 = $('span', 'cursor');
    el.append(cur, cur2);
    let i = 0;
    const step = () => {
      if (i >= text.length) { this.finishType(); return; }
      cur.textContent += text[i++];
      this._th = setTimeout(step, 26);
    };
    this.finishType = () => {
      clearTimeout(this._th);
      cur.textContent = text;
      this._typing = false;           // 已出完 —— 此时再点是"进下一句"
      const nx = this._next;
      // 留 260ms 让玩家看清这一句。_next 在这段时间内**不清空**,
      // 因为玩家可能正好在这段空档里再点一下想直接往下走(见 _typeClick)。
      this._advT = setTimeout(() => { this._advT = 0; this._next = null; if (nx) nx(); }, 260);
    };
    this._typeClick = () => {
      if (this._typing) { this.finishType(); return; }   // 第一次点:立刻出全文
      if (this._advT) {                                  // 第二次点:不等了
        clearTimeout(this._advT);
        this._advT = 0;
        const nx = this._next;
        this._next = null;
        if (nx) nx();
      }
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
      // XX-NET-002b:开场白是**一整段对白**,不是两句 —— 拍序见 introBeats 的注释。
      const beats = this.introBeats(S);
      const sayAt = i => i < beats.length
        ? this.say(beats[i][0], beats[i][1], () => sayAt(i + 1))
        : this.playerTurn();
      sayAt(0);
    }, 1150);
  },

  /** 开场白要出口的整段对白,按「谁说」排好序。骨架两句恒在,回声两句有才加。 */
  introBeats(S) {
    const beats = [[S.e.title, this.foeLine(S)], [S.hero.name, this.heroLine(S)]];
    const fe = this.foeEchoLine(S), he = this.heroEchoLine(S);
    if (fe) beats.push([S.e.title, fe]);
    if (he) beats.push([S.hero.name, he]);
    return beats;
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

  // —— 结局回声的**第二拍**(XX-NET-002b)——
  //
  // 病:墨影(key:'moying')是唯一 isNemesis 恒为 true 的敌人
  //   (ui.js:777 的 boss 池只有 [['墨影','宿 敌','foe',true,'moying']]),
  //   而 foeLine/heroLine 都把宿敌骨架句排在 echo 分支**前面**
  //   ⇒ FOE_LINES_ECHO.moying / HERO_LINES_ECHO.moying 这四句
  //   —— 全项目里唯一让墨影对玩家结局作出反应的文本 —— 一句都上不了屏。
  //   外部审计的原话:「文本已经把答案写好了,机制让它到不了玩家眼前。」
  //
  // 为什么**不**把 echo 调回 foeLine/heroLine 里面置顶(那样四句也能上屏):
  //   ① 「断剑冢里又添一块碑。这一块,写的是你的名字」与「墨影。我们又见面了」
  //      是 XX-ARCH-009 那条调性骨架的锚点,也是本文件最好的两句。
  //      一被 echo 顶掉,宿敌战的开场就从「互相点名」退化成
  //      「他先自说自话,再报个菜名」—— 骨架不是冗余,是骨架。
  //   ② echo 四句比骨架句长(得交代他到底知道了什么)。**顶替** = 骨架消失;
  //      **追加** = 骨架还在,回声落在他紧跟着的那一句上。
  //   ③ 既有门禁 tests/duel-echo-regression.mjs §4 把「宿敌句优先于结局分支」
  //      钉成了断言。改优先级就得同时改那条断言,那不是本文件能自己决定的事。
  //
  // 所以取 **四拍**:骨架(敌)→ 骨架(我)→ 回声(敌)→ 回声(我)。
  //   拍序仍然敌/我交替 —— 没有让谁连说两句,XX-ARCH-009 那条没破。
  //   没结过 tomb/jiangu 的玩家一句都看不到:introBeats 只在真有回声时加拍。
  //
  // ⚠️ 去重:回声只在开场白**没能说出它**时才补第二拍。
  //   非宿敌的 foeLine/heroLine 本来就返回 echo(那一档本就在骨架句之后),
  //   那时再补一遍就是同一句话说两遍。
  //   判据刻意不写死优先级表,直接比字符串:line === foeLine(S) ⇒ 已经说过了。
  //   将来谁改了 foeLine 内部的顺序,这里会自动跟着改,不会两处说同一句。
  foeEchoLine(S) {
    const key = S.cfg.foe.key || '';
    const p = S.story && S.story.done ? echoOf(S) : null;
    if (!p || !FOE_LINES_ECHO[key]) return null;
    const line = FOE_LINES_ECHO[key](p);
    return line === this.foeLine(S) ? null : line;
  },
  heroEchoLine(S) {
    const key = S.cfg.foe.key || '';
    const p = S.story && S.story.done ? echoOf(S) : null;
    if (!p || !HERO_LINES_ECHO[key]) return null;
    const line = HERO_LINES_ECHO[key](p);
    return line === this.heroLine(S) ? null : line;
  },
  // 出招时的短促一击 —— 不解释,只报数
  foeHitLine(S) {
    if (S.cfg.foe.isNemesis) return `「这一剑,替那些碑。」`;
    return FOE_HIT[S.cfg.foe.key] || null;
  },

  playerTurn(preId) {
    const S = this.S; if (!S || S.over) return;
    // ⚠️ XX-DUEL-007:无参调用 =「一个玩家回合开始」,在这里递减一次冷却。
    //   放在这里而不是 playerAct 里,是为了让「无牌可打 → 强制普攻」
    //   那条分支也吃到递减 —— 那条分支根本不调 playerAct。
    //   有参调用 = 玩家点了某张牌,那是本回合的结算,不能再减一次。
    if (!preId) tickCooldown(S.hero);
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
        // ⚠️ XX-DUEL-008:这里原来**没有 isDead 判断**,打完直接转敌方回合。
        //   resolvePlayer 那条路(:378)是有的。于是走强制普攻把敌人打死 →
        //   不判胜 → 继续挨打 → 玩家输。
        //   「打死对方反而输」是这类 bug 里最恶劣的一种:它惩罚的恰恰是
        //   技能冷却全在、只能靠普攻撑住的玩家 —— 也就是最弱势的那批人。
        if (isDead(S.e)) { this.win(); return; }
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
           <div class="xx-chio" data-c="resist">
             <div class="h">硬受一击,转身就走 <em>反抗</em></div>
             <div class="d">不退。硬扛下来,境界没丢,只剩一半修为;但那股狠劲留在了骨头里。入魔值 +15。</div></div>
           <div class="xx-chio" data-c="installment">
             <div class="h">放下身家,分期偿还 <em>暂缓</em></div>
             <div class="d">欠下 300 道行,三年为期。到期不还,后果自负。</div></div>
           <div class="xx-chio" data-c="ransom">
             <div class="h">交出全部身家 <em>赎金</em></div>
             <div class="d">钱没了,修为在。人还在。</div></div>
           <div class="xx-chio" data-c="ruin">
             <div class="h">认输,任他处置 <em>认 栽</em></div>
             <div class="d">修为尽废,跌一大境。人物、地图、神通,一样不丢。入魔值 +8。</div></div>
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
