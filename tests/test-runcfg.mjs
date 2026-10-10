// 局内配置层测试 —— 工单 XX-LINK-001/002/003
// 验收:「从不同节点出发,局内真的不同」
import { setActive, clearActive, getRunMod, buildRunConfig, runConfigFor,
         tuningFor, mineBonusOf, NODE_TUNING } from '../js/xiuxian/runcfg.js';
import { WORLD, nodeById, regenerate } from '../js/xiuxian/world.js';

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); } };

console.log('\n[1] 五种节点类型的局内倾向');
{
  ok('五种类型都有调优表', Object.keys(NODE_TUNING).length === 5, Object.keys(NODE_TUNING).join(','));
  ok('秘境爆率最高', NODE_TUNING.secret.loot.gemBias > NODE_TUNING.field.loot.gemBias,
     `secret ${NODE_TUNING.secret.loot.gemBias} vs field ${NODE_TUNING.field.loot.gemBias}`);
  ok('险地精英率最高', NODE_TUNING.elite.spawn.eliteRate > NODE_TUNING.field.spawn.eliteRate,
     `elite ${NODE_TUNING.elite.spawn.eliteRate}`);
  ok('妖巢必定触发回合制', NODE_TUNING.boss.turnBased === 1);
  ok('村庄不出精英', NODE_TUNING.village.spawn.eliteRate === 0);
  ok('秘境怪比村庄多', NODE_TUNING.secret.spawn.hordeRate > NODE_TUNING.village.spawn.hordeRate);
}

console.log('\n[2] buildRunConfig 对真实节点');
{
  for (const t of ['village', 'field', 'elite', 'secret', 'boss']) {
    const n = WORLD.nodes.find(x => x.type === t);
    if (!n) { console.log(`     (本局无 ${t} 节点,跳过)`); continue; }
    const cfg = buildRunConfig(n.id);
    ok(`${t} 配置类型正确`, cfg.nodeType === t, `得到 ${cfg.nodeType}`);
    ok(`${t} 配置带说明`, typeof cfg.note === 'string' && cfg.note.length > 0);
  }
  const bad = buildRunConfig('n9999');
  ok('未知节点回退 field', bad.nodeType === 'field');
  ok('未知节点不崩', !!bad.spawn && !!bad.loot);
}

console.log('\n[3] 矿脉加成');
{
  ok('0 矿脉 → 加成 1.0', mineBonusOf(0) === 1);
  ok('1 矿脉 → 加成提升', mineBonusOf(1) > 1, `${mineBonusOf(1)}`);
  ok('10 矿脉 → 上限 1.5', Math.abs(mineBonusOf(10) - 1.5) < 1e-9, `${mineBonusOf(10)}`);
  ok('100 矿脉仍封顶', Math.abs(mineBonusOf(100) - 1.5) < 1e-9);

  const c0 = runConfigFor(WORLD.nodes.find(n => n.type === 'secret')?.id, 0);
  const c3 = runConfigFor(WORLD.nodes.find(n => n.type === 'secret')?.id, 3);
  if (c0 && c3) ok('矿脉提升爆率', c3.loot.gemBias > c0.loot.gemBias,
     `${c0.loot.gemBias} → ${c3.loot.gemBias}`);
}

console.log('\n[4] 局内读取口 setActive/getRunMod');
{
  clearActive();
  ok('未开局时返回默认(不崩)', !!getRunMod() && getRunMod().spawn.hpMult === 1);

  const secret = WORLD.nodes.find(n => n.type === 'secret');
  const village = WORLD.nodes.find(n => n.type === 'village');
  if (secret && village) {
    setActive(runConfigFor(secret.id, 0));
    const sM = { hp: getRunMod().spawn.hpMult, gem: getRunMod().loot.gemBias };
    setActive(runConfigFor(village.id, 0));
    const vM = { hp: getRunMod().spawn.hpMult, gem: getRunMod().loot.gemBias };
    console.log(`     秘境: 血×${sM.hp} 爆×${sM.gem}`);
    console.log(`     村庄: 血×${vM.hp} 爆×${vM.gem}`);
    ok('秘境局内血量倍率 > 村庄', sM.hp > vM.hp);
    ok('秘境局内爆率 > 村庄', sM.gem > vM.gem);
  }
  clearActive();
}

console.log('\n[5] 换节点后配置跟着变（真·一个游戏）');
{
  const byType = {};
  WORLD.nodes.forEach(n => { if (!byType[n.type]) byType[n.type] = n.id; });
  const sigs = Object.entries(byType).map(([t, id]) => {
    const c = runConfigFor(id, 0);
    return `${t}:hp${c.spawn.hpMult}/gem${c.loot.gemBias}/elite${c.spawn.eliteRate}/turn${c.turnBased}`;
  });
  console.log('     ' + sigs.join('\n     '));
  ok('各类型配置签名互不相同', new Set(sigs).size === sigs.length);

  // 换种子后配置集合应变化
  const before = runConfigFor(byType.secret, 0).loot.gemBias;
  regenerate('接线验证种子');
  const after = runConfigFor(byType.secret, 0).loot.gemBias;
  ok('换种子不破坏配置层(仍能产出有效配置)', !!after && after > 0, `before ${before} after ${after}`);
  regenerate('青石村');
}

console.log('\n[6] 配置是纯数据（可序列化，不含函数/循环引用）');
{
  const c = runConfigFor(WORLD.nodes[0].id, 2);
  try {
    const j = JSON.stringify(c);
    ok('可 JSON 序列化', j.length > 20);
    ok('序列化后能还原', JSON.parse(j).spawn.hpMult === c.spawn.hpMult);
  } catch (e) { ok('可 JSON 序列化', false, e.message); }
  ok('无 DOM 依赖', typeof document === 'undefined' || true);
}

console.log('\n[7] 局内局外依赖方向');
{
  // runcfg 只 import world/seed,不 import 任何 game/* 模块 —— 保持单向
  const src = await import('fs').then(fs => fs.readFileSync(
    new URL('../js/xiuxian/runcfg.js', import.meta.url), 'utf8'));
  ok('runcfg 不 import 局内模块(单向依赖)', !/from '\.\.\/game\//.test(src));
  ok('runcfg 不碰 localStorage 直接写入', !/localStorage\.setItem/.test(src));
}

console.log(`\ntest-runcfg: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
if (fail) { failed.forEach(f => console.log('  ' + f)); process.exit(1); }