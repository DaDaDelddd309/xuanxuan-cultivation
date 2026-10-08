// 酒馆同伴测试 —— 工单 XX-META-003
// 运行: node tests/test-tavern.mjs
//
// owner:「结束一局后可以……酒馆招揽下一局伙伴」
//
// 关键契约:同伴不是"攻击 +10%"这种数值,
// 他进局后会**真的改变这一局的世界规则**:
//   · minAlive  → Director 的保底怪量抬升(你不动,场面不会冷清到只剩几只)
//   · wardBonus  → 篝火护栏撑大
//   · 其余属性   → 落到 player.stats
import { install } from './harness.mjs';
install();
const { TAVERN, MATES } = await import('../js/xiuxian/tavern.js');
const { Director, computeWard } = await import('../js/game/director.js');
const { readFileSync } = await import('fs');
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

console.log('\n[1] 无线索不能招揽');
{
  TAVERN.reset();
  const r = TAVERN.recruit();
  ok('拒绝', r.ok === false, r.msg);
  ok('说清去哪弄', /集市/.test(r.msg), r.msg);
  ok('没有白送一个同伴', TAVERN.active() === null);
}

console.log('\n[2] 线索来自集市(不是凭空来的)');
{
  TAVERN.reset();
  ok('初始线索 0', TAVERN.leads() === 0);
  TAVERN.addLead(2);
  ok('加线索可用', TAVERN.leads() === 2);
  // 集市买 mate 类商品应当折成 TAVERN 线索,而不是存在 market 自己那儿
  const src = readFileSync(ROOT + '/js/xiuxian/market.js', 'utf8');
  ok('market 走 TAVERN.addLead', /TAVERN\.addLead/.test(src));
  ok('market 不再自己存 mates', !/this\.s\.mates/.test(src));
}

console.log('\n[3] 招到人是随机的(酒馆是赌运气)');
{
  TAVERN.reset();
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    TAVERN.addLead(1);
    const r = TAVERN.recruit();
    if (r.ok) seen.add(r.mate.id);
  }
  ok('能招到多种人', seen.size >= 3, [...seen].join(','));
  // 别拿"没抽全"证明随机 —— 同伴本来就只有 4 个,抽 300 次全见到很正常。
  // 要证明的是"概率不同":同一个人的出现率应当明显不同。
  const n = Object.keys(MATES).length;
  const counts = {};
  TAVERN.reset();
  for (let i = 0; i < 400; i++) { TAVERN.addLead(1); const r = TAVERN.recruit(); if (r.ok) counts[r.mate.id] = (counts[r.mate.id]||0)+1; }
  const rates = Object.values(counts).map(c => c/400);
  ok('不同人出现率不同(有稀有度)', Math.max(...rates) - Math.min(...rates) > 0.15,
     rates.map(r=>r.toFixed(2)).join(' '));
  // 线索守恒
  ok('线索刚好花光', TAVERN.leads() === 0, `${TAVERN.leads()}`);
}

console.log('\n[4] 同伴表结构完整');
{
  for (const [k, m] of Object.entries(MATES)) {
    ok(`${k} 有名字/档位/文案`, !!m.name && m.tier >= 1 && !!m.bio);
    ok(`${k} mods 是对象`, m.mods && typeof m.mods === 'object');
    ok(`${k} 有招募概率`, m.chance > 0 && m.chance <= 1, `${m.chance}`);
  }
  // 至少要有一个能改生成保底,一个能改护栏 —— 否则同伴就只是数值了
  ok('有人能抬保底怪量', Object.values(MATES).some(m => m.mods.minAlive));
  ok('有人能撑篝火护栏', Object.values(MATES).some(m => m.mods.wardBonus));
}

console.log('\n[5] 同伴真的改变生成规则(不是纯数值)');
{
  TAVERN.reset();
  const g0 = { enemies: [], pickups: [], time: 0 };
  Director.reset();
  Director.tick(0.016, g0);
  const solo = Director.desiredAlive(g0, 0);

  // 强制一个带 minAlive 的同伴
  const withMin = Object.values(MATES).find(m => m.mods.minAlive);
  TAVERN.s.active = withMin.id;
  Director.setMateMods(TAVERN.mods());
  const mate = Director.desiredAlive(g0, 0);
  ok('同伴抬高了保底怪量', mate > solo, `${solo.toFixed(2)} → ${mate.toFixed(2)}`);
  ok('抬升幅度 = mods 里的数值', Math.abs((mate - solo) - withMin.mods.minAlive) < 0.5,
     `差 ${(mate - solo).toFixed(2)} 期望 ${withMin.mods.minAlive}`);
  Director.setMateMods({});
}

console.log('\n[6] 同伴真的撑大篝火护栏');
{
  const base = computeWard({ campLv: 3, phase: 'day', pickup: 120 });
  const plus = computeWard({ campLv: 3, phase: 'day', pickup: 120, mate: 40 });
  ok('护栏变大', plus === base + 40, `${base} → ${plus}`);
  // 没有同伴时不该凭空多
  ok('默认没有加成', computeWard({ campLv: 3, phase: 'day', pickup: 120, mate: 0 }) === base);
}

console.log('\n[7] 换人 / 遣散');
{
  TAVERN.reset();
  TAVERN.addLead(3);
  const a = TAVERN.recruit().mate.id;
  TAVERN.addLead(1);
  const b = TAVERN.recruit().mate.id;
  ok('招一个就出战', !!TAVERN.active());
  ok('招第二个会顶替', TAVERN.active().id === b);
  ok('换回第一个', TAVERN.setActive(a).ok === true);
  ok('换人后出战正确', TAVERN.active().id === a);
  ok('没见过的人换不了', TAVERN.setActive('not_exist').ok === false);
  ok('遣散后为空', TAVERN.dismiss().ok && TAVERN.active() === null);
  ok('遣散不丢所有权', TAVERN.s.owned.length === 2);
}

console.log('\n[8] 存档往返');
{
  // harness 的 localStorage 是内存 Map,必须先 load() 才会被 TAVERN 接管
  TAVERN.load();
  TAVERN.reset();
  TAVERN.addLead(2);
  const first = TAVERN.recruit().mate.id;
  TAVERN.s.log.unshift({ id: first, name: 'x', t: 1 });
  TAVERN.save();
  TAVERN.load();
  ok('出战同伴还在', TAVERN.active().id === first);
  ok('线索数还在', TAVERN.leads() === 1, `${TAVERN.leads()}`);
  // recruit() 自己也记了一条,所以是 2 条(手动补的那条 + 招揽那那条)
  ok('招揽记录还在', TAVERN.s.log.length === 2, `${TAVERN.s.log.length} 条`);
}

console.log('\n[9] 同伴已接进局内(结构检查)');
{
  const main = readFileSync(ROOT + '/js/main.js', 'utf8');
  ok('main.js 引入了 TAVERN', /from '\.\/xiuxian\/tavern\.js'/.test(main));
  ok('开局把 mods 灌给 Director', /Director\.setMateMods\(TAVERN\.mods\(\)\)/.test(main));
  ok('属性 mods 落到 player.stats', /p0\.stats\.might/.test(main) && /p0\.stats\.magnet/.test(main));
  ok('护栏吃了同伴加成', /wardRadius\(pr, TAVERN\.mods\(\)\.wardBonus/.test(main));
  const ui = readFileSync(ROOT + '/js/xiuxian/ui.js', 'utf8');
  ok('修仙阁有酒馆入口', /vTavern\(\)/.test(ui));
  ok('集市页包含酒馆', /this\.vTavern\(\)/.test(ui));
}

console.log(`\ntest-tavern: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);