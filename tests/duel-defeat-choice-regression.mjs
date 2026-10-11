// duel-defeat-choice-regression.mjs —— 战败四选项「文案 ↔ 实现」一致性的门禁
//
// 同事交来的实测:四条战败路线的**结算文案与实际扣血对不上**
//   ①反抗 qi第10层 ⚠️跌境  ← 文案说「转身就走」,实现是掉境界
//   ④认栽 qi第10层 ⚠️跌境
// 四个选项里两个同义,这不是一个有效的选择 —— 「反抗」那块牌是纯陪衬。
//
// ⚠️ 本门禁盯的是**同一个东西的两半**:玩家在面板上读到的那行字,
//   和 DEFEAT.resolve() 真正落进存档的那个 effect。
//   既有门禁 tests/defeat-choice-matrix.mjs 盯的是**四条路的代价画像两两不同、
//   没有一条被支配**(结果层)。结果层全绿,**照样可能每一行的文案都在撒谎** ——
//   面板上写「入魔值 +15」,实现里 +0,代价画像那套照样成立。
//   同事报的这张表,就是那种「结果对、话说错」的洞的另一半。两边都要盯。
//
// ⚠️ 为什么不用「复制一份代价表进测试」:抄一份进来,改产品时数字不动,
//   改测试时数字动,两边都不报错。这里**从 duel.js 的 innerHTML 里正则解析**
//   面板文案,从 relations.js 里**真跑 resolve()** 拿 effect ——
//   两半都是产品自己的字节。
//
// 本门禁**只断言不变量,不断言「现在是不是坏的」**:修好了它绿,
// 坏回去它红。它不预判任何一条路当前长什么样。
//
// 出处可复现:node tests/duel-defeat-choice-regression.mjs
// 退出码:0 = 通过;1 = 不通过;2 = **门禁自身失效**(自检不过,见 [5])
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(ROOT + '/' + p, 'utf8');

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null };
globalThis.window = { addEventListener() {} };

let pass = 0, fail = 0; const RED = [], SELF_FAIL = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; RED.push(n); console.log(`  ❌ ${n}${d ? '\n       — ' + d : ''}`); }
};
/** 度量工具本身出问题 ⇒ 这轮结果不可信,必须 exit 2 而不是 exit 1 */
const tf = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; SELF_FAIL.push(n); console.log(`  🛑 ${n}${d ? '\n       — ' + d : ''}`); }
};

const { DEFEAT } = await import('../js/xiuxian/relations.js');

// ————————————————————————————————————————————————————————————
// [1] 面板文案:直接从 duel.js 的 lose() innerHTML 里解析
// ————————————————————————————————————————————————————————————
const DUEL = R('js/xiuxian/duel.js');
const loseAt = DUEL.indexOf('lose() {');
tf('duel.js 里还找得到 lose() 战败分支', loseAt > 0, 'lose() 不见了 —— 下面全是在测一个不存在的东西');

/** 把 `.xx-chio` 块拆成 { c, h, d } */
const panel = [...DUEL.slice(loseAt).matchAll(
  /data-c="([^"]+)"\s*>\s*<div class="h">([\s\S]*?)<\/div>\s*<div class="d">([\s\S]*?)<\/div>/g,
)].map(([, c, h, d]) => ({
  c,
  h: h.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  d: d.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
}));

const ROUTES = ['resist', 'installment', 'ransom', 'ruin'];

// ————————————————————————————————————————————————————————————
// [2] 兑现:从 resolve() 真跑出来的 effect
// ————————————————————————————————————————————————————————————
const effectOf = c => DEFEAT.resolve({ title: '石像守卫' }, null, {
  resist: c === 'resist', installment: c === 'installment', ransom: c === 'ransom', debt: 300,
}).effect;

