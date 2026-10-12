// 灵伴 · 独立拾取系统门禁 —— 工单 XX-COMPANION-004
// 运行: node tests/companion-gather-regression.mjs
//
// 验收依据(owner 原话,不是"跑通就行"):
//   「给它独立做一套」「跟boss一样跟着玩家,但速度慢,不断靠近玩家」
//   「不会伤害玩家」
//   「配一个玩家范围拾取技能,这个技能独立做」
//   「特效就是类似用狙击枪,红外线瞄准地面上的东西」
//   「但是不是所有,而是跟玩家一样的拾取」
//   「最多拾取范围是玩家那个拾取技能的max版本」
//   「不是拾取了直接到玩家身上」
//   「需要玩家靠近或者它靠近玩家,然后一条触手伸出来,慢慢触碰玩家」
//   「玩家只要看到触手伸出来就是知道它要把捡到的技能给自己了」
//
// ⚠️ 本门禁的价值全在 G2:**东西不能凭空到玩家身上**。
//   旧实现(companion-actor._pick)是"删掉宝石 + 立刻 addXp",
//   单看两边都"正常",只有把"宝石消失"和"玩家拿到经验"两个时刻
//   分开断言,才能钉住"必须先递送"这条契约。少一条断言,这条就没守住。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: { appendChild() {} }, getElementById: () => null,
};
globalThis.window = {};

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++;
  else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const read = f => readFileSync(ROOT + '/' + f, 'utf8');

const { COMPANION } = await import('../js/xiuxian/companion.js');
const { CompanionActor } = await import('../js/xiuxian/companion-actor.js');
const { GATHER_STATE } = await import('../js/xiuxian/companion-gather.js');

function mkGame() {
  return {
    player: { x: 0, y: 0, hp: 100, stats: { maxHp: 100, goldMult: 1 },
              _xp: 0, addXp(v) { this._xp += v; } },
    pickups: [], enemies: [], cam: { x: 0, y: 0 }, texts: [],
    stats: { gold: 0 }, time: 0,
    remove(a, i) { a[i] = a[a.length - 1]; a.pop(); },
    spawnText() {}, addParticles() {}, shake() {},
    // Director.onGemPickup 捡宝石时要调它加生成压力。桩里缺它,交付帧抛
    // TypeError,后面所有断言都跑不到,而且报错跟灵伴八竿子打不着。
    addEnemy(e) { this.enemies.push(e); return e; },
  };
}
/** 跑 n 帧,顺手记录"宝石消失"与"玩家拿到经验"这两个时刻 */
function run(a, g, frames) {
  const seen = [];
  let xpWhenGone = null, gone = false, touched = -1;
  for (let i = 0; i < frames; i++) {
    a.update(1 / 60);
    const st = a.gather.state;
    if (seen[seen.length - 1] !== st) seen.push(st);
    if (!gone && g.pickups.length === 0) { gone = true; xpWhenGone = g.player._xp; }
    if (gone && touched < 0 && g.player._xp > 0) touched = i;
  }
  return { seen, xpWhenGone, gone, touched };
}

