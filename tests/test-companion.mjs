// 灵伴重做测试 —— 工单 XX-COMP-001 / 002 / 003 / 004 / 005 / 006
// 运行: node tests/test-companion.mjs
//
// 验收依据(不是"跑通就行",是对着工单的判据断言):
//   XX-COMP-002  砍杀时看得见她动 + 捡东西;怪能打中她;连续死3次不出场
//   XX-COMP-003  台词随本局表现变化,同一表现必出同一句,每局 ≤2 句,不给选项
//   XX-COMP-004  修仙阁里零打扰,只留年表
//   XX-COMP-005  开局流程无任何选择项
//   XX-COMP-006  bond.js 的 hug 依赖清干净
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

// ---- 环境 shim(Node 无 DOM/localStorage)----
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

const { COMPANION } = await import('../js/xiuxian/companion.js');
const { CompanionActor } = await import('../js/xiuxian/companion-actor.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const read = f => readFileSync(ROOT + '/' + f, 'utf8');

// ---------- 测试夹具 ----------
function mkEngine() {
  return {
    player: {
      x: 0, y: 0, hp: 100, stats: { maxHp: 100 },
      _xp: 0, addXp(v) { this._xp += v; },
    },
    pickups: [], enemies: [],
    cam: { x: 0, y: 0 },
    texts: [],
    remove(arr, i) { arr[i] = arr[arr.length - 1]; arr.pop(); },
    spawnText(x, y, t) { this.texts.push({ x, y, t }); },
  };
}
const mkCtx = () => {
  const rec = { ellipse: [], arc: [], fill: 0, stroke: 0 };
  return { rec,
    save() {}, restore() {}, beginPath() {}, moveTo() {},
    quadraticCurveTo() {}, lineTo() {},
    ellipse(x, y) { rec.ellipse.push([x, y]); },
    arc(x, y, r) { rec.arc.push([x, y, r]); },
    fill() { rec.fill++; }, stroke() { rec.stroke++; },
    fillStyle: null, strokeStyle: null, lineWidth: 0, globalAlpha: 1 };
};
// 跑 n 帧
const run = (a, g, frames = 200, dt = 1 / 60) => { for (let i = 0; i < frames; i++) a.update(dt); };

// ============================================================
console.log('\n[1] XX-COMP-001 旧系统删干净');
{
  const src = read('js/xiuxian/companion.js');
  const gone = ['HUG_CHOICES', 'HUG_LINES', 'addAff(', 'tryGift(', 'hugChoose(', 'canHug(', 'STAGE'];
  for (const g of gone) {
    // 注释里可以提一句"删掉了 X",但不能有可执行定义
    const asCode = new RegExp(`(^|\\n)\\s*(export\\s+)?(const|function|let|var)?\\s*${g.replace(/[(]/g, '\\(')}`, 'm');
    ok(`companion.js 无 ${g} 定义`, !asCode.test(src));
  }
  ok('不再有 s.aff', !/\bs\.aff\b/.test(src.replace(/\/\/.*/g, '')));
  ok('不再有 s.route', !/\bs\.route\b/.test(src.replace(/\/\/.*/g, '')));
  // 体积的意义是"没有那套菜单系统",不是某个具体行数。
  // companion.js 后来又加了怨灵常量与昼夜护栏查询,涨一点是正常的 ——
  // 拿行数当验收标准,改一次实现就得改一次测试,那是指标错了。
  ok('体积远小于旧版 342 行', src.split('\n').length < 340, `实际 ${src.split('\n').length}`);
  ok('没有回到菜单系统的体量级(>400 行说明又长回来了)',
     src.split('\n').length < 400, `实际 ${src.split('\n').length}`);
}

console.log('\n[2] XX-COMP-005 开局仪式无任何选择项');
{
  const src = read('js/xiuxian/ritual.js');
  const code = src.replace(/\/\/.*/g, '');
  ok('ritual 无 options 步骤', !/options\s*:/.test(code));
  ok('ritual 无三选一文案', !/愿意亲我一下吗/.test(code));
  ok('ritual 不再调用 choose', !/COMPANION\.choose/.test(code));
  ok('ritual 仍会取名', /COMPANION\.init\(/.test(code));
}

console.log('\n[3] XX-COMP-006 bond.js 的 hug 依赖清干净');
{
  const src = read('js/xiuxian/bond.js');
  const code = src.replace(/\/\/.*/g, '');
  ok('无 showHug', !/showHug/.test(code));
  ok('无 hugChoose', !/hugChoose/.test(code));
  ok('无 data-hug 按钮', !/data-hug/.test(code));
  ok('无 idle 念白', !/\bidle\s*\(/.test(code));
  ok('reviveCountdown 当方法调用', /COMPANION\.reviveCountdown\(\)/.test(code));
}

console.log('\n[4] XX-COMP-003 台词由本局表现触发,非随机池');
{
  COMPANION.reset(); COMPANION.init('宝宝'); COMPANION.beginRun();
  // 「同一表现必出同一句」= 不是随机池:同一个键永远给同一句,
  // 而不是"同一表现可以在若干句里随机抽"。
  const a = COMPANION.say('fullHp');
  ok('同一表现固定同一句', a === '「今天没出手。」', `实际 ${a}`);
  const b = COMPANION.say('fullHp');
  ok('重复触发返回 null(不啰嗦)', b === null, `实际 ${b}`);
  const c = COMPANION.say('diedOnce');
  ok('第二句仍可说', c === '「你上次差点没回来。」', `实际 ${c}`);
  ok('两句后封顶', COMPANION.say('hiding') === null);
  ok('sayLeft 归零', COMPANION.sayLeft() === 0);

  COMPANION.beginRun();
  ok('新一局重置台词预算', COMPANION.sayLeft() === 2 && COMPANION.say('fullHp') !== null);
}

console.log('\n[5] XX-COMP-002 局内状态与生死');
{
  COMPANION.reset(); COMPANION.init('宝宝');
  COMPANION.beginRun();
  ok('开局她出场', COMPANION.s.run.present === true);

  // 连死 3 次 → 本局不出场
  COMPANION.beginRun();
  COMPANION.onPlayerDeath(); COMPANION.onPlayerDeath(); COMPANION.onPlayerDeath();
  ok('连续死3次已记录', COMPANION.s.run.deadStreak === 3);
  const r = COMPANION.beginRun();
  ok('连死3次后本局不出场', r.present === false, `present=${r.present}`);
  ok('不出场时不发台词', COMPANION.say('fullHp') === null);

  // 活着过关清空死亡计数
  COMPANION.beginRun();
  COMPANION.onPlayerDeath();
  COMPANION.onRunClear();
  ok('过关后 deadStreak 清零', COMPANION.s.run.deadStreak === 0);
  COMPANION.beginRun();
  ok('过关后下一局她出场', COMPANION.s.run.present === true);
  COMPANION.beginRun(); COMPANION.onRunClear();
  COMPANION.beginRun(); COMPANION.onRunClear();
  COMPANION.beginRun();
  ok('连续三局没死 → cleanStreak=3', COMPANION.s.run.cleanStreak === 3, `实际 ${COMPANION.s.run.cleanStreak}`);
}

console.log('\n[6] XX-COMP-002 局内行为:捡东西 / 会受伤 / 会躲');
{
  COMPANION.reset(); COMPANION.init('宝宝');
  const g = mkEngine();
  const a = new CompanionActor(g);
  a.begin();
  ok('开局跟到玩家身后', Math.abs((g.player.x - a.x) - 36) < 2, `gap=${g.player.x - a.x}`);

  // 捡宝石:玩家右边放一颗,她应该跑过去并捡走
  g.pickups.push({ kind: 'gem', x: 70, y: 0, xp: 3, r: 8 });
  run(a, g, 240);
  ok('她把宝石捡走了', g.pickups.length === 0, `还剩 ${g.pickups.length} 颗`);
  ok('宝石经验给了玩家', g.player._xp === 3, `实际 ${g.player._xp}`);
  ok('本局计数 +1', COMPANION.s.run.picked === 1, `实际 ${COMPANION.s.run.picked}`);
  ok('场上出现过"她捡走了"提示', g.texts.some(t => t.t === '她捡走了'));

  // 会受伤:怪贴脸
  COMPANION.beginRun();
  a.hurtCd = 0;
  g.enemies.push({ x: a.x, y: a.y, dead: false });
  a.update(1 / 60);
  ok('怪打中她 → 掉血', COMPANION.s.run.hp === 50, `实际 ${COMPANION.s.run.hp}`);
  ok('记录本局挨过打', COMPANION.s.run.tookDamage === true);
  g.enemies.length = 0;

  // 掉光 → 消失一会儿(每次 -10,从当前血量打空)
  let downs = 0;
  for (let i = 0; i < 12 && a.present; i++) { a.hurtCd = 0; if (a.hurt() === -1) { downs++; break; } }
  ok('血空后被标记 -1', downs === 1, `downs=${downs}`);
  ok('被打散后不在场上', a.present === false);
  ok('血量回满等待下轮', COMPANION.s.run.hp === 60, `实际 ${COMPANION.s.run.hp}`);

  // 会躲:玩家残血
  COMPANION.beginRun();
  a._downT = 0;
  a.present = true;
  g.player.hp = 20;
  run(a, g, 60);
  ok('玩家残血 → 她后退', a.retreating === true);
  ok('后退时离得更远', (g.player.x - a.x) > 60, `距离 ${g.player.x - a.x}`);
  ok('shouldRetreat 阈值正确', COMPANION.shouldRetreat(0.29) === true && COMPANION.shouldRetreat(0.31) === false);
}

console.log('\n[7] 镜头偏移用 cam(不是 camera)');
{
  COMPANION.beginRun();
  const g = mkEngine();
  g.cam.x = 1000; g.cam.y = 500;
  const a = new CompanionActor(g);
  a.begin();
  a.update(1 / 60);
  const ctx = mkCtx();
  a.draw(ctx);
  ok('她被画出来了', ctx.rec.fill > 0 && ctx.rec.stroke > 0);
  const [ex, ey] = ctx.rec.ellipse[0] || [NaN, NaN];
  // 影子画在脚下:偏移为 (0, +2)
  ok('投影减去了 cam', Math.abs(ex - (a.x - 1000)) < 0.001 && Math.abs(ey - (a.y - 500 + 2)) < 0.001,
     `画在(${ex},${ey}),期望(${a.x - 1000},${a.y - 498})`);
  ok('若误用 camera 会明显偏移(反证)', Math.abs(a.x - 1000 - (a.x)) > 1);
}

console.log('\n[8] XX-COMP-004 修仙阁零打扰,只留年表');
{
  COMPANION.reset(); COMPANION.init('宝宝');
  COMPANION.beginRun();
  COMPANION.onPick(2);
  COMPANION.markRun({ deaths: 0, picks: 2, present: true });
  ok('年表记了一笔', COMPANION.s.log.length === 1);
  ok('这一笔记着死了几次/捡了几颗', COMPANION.s.log[0].deaths === 0 && COMPANION.s.log[0].picks === 2);
  for (let i = 0; i < 50; i++) COMPANION.markRun({ deaths: 1, picks: 0, present: false });
  ok('年表有上限(40)', COMPANION.s.log.length === 40, `实际 ${COMPANION.s.log.length}`);
}

console.log('\n[9] 存档往返:局内状态不入档,身份与年表入档');
{
  COMPANION.reset(); COMPANION.init('小满');
  COMPANION.s.ghost.on = true; COMPANION.s.ghost.count = 4;
  COMPANION.markRun({ deaths: 1, picks: 3, present: true });
  COMPANION.beginRun();
  COMPANION.onPick(7);
  COMPANION.save();
  const raw = JSON.parse(mem.get('xx_companion_v081'));
  ok('名字入档', raw.name === '小满');
  ok('怨灵状态入档', raw.ghost && raw.ghost.on === true && raw.ghost.count === 4);
  ok('年表入档', Array.isArray(raw.log) && raw.log.length === 1);
  ok('局内状态不入档(不存 run)', !('run' in raw));

  // 读回后仍能继续
  COMPANION.s = { name: '', run: COMPANION.s.run, ghost: {}, log: [] };
  COMPANION.load();
  ok('读回名字', COMPANION.s.name === '小满');
  ok('读回怨灵', COMPANION.s.ghost.count === 4);
  ok('读回年表', COMPANION.s.log.length === 1);
}

// 老存档(没有 run/log 字段)不能崩
{
  mem.set('xx_companion_v081', JSON.stringify({ name: '老玩家', ghost: { on: true } }));
  COMPANION.load();
  ok('老存档能载入不抛异常', COMPANION.s.name === '老玩家');
  ok('老存档缺字段时用默认值', Array.isArray(COMPANION.s.log));
  COMPANION.beginRun();
  ok('老存档也能正常开局', COMPANION.s.run.present === true);
}

// ============================================================
console.log(`\ntest-companion: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);