// ————————————————————————————————————————————————————————————
// [3] 文案 → 兑现 的规则表
//   每条规则把面板上的一句**大白话**翻译成一个可判定的断言。
//   规则没命中 = 这句话这轮不存在(不是「通过」),命中分布见 [4] 的覆盖率。
// ————————————————————————————————————————————————————————————
function checkCopy(copy, e) {
  const out = [];
  const add = (name, claim, ok, detail) => out.push({ name, claim, ok, detail });
  const rm = e.realmDamage || 0;

  if (/境界没丢|保住境界|境界不跌/.test(copy))
    add('realm-kept', '「境界没丢」 ⇒ 不许有 realmDamage', !rm, `effect.realmDamage=${rm}(文案说保住,实现跌了 ${rm} 境)`);
  if (/跌一大境|跌一境|跌境/.test(copy))
    add('realm-drop', '文案说跌境 ⇒ effect 真的带 realmDamage', rm >= 1, `effect.realmDamage=${rm}(文案说要跌,实现没跌)`);
  if (/只剩一半修为|折了一半/.test(copy))
    add('half-exp', '「只剩一半修为」 ⇒ expLoss 落在 0 和 1 之间',
      typeof e.expLoss === 'number' && e.expLoss > 0 && e.expLoss < 1,
      `effect.expLoss=${e.expLoss}(不是部分损失 —— 承诺没兑现,或者压根没人读它)`);
  if (/修为尽废|修为尽失/.test(copy))
    add('exp-wiped', '「修为尽废」 ⇒ expLoss=1 或直接跌境(跌境会把 exp 清零)',
      e.expLoss === 1 || rm >= 1, `effect.expLoss=${e.expLoss} realmDamage=${rm}(修为其实留着)`);
  if (/入魔值\s*\+(\d+)/.test(copy)) {
    const want = Number(copy.match(/入魔值\s*\+(\d+)/)[1]);
    add('demon', `「入魔值 +${want}」 ⇒ effect.demon 真的是 ${want}`, e.demon === want,
      `effect.demon=${e.demon}(面板在报一个没兑现的数)`);
  }
  if (/欠下\s*(\d+)\s*道行/.test(copy)) {
    const want = Number(copy.match(/欠下\s*(\d+)\s*道行/)[1]);
    add('debt', `「欠下 ${want} 道行」 ⇒ effect.debt.total=${want}`,
      !!e.debt && e.debt.total === want, `effect.debt=${JSON.stringify(e.debt)}(欠条和文案对不上)`);
  }
  if (/钱没了|身家/.test(copy))
    add('dao', '「钱没了 / 交出身家」 ⇒ effect 真的 daoLoss',
      typeof e.daoLoss === 'number' && e.daoLoss > 0, `effect.daoLoss=${e.daoLoss}(身家没少,这条等于白点)`);
  return out;
}

console.log('\n=== [1] 面板上的四条路(从 duel.js 的 innerHTML 解析) ===');
{
  tf('解析出 4 个选项块', panel.length === 4, `只解析出 ${panel.length} 个:${panel.map(p => p.c).join(',')}`);
  const cs = panel.map(p => p.c);
  t('四个 data-c 正好是 resist / installment / ransom / ruin,各一个',
    ROUTES.every(r => cs.filter(x => x === r).length === 1), `实读:${JSON.stringify(cs)}`);
  for (const p of panel) console.log(`     · ${p.c.padEnd(12)} 「${p.d}」`);
}

console.log('\n=== [2] 文案 ↔ 实现:逐条对齐(同事报的就是这一段) ===');
const matrix = [];
{
  for (const p of panel) {
    const e = effectOf(p.c);
    const checks = checkCopy(p.h + ' ' + p.d, e);
    matrix.push({ route: p.c, e, checks, copy: p.h + ' ' + p.d });
    console.log(`     · ${p.c.padEnd(12)} effect=${JSON.stringify(e)}`);
    for (const c of checks) t(`「${p.c}」${c.name}: ${c.claim}`, c.ok, c.detail);
  }
}

console.log('\n=== [3] 四条路两两不同(选项要有意义就得真的不同) ===');
{
  const sigs = matrix.map(m => JSON.stringify(m.e));
  t('四条路的 effect 签名两两不同', new Set(sigs).size === 4,
    `签名集合大小=${new Set(sigs).size}:${sigs.join(' / ')}`);
  const copies = matrix.map(m => m.copy);
  t('四条路的面板文案两两不同', new Set(copies).size === 4, `文案集合大小=${new Set(copies).size}`);
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      const a = matrix[i], b = matrix[j];
      const ok = (a.e.realmDamage || 0) !== (b.e.realmDamage || 0) || a.copy !== b.copy;
      t(`「${a.route}」vs「${b.route}」至少有一处不同(跌境数不同 或 文案不同)`, ok,
        `两条 realmDamage 都是 ${a.e.realmDamage || 0}、文案也一样 ⇒ 这两条同义,不是选择`);
    }
  }
}

console.log('\n=== [4] 规则表不许空过(文案被改写也不能让断言失明) ===');
{
  const fired = new Map();
  for (const m of matrix) for (const c of m.checks) fired.set(c.name, (fired.get(c.name) || 0) + 1);
  const RULES = ['realm-kept', 'realm-drop', 'half-exp', 'exp-wiped', 'demon', 'debt', 'dao'];
  const dead = RULES.filter(r => !fired.has(r));
  t('七条规则这一轮全部至少命中过一次(没有一条是死规则)', dead.length === 0,
    `从没命中的规则:${dead.join(',')} —— 它们的断言这一轮从没跑过,等于没写。` +
    `文案一改写,规则失明,门禁会假装全绿。命中分布:${JSON.stringify([...fired])}`);
  t('每条路至少被解析出 1 条兑现承诺(没有哪条路是「什么都不承诺」)',
    matrix.every(m => m.checks.length >= 1),
    `最少的一条只有 ${Math.min(...matrix.map(m => m.checks.length))} 条`);
}

