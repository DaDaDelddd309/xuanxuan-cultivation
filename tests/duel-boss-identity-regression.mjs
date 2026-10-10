// duel-boss-identity-regression.mjs —— 工单 XX-PLAY-005 的门禁
//
// 修的 bug:`js/main.js` 把局内 boss 进回合制时的 foe.key **硬编码成 'moying'**。
// 于是打石像守卫 / 无常尊者,屏幕上出现的是**墨影的立绘 + 墨影的台词**。
// owner 原话:「石像守卫它名字叫做你不该来的???」——
// 名字槽位其实是对的(e.title = boss.name),但立绘和台词把它整个替换成了墨影。
//
// 本门禁钉三件事:
//   ① main.js 不许再把 foe.key 写死成某个反派
//   ② duel.js 给两个 roguelike boss 各配了台词
//   ③ 打 boss_golem 时拿到的台词**不是**墨影那句
//
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

// DOM stub:与 duel-echo-regression.mjs 同一套(assets.js 在模块顶层就 addEventListener)
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: { appendChild() {} }, getElementById: () => null };
globalThis.window = {};
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

console.log('\n=== [1] main.js 不得把 boss 的 foe.key 写死 ===');
{
  const MAIN = R('js/main.js');
  const { codeMask } = await import('./lib-uimod.mjs');
  const CODE = codeMask(MAIN).code;      // 先剥注释:注释里提到 'moying' 是合法的
  // 只看「构造回合制 foe 对象」那一段
  const seg = CODE.slice(CODE.indexOf('foe: {'), CODE.indexOf('foe: {') + 600);
  t("回合制的 foe.key 不再写死 'moying'",
    !/key:\s*'moying'/.test(seg),
    "seg 里还有 key:'moying' —— 所有 boss 都会继续演墨影");
  t('foe.key 来自 boss 自身的类型 id',
    /key:\s*boss\.type/.test(seg),
    '应当是 key: boss.type —— 那是 spawnEnemy 一直带着的真实类型');
  t('foe.name 仍然取 boss.name(名字槽位本来就对,别改坏)',
    /name:\s*boss\.name/.test(seg));
}

console.log('\n=== [2] duel.js 给局内 boss 配了各自的台词 ===');
{
  const DUEL = R('js/xiuxian/duel.js');
  t('boss_golem 有专属台词', /boss_golem\s*:\s*`/.test(DUEL),
    '石像守卫要说自己的话,不是墨影的');
  t('boss_overlord 有专属台词', /boss_overlord\s*:\s*`/.test(DUEL));
  // 兜底不得回落墨影 —— 那是「谁进回合制都在演墨影」的根
  const seg = DUEL.slice(DUEL.indexOf('foeLine(S)'), DUEL.indexOf('foeLine(S)') + 900);
  t("foeLine 的兜底里没有 'moying' 回落",
    !/FOE_LINE_UNKNOWN|return\s+FOE_LINES\.moying/.test(seg),
    '未知 key 回落墨影 = bug 原地保留');
  // 通用小妖仍走自己的随机台词(XX-PLAY-005 第一版误删过这条,被 duel-echo 打红)
  t('通用小妖仍走 S.e.line 随机台词(既有设计不能动)',
    /\$\{S\.e\.line\}你退了半步/.test(DUEL),
    '固定兜底句会打掉 duel-echo-regression 的「普通小妖台词不受结局影响」');
}

console.log('\n=== [3] 实跑:boss_golem 拿到的不是墨影台词 ===');
{
  // 真跑 duel.foeLine(),不靠正则抠源码
  const { Duel } = await import('../js/xiuxian/duel.js');
  const mkS = (key) => ({
    story: {}, arcNames: {},
    cfg: { foe: { key, isNemesis: false, stronger: false } },
    e: { realm: '结丹', line: '它动了。' },
  });
  const golem = Duel.foeLine(mkS('boss_golem'));
  const overlord = Duel.foeLine(mkS('boss_overlord'));
  const moying = Duel.foeLine(mkS('moying'));
  console.log(`    boss_golem    → ${golem}`);
  console.log(`    boss_overlord → ${overlord}`);
  console.log(`    moying        → ${moying}`);
  t('石像守卫说的是自己的话', golem !== moying && !golem.includes('你不该来'));
  t('无常尊者说的是自己的话', overlord !== moying && !overlord.includes('你不该来'));
  t('墨影仍然说墨影的话(没被误伤)', moying.includes('你不该来'));
  t('通用小妖仍用自己的随机台词',
    Duel.foeLine(mkS('wanderer')) === '它动了。你退了半步,又站住了。');
}

if (fail === 0) {
  console.log(`\n✅ XX-PLAY-005 通过:${pass} 项(boss 不再顶着墨影的皮)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— boss 还在演墨影`);
  process.exit(1);
}