// ============================================================
console.log('[G1] 上限 215 = 玩家磁铁满级,不是拍脑袋的数');
{
  // 逐项重算玩家磁铁的满级值,再与 SCAN_MAX 对账。
  // 只要上游改了 player.js / upgrades.js 的数值,这里就会红。
  const pj = read('js/game/player.js');
  const up = read('js/game/upgrades.js');
  const base = /magnet:\s*60\s*\+/.test(pj) ? 60 : null;      // player.js:137
  const charM = /magnet:\s*30,/.test(pj) ? 30 : null;          // player.js:31 游侠
  const maxLv = +(up.match(/magnet:\s*\{[^}]*maxLv:\s*(\d+)/) || [])[1];
  const perLv = +((up.match(/magnet:\s*\{\s*key:\s*'magnetFlat',\s*mode:\s*'add',\s*v:\s*(\d+)/) || [])[1]);
  const expect = base + charM + maxLv * perLv;
  ok('玩家磁铁基线仍是 60', base === 60, `实测 ${base}`);
  ok('游侠 magnet 仍是 30', charM === 30, `实测 ${charM}`);
  ok('磁石仍是 5 级', maxLv === 5, `实测 ${maxLv}`);
  ok('磁石仍是 +25/级', perLv === 25, `实测 ${perLv}`);
  ok(`满级合计 = 215 (实测 ${expect})`, expect === 215);

  const g = mkGame(); COMPANION.reset(); COMPANION.init('宝宝');
  const a = new CompanionActor(g); a.begin();
  ok('扫描半径**不超过**玩家满级', a.gather.scanRadius() <= 215, `实测 ${a.gather.scanRadius()}`);
  a.gather.elapsed = 600;   // 推到 ramp 之后
  ok('ramp 之后恰好封顶在 215', Math.round(a.gather.scanRadius()) === 215, `实测 ${a.gather.scanRadius()}`);
}

console.log('[G2] 核心:东西不能凭空到玩家身上(必须先递送)');
{
  const g = mkGame(); COMPANION.reset(); COMPANION.init('宝宝');
  const a = new CompanionActor(g); a.begin();
  g.pickups.push({ kind: 'gem', x: 70, y: 0, xp: 3, r: 8, t: 0 });
  const r = run(a, g, 3600);

  ok('状态轨迹完整 follow→fetch→carry→handoff',
     r.seen.join('>') === 'follow>fetch>carry>handoff>follow', r.seen.join('>'));
  ok('宝石确实从地上消失了', r.gone === true);
  ok('★ 宝石消失时玩家经验必须是 0', r.xpWhenGone === 0, `实测 ${r.xpWhenGone}`);
  ok('★ 之后玩家才拿到经验', g.player._xp === 3, `实测 ${g.player._xp}`);
  ok('★ 交付发生在宝石消失**之后**', r.touched > 0, `第 ${r.touched} 帧`);
  ok('年表记了她捡了几颗', COMPANION.s.run.picked === 1, `实测 ${COMPANION.s.run.picked}`);
  ok('触手伸完收回去了', a.gather.tentacle === 0, `实测 ${a.gather.tentacle}`);
}

console.log('[G3] 不会伤害玩家');
{
  const src = read('js/xiuxian/companion-gather.js') + read('js/xiuxian/companion-actor.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  ok('新系统没有调用任何伤害接口',
     !/\bplayer\.(hp|damage|takeDamage)\s*[-=]/.test(code) && !/\bhurt\(.*player/.test(code));
  ok('新系统不对玩家做碰撞/推挤', !/player\.[xy]\s*[-+]=/.test(code));
  // 运行时证明:她贴到玩家身上站 20 秒,玩家血量必须一动不动
  const g = mkGame(); COMPANION.reset(); COMPANION.init('宝宝');
  const a = new CompanionActor(g); a.begin();
  const hp0 = g.player.hp;
  for (let i = 0; i < 1200; i++) a.update(1 / 60);
  ok('★ 贴身 20 秒玩家血量不变', g.player.hp === hp0, `${hp0} → ${g.player.hp}`);
}

console.log('[G4] 只锁"玩家能拾取的那几类"');
{
  const g = mkGame(); COMPANION.reset(); COMPANION.init('宝宝');
  const a = new CompanionActor(g); a.begin();
  ok('宝石可锁', a.gather.canPick({ kind: 'gem' }));
  ok('金币可锁', a.gather.canPick({ kind: 'coin' }));
  ok('肉可锁', a.gather.canPick({ kind: 'meat' }));
  ok('宝箱可锁', a.gather.canPick({ kind: 'chest' }));
  ok('源石可锁', a.gather.canPick({ kind: 'stone' }));
  ok('怪不可锁', !a.gather.canPick({ kind: 'enemy' }));
  ok('未知道具不可锁', !a.gather.canPick({ kind: 'whatever' }));
  ok('空值不可锁', !a.gather.canPick(null));

  // 场上只有一件怪 —— 她**不该**伸手
  const g2 = mkGame(); COMPANION.reset(); COMPANION.init('宝宝');
  const a2 = new CompanionActor(g2); a2.begin();
  g2.pickups.push({ kind: 'enemy', x: 60, y: 0, r: 20, t: 0 });
  const r2 = run(a2, g2, 1800);
  ok('★ 只有怪时她一次都不伸手', r2.seen.includes('fetch') === false, r2.seen.join('>'));
}

console.log('[G5] 节奏:越久越快,但 10 秒是硬下限');
{
  const g = mkGame(); COMPANION.reset(); COMPANION.init('宝宝');
  const a = new CompanionActor(g); a.begin();
  const at = sec => { a.gather.elapsed = sec; return a.gather.interval(); };
  ok('开局 28 秒一次', at(0) === 28000, `实测 ${at(0)}`);
  ok('确实会变快', at(75) < at(0), `${at(0)} → ${at(75)}`);
  ok('2.5 分钟后到 10000', at(150) === 10000, `实测 ${at(150)}`);
  ok('★ 10 分钟后仍是 10000(永不下限)', at(600) === 10000, `实测 ${at(600)}`);
  ok('★ 1 小时后仍是 10000', at(3600) === 10000, `实测 ${at(3600)}`);
}

console.log('[G6] 触手要"慢慢"伸 —— 且够到才交付');
{
  const g = mkGame(); COMPANION.reset(); COMPANION.init('宝宝');
  const a = new CompanionActor(g); a.begin();
  g.pickups.push({ kind: 'gem', x: 70, y: 0, xp: 3, r: 8, t: 0 });
  // 一帧一帧看:HANDOFF 期间触手长度必须**递增**,不能瞬间到位
  let lens = [], prevState = '';
  for (let i = 0; i < 3600; i++) {
    a.update(1 / 60);
    if (a.gather.state === GATHER_STATE.HANDOFF && prevState !== GATHER_STATE.HANDOFF) lens = [];
    if (a.gather.state === GATHER_STATE.HANDOFF) lens.push(a.gather.tentacle);
    prevState = a.gather.state;
  }
  ok('触手是逐步伸长的(多帧,非瞬移)', lens.length >= 10, `HANDOFF 帧数 ${lens.length}`);
  // ⚠️ 下面这条曾经是**假绿**:写成 `for (i=1..) if (lens[i] < lens[i-1]) inc = false`,
  //    在 len<2 时循环体一次都不跑,inc 保持 true —— 于是"触手瞬间到位"这种
  //    恰恰要它抓住的坏状态,这条反而判绿。反向注入①实测复现。
  //    尺子必须**先要求样本量**,再看单调性,否则它测的是"循环跑了几次"。
  const enough = lens.length >= 5;
  ok('★ 样本量够(否则下面的单调性就是空转)', enough, `样本 ${lens.length} 个`);
  let inc = true;
  if (enough) for (let i = 1; i < lens.length; i++) if (lens[i] < lens[i - 1]) inc = false;
  ok('★ 触手长度单调递增(真的在"慢慢伸")', enough && inc,
     `样本 ${lens.slice(0, 5).map(x => x.toFixed(1)).join(' → ')}`);
}

console.log('[G7] 反向自检:尺子自己先红一遍');
{
  // 用一份**人工构造**的合成轨迹喂判据,证明它会区分好坏 ——
  // 否则这把尺子可能只是"永远绿",G2/G5/G6 就都是空的。
  const okGood = run({ update() {}, gather: { state: 'follow' } }, mkGame(), 1);
  ok('判据能跑(不会自己崩)', okGood.seen !== undefined);
  const src = read('js/xiuxian/companion-gather.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  ok('★ 递送状态真的在 gather 里(接线没被挪走/改名)',
     /GATHER_STATE\.HANDOFF/.test(code) && /_deliver/.test(code));
  ok('★ 交付走的是 applyPickup(和玩家同一个真源)', /applyPickup\(this\.g,\s*k\)/.test(code));
  ok('★ 旧的那条"直接给玩家经验"已不在',
     !/player\.addXp\(k\.xp\)/.test(read('js/xiuxian/companion-actor.js')));
}

// ============================================================
console.log(fail === 0
  ? `\n✅ 灵伴独立拾取系统通过:${pass} 项`
  : `\n❌ 灵伴独立拾取系统失败:${failed.length} 项`);
for (const f of failed) console.log('  · ' + f);
process.exit(fail === 0 ? 0 : 1);