console.log('\n=== [5] 反向自检:这套尺子自己先红一遍(测的是尺子,不是产品) ===');
{
  const CONSISTENT = { expLoss: 0.5, demon: 15, title: 'rumo' };
  const COPY = '硬受一击,转身就走 不退。硬扛下来,境界没丢,只剩一半修为;入魔值 +15。';

  // ① 文案说没跌境、实现却跌境 ⇒ 必须报红(同事报的就是这个)
  const kept = checkCopy(COPY, { ...CONSISTENT, realmDamage: 1 }).find(c => c.name === 'realm-kept');
  tf('尺子能分辨:文案说「境界没丢」+ 实现带 realmDamage ⇒ 报红',
    !!kept && kept.ok === false, '喂了一个明显自相矛盾的样本,尺子居然判绿 —— 它根本没在看 realmDamage');

  // ② 方向不能反:文案说跌境、实现没跌,也要红
  const drop = checkCopy('修为尽废,跌一大境。入魔值 +8。', { expLoss: 1, demon: 8 })
    .find(c => c.name === 'realm-drop');
  tf('尺子能分辨:文案说「跌一大境」+ 实现没有 realmDamage ⇒ 报红',
    !!drop && drop.ok === false, '「跌境」这条规则是空过的 —— 实现的 realmDamage 删了它都不报');

  // ③ 数字不是摆设:入魔值 +15 对上 +20 必须红
  const dm = checkCopy('入魔值 +15。', { demon: 20 }).find(c => c.name === 'demon');
  tf('尺子能分辨:面板写 +15、实现是 +20 ⇒ 报红', !!dm && dm.ok === false,
    '入魔那条规则只比了「有没有 demon」,没比数值');

  // ④ 反过来:自洽样本必须全绿 —— 否则上面三条可能只是「永远红」
  const good = checkCopy(COPY, CONSISTENT);
  tf('尺子对自洽样本判绿(否则它只是一把永远红的假尺子)',
    good.length >= 3 && good.every(c => c.ok), `自洽样本被判红:${JSON.stringify(good.filter(c => !c.ok))}`);
}

console.log('\n=== [6] 败北出口(XX-DUEL-004)没被这几行文案改坏 ===');
{
  // ⚠️ 窗口必须从 lose() 一直取到**文件尾**:lose() 里那段 XX-DUEL-006 的长注释
  //   就有一万多字符,按固定行数/固定 2000 字符切会切在 onclick 之前,
  //   报出来的红全是假的(实测踩过:2000 字符的窗口把三条出口断言全判红)。
  //   duel.js 里 lose() 是最后一个方法,所以 slice 到尾就是它。
  const seg = DUEL.slice(loseAt);
  tf('lose() 确实是文件里最后一个方法(窗口才包得住整个败北分支)',
    seg.indexOf('onLose') > 0 && seg.indexOf('onLose') < 20000,
    `onLose 距 lose() 有 ${seg.indexOf('onLose')} 字符 —— 窗口可能没包住,先确认再判红`);
  t('点选项仍然带着 c 调 onLose(不是空壳)', /S\.cfg\.onLose\s*&&\s*S\.cfg\.onLose\(c\)/.test(seg),
    'onLose(c) 不见了 —— 点完四个选项局会卡在暂停里出不来');
  t('结算后仍然 close() 决斗层', /this\.close\(\)/.test(seg), 'close() 不见了 —— 战败面板会留在屏幕上');
  t('onLose 与 close 在同一条 onclick 路径上',
    /el\.onclick[\s\S]{0,400}S\.cfg\.onLose[\s\S]{0,200}this\.close\(\)/.test(seg),
    'onLose 与 close 不在同一条 onclick 路径上 —— 四选项点了等于没点');
}

if (SELF_FAIL.length) {
  console.log(`\n🛑 门禁自身失效:${SELF_FAIL.length} 项自检没过 —— 这轮结果不可信,不能当通过`);
  process.exit(2);
}
const total = pass + fail;
console.log(fail
  ? `\n❌ 战败四选项:红 ${fail}/${total} 项\n   ${RED.map(x => '· ' + x).join('\n   ')}`
  : `\n✅ 战败四选项通过:${total} 项(四路两两不同 · 文案与实现逐条对齐 · 败北出口完好)`);
process.exit(fail ? 1 : 0);