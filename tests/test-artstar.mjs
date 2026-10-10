// 功法升星测试 —— 工单 XX-META-004
// 运行: node tests/test-artstar.mjs
//
// owner:「金币还可以给功法升级、升⭐之类的,增加特效」
import { install } from './harness.mjs';
install();
const { ARTSTAR, STAR_NOTES_ALL } = await import('../js/xiuxian/artstar.js');
const { ARTS } = await import('../js/xiuxian/arts.js');
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
// 稳定的付费桩,不依赖全局
const payGold = (n) => { wallet.gold -= n; return wallet.gold >= 0 ? (wallet.gold += 0, true) : (wallet.gold += n, false); };
let wallet = { gold: 0 };
const mkPay = () => {
  const w = { gold: 0 };
  return { w, gold: n => { if (w.gold < n) return false; w.gold -= n; return true; },
           books: n => true };
};

console.log('\n[1] 升星消耗递增,星越高越贵');
{
  ARTSTAR.load(); ARTSTAR.reset();
  const meta = Object.assign({ base: 100 }, ARTS.jianqi);
  const p = mkPay(); p.w.gold = 99999;
  let last = 0, rising = true, seqOk = true, costLog = [];
  // 必须**真的升星**,cost() 永远返回「下一星」,不调 up() 是原地打转
  for (let i = 1; i <= (ARTS.jianqi.max || 5); i++) {
    const c = ARTSTAR.cost('jianqi', meta);
    if (!c) { seqOk = false; break; }
    if (c.star !== i) { seqOk = false; break; }
    costLog.push(c.gold);
    if (c.gold <= last) rising = false;
    last = c.gold;
    ARTSTAR.up('jianqi', meta, p.gold, p.books);
  }
  ok('逐星序号连续', seqOk, costLog.join(' → '));
  ok('消耗逐星递增', rising, costLog.join(' → '));
  ok('有星数上限(升满后 cost 为 null)', ARTSTAR.cost('jianqi', meta) === null);
}

console.log('\n[2] 满星后不能再升');
{
  ARTSTAR.load(); ARTSTAR.reset();
  const meta = Object.assign({ base: 50 }, ARTS.jianqi);
  const p = mkPay(); p.w.gold = 999999;
  for (let i = 0; i < 20; i++) {
    const r = ARTSTAR.up('jianqi', meta, p.gold, p.books);
    if (!r.ok) break;
  }
  ok('星数封顶', ARTSTAR.stars('jianqi') <= (ARTS.jianqi.max || 5), `${ARTSTAR.stars('jianqi')}`);
  ok('满星提示清楚', /满星/.test(ARTSTAR.canUp('jianqi', meta).msg));
}

console.log('\n[3] 钱/材料不够升不了,且不会白扣');
{
  ARTSTAR.load(); ARTSTAR.reset();
  const meta = Object.assign({ base: 100 }, ARTS.jianqi);
  // 钱不够
  const p1 = mkPay(); p1.w.gold = 0;
  const r1 = ARTSTAR.up('jianqi', meta, p1.gold, p1.books);
  ok('钱不够 → 拒绝', r1.ok === false, r1.msg);
  ok('没升星', ARTSTAR.stars('jianqi') === 0);
  // 书不够
  const p2 = mkPay(); p2.w.gold = 99999;
  const r2 = ARTSTAR.up('jianqi', meta, p2.gold, () => false);
  ok('书不够 → 拒绝', r2.ok === false, r2.msg);
  ok('没升星', ARTSTAR.stars('jianqi') === 0);
  ok('钱没被扣(书先判)', p2.w.gold === 99999, `${p2.w.gold}`);
}

console.log('\n[4] 每星有实质变化(不是纯数值乘区)');
{
  const arts = ['jianqi', 'yufeng', 'guanri'];
  let hasNotes = 0;
  for (const a of arts) {
    const notes = STAR_NOTES_ALL[a];
    if (notes && Object.keys(notes).length >= 3) hasNotes++;
  }
  ok('主要神通都写了每星效果文案', hasNotes >= 2, `${hasNotes}/${arts.length}`);
  // 效果描述必须是"能想象的东西",不是纯数字
  const allNotes = Object.values(STAR_NOTES_ALL).flatMap(o => Object.values(o));
  ok('文案不是纯数字', allNotes.some(t => /[一-龥]/.test(t) && !/^\+?\d+%?$/.test(t)));
}

console.log('\n[5] 效果倍率随星数走');
{
  ARTSTAR.load(); ARTSTAR.reset();
  ok('0 星无效果', ARTSTAR.effect('jianqi') === null);
  const meta = Object.assign({ base: 10 }, ARTS.jianqi);
  const p = mkPay(); p.w.gold = 999999;
  ARTSTAR.up('jianqi', meta, p.gold, p.books);
  const e1 = ARTSTAR.effect('jianqi');
  ok('1 星有效果', !!e1 && e1.star === 1);
  ok('3 星起多一次', e1.extra === 0);
  for (let i = 0; i < 3; i++) ARTSTAR.up('jianqi', meta, p.gold, p.books);
  const e3 = ARTSTAR.effect('jianqi');
  ok('4 星多出额外效果', e3.extra === 1, `star=${e3.star}`);
  ok('威力随星数递增', e3.power > e1.power, `${e1.power} → ${e3.power}`);
}

console.log('\n[6] 存档往返');
{
  ARTSTAR.load(); ARTSTAR.reset();
  const meta = Object.assign({ base: 10 }, ARTS.yufeng);
  const p = mkPay(); p.w.gold = 99999;
  ARTSTAR.up('yufeng', meta, p.gold, p.books);
  ARTSTAR.up('yufeng', meta, p.gold, p.books);
  ARTSTAR.save();
  ARTSTAR.load();
  ok('星数还在', ARTSTAR.stars('yufeng') === 2, `${ARTSTAR.stars('yufeng')}`);
}

console.log('\n[7] 升星入口已接进界面');
{
  // ⚠️ XX-AUDIT-005:三个锚点会随拆分分散到不同文件 ——
  // import 可能落到 ui/artstar.js,`case 'art-star'` 在 act(),星数模板在 vArts()。
  // 原来只读 ui.js 一整块,拆完就是"代码不在那儿了",而报错信息会指向
  // 「升星入口没接进界面」—— 让人去修本来正确的逻辑。分别定位到方法体。
  const { blob, methodBody } = await import('./lib-uimod.mjs');
  const ui = blob();
  ok('UI 层引入了 ARTSTAR', /from '\.\.\/artstar\.js'/.test(ui) || /from '\.\/artstar\.js'/.test(ui));
  ok('act() 里有 art-star 动作', /case 'art-star'/.test(methodBody('act')));
  ok('vArts() 卡片上显示星数', /'★'\.repeat\(star\)|★'\.repeat\(star\)|repeat\(star\)/.test(methodBody('vArts')));
  const css = readFileSync(ROOT + '/css/xiuxian.css', 'utf8');
  ok('有星星样式', /\.xx-art .xx-tag\.star/.test(css));
  ok('有升星按钮样式', /\.xx-art-up/.test(css));
}

console.log('\n[8] 有上限:不会无限升');
{
  ARTSTAR.load(); ARTSTAR.reset();
  const max = ARTS.jianqi.max || 5;
  ok('神通自带 max', max >= 2 && max <= 9, `${max}`);
  ok('升星不会超过 max', ARTSTAR.stars('jianqi') <= max);
}

console.log(`\ntest-artstar: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);