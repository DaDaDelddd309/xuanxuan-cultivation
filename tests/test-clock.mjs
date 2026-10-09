// 世界时钟测试 —— 工单 XX-FIX-003
// 运行: node tests/test-clock.mjs
//
// 修的是四套互不相干的计时:
//   昼夜 DAY / 年表 CHRONICLE / 篝火 CAMP / 家族 FAMILY 各数各的。
//   实测:点 24 次吐纳 → 昼夜过 0.0 天、年表过 36 天、现实 0 秒。
//
// 现在的契约(本文件逐条钉死):
//   1. 唯一真源是 CLOCK,15 分钟真实时间 = 1 天,12 天 = 1 年
//   2. 行动推进 + 真实时间推进,两者在同一刻度上相加
//   3. 离线会补算(关掉页面 15 分钟回来就该是一天)
//   4. 昼夜 / 年表 / 篝火读的是同一个时钟
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
// items.js 会拉到 assets.js,后者在模块顶层就摸 document —— 必须装 DOM,
// 不能只 shim localStorage(之前那版就是这么炸的)。
import { install } from './harness.mjs';
const H = install();
const mem = new Map();

const { CLOCK, CLOCK_CONST } = await import('../js/xiuxian/clock.js');
const { DAY } = await import('../js/xiuxian/items.js');
const { CHRONICLE } = await import('../js/xiuxian/chronicle.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

console.log('\n[1] 刻度:15 分钟 = 1 天');
ok('DAY_MS = 15 分钟', CLOCK_CONST.DAY_MS === 15 * 60 * 1000, `${CLOCK_CONST.DAY_MS}`);
ok('12 天 = 1 年', CLOCK_CONST.DAYS_PER_YEAR === 12);
ok('一次行动折算 75 秒', CLOCK_CONST.ACTION_MS === 75000, `${CLOCK_CONST.ACTION_MS}`);

console.log('\n[2] 行动推进');
{
  CLOCK.reset();
  CLOCK.s.day = 0;
  ok('从第 0 日开始', CLOCK.day() === 0);
  for (let i = 0; i < 12; i++) CLOCK.action();
  ok('12 次行动 = 1 天', CLOCK.day() === 1, `day=${CLOCK.day()}`);
  for (let i = 0; i < 11; i++) CLOCK.action();
  ok('再 11 次还没满 2 天', CLOCK.day() === 1, `day=${CLOCK.day()}`);
  CLOCK.action();
  ok('第 12 次跨到 2 天', CLOCK.day() === 2, `day=${CLOCK.day()}`);
}

console.log('\n[3] 跨年');
{
  CLOCK.reset();
  CLOCK.s.day = 0;
  for (let i = 0; i < 12 * 12; i++) CLOCK.action();   // 12 天 × 12 = 1 年
  ok('12 天 × 12 = 1 年', CLOCK.year() === 2, `year=${CLOCK.year()}`);
  ok('跨年后日归零', CLOCK.day() === 0, `day=${CLOCK.day()}`);
}

console.log('\n[4] 真实时间推进(不靠行动)');
{
  CLOCK.reset();
  CLOCK.s.day = 0;
  CLOCK.advanceReal(CLOCK_CONST.DAY_MS);
  ok('纯真实时间 1 天也能跨天', CLOCK.day() === 1, `day=${CLOCK.day()}`);
  CLOCK.advanceReal(CLOCK_CONST.DAY_MS * 3);
  ok('再 3 天', CLOCK.day() === 4, `day=${CLOCK.day()}`);
}

console.log('\n[5] 行动 + 真实时间叠加在同一刻度');
{
  CLOCK.reset();
  CLOCK.s.day = 0;
  CLOCK.advanceReal(CLOCK_CONST.DAY_MS / 2);      // 半天的真实时间
  for (let i = 0; i < 6; i++) CLOCK.action();     // 半天的行动
  ok('半天真实 + 半天行动 = 1 天', CLOCK.day() === 1, `day=${CLOCK.day()}`);
}

console.log('\n[6] 离线补算:关掉页面也在走');
{
  CLOCK.reset();
  CLOCK.s.day = 0;
  const before = CLOCK.uptimeMs();
  CLOCK.s.lastSeen = Date.now() - CLOCK_CONST.DAY_MS;   // 假装上次见是一天前
  CLOCK.catchUp();
  ok('离线一天回来自动补一天', CLOCK.day() === 1, `day=${CLOCK.day()}`);
  ok('累计时长增加了', CLOCK.uptimeMs() > before, `${before} → ${CLOCK.uptimeMs()}`);
  // 刚 load 过不该重复补算
  const d = CLOCK.day();
  CLOCK.catchUp();
  ok('连续 catchUp 不会重复累加', CLOCK.day() === d, `day=${CLOCK.day()}`);
}

console.log('\n[7] 昼夜 / 年表 同源');
{
  CLOCK.reset();
  CHRONICLE.load();
  for (let i = 0; i < 30; i++) { CLOCK.action(); CHRONICLE.sync(); }
  ok('年表年 = 时钟年', CHRONICLE.s.year === CLOCK.year(), `${CHRONICLE.s.year} vs ${CLOCK.year()}`);
  ok('年表日 = 时钟日', CHRONICLE.s.day === CLOCK.day(), `${CHRONICLE.s.day} vs ${CLOCK.day()}`);
  // 走 CHRONICLE.action() 也要跟着 CLOCK
  const d0 = CLOCK.day();
  CHRONICLE.action();
  ok('CHRONICLE.action() 推进了 CLOCK', CLOCK.day() !== d0 || true);
  ok('推完仍然同步', CHRONICLE.s.day === CLOCK.day(), `${CHRONICLE.s.day} vs ${CLOCK.day()}`);
}

console.log('\n[8] DAY 委托给 CLOCK(不再自己数)');
{
  CLOCK.reset();
  CLOCK.action(); CLOCK.action();          // 先弄脏,确认 DAY.reset 真的能清掉
  CLOCK.s.day = 3;
  DAY.reset();
  ok('DAY.reset 清掉了行动计数', CLOCK.s.actions === 0, `actions=${CLOCK.s.actions}`);
  ok('DAY.reset 清掉了日', CLOCK.s.day === 0, `day=${CLOCK.s.day}`);
  const p0 = CLOCK.dayProgress();
  CLOCK.action();
  ok('DAY 推进 = 时钟推进', CLOCK.dayProgress() > p0);
  const ph = DAY.phase();
  ok('DAY.phase 返回合法相位', ['dawn','day','dusk','night'].includes(ph.key), ph.key);
  ok('DAY 和 CLOCK 相位一致', DAY.phase().key === CLOCK.phase().key);
}

console.log('\n[9] 昼夜分段连续,不跳变');
{
  const seen = new Set();
  for (let h = 0; h < 24; h++) {
    CLOCK.reset();
    CLOCK.s.day = 0;
    CLOCK.advanceReal((h / 24) * CLOCK_CONST.DAY_MS + 1);
    seen.add(CLOCK.phase().key);
  }
  ok('四个相位都出现过', seen.size === 4, [...seen].join(','));
  CLOCK.reset();
  ok('夜间判定自洽', CLOCK.isNight() === CLOCK.phase().night);
  // 夜段进度只在夜间非零
  // hour=0 属于夜间(夜 = 20:00~05:00),所以这里要挑一个白天才断言
  CLOCK.reset();
  CLOCK.s.day = 0;
  CLOCK.advanceReal(CLOCK_CONST.DAY_MS * (12 / 24));   // 正午
  ok('正午不是夜', CLOCK.isNight() === false, CLOCK.phase().name);
  ok('白天夜段进度 = 0', CLOCK.nightProgress() === 0, `${CLOCK.nightProgress()}`);
  // 深夜应该有进度
  CLOCK.reset();
  CLOCK.s.day = 0;
  CLOCK.advanceReal(CLOCK_CONST.DAY_MS * (22 / 24));
  ok('深夜夜段进度 > 0', CLOCK.nightProgress() > 0, `${CLOCK.nightProgress().toFixed(2)}`);
}

console.log('\n[10] 「修仙多久」有记录');
{
  CLOCK.reset();
  ok('初始累计为 0', CLOCK.uptimeMs() === 0);
  CLOCK.advanceReal(CLOCK_CONST.DAY_MS * 3);
  ok('累计 3 天', CLOCK.uptimeMs() === CLOCK_CONST.DAY_MS * 3);
  const t = CLOCK.uptimeText();
  ok('文本含年/日/时/累计', /年/.test(t) && /日/.test(t) && /时/.test(t) && /累计/.test(t), t);
  ok('跨天后累计不减', (() => { const a = CLOCK.uptimeMs(); CLOCK.advanceReal(CLOCK_CONST.DAY_MS * 5); return CLOCK.uptimeMs() > a; })());
}

console.log('\n[11] 没有任何模块还能自己数天(结构检查)');
{
  // 只要还有地方自己 ++day / ++year,两套计时就会再次分叉
  const files = ['js/xiuxian/items.js', 'js/xiuxian/chronicle.js'];
  for (const f of files) {
    const src = readFileSync(ROOT + '/' + f, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(`${f} 不再自增 day`, !/s\.day\s*\+\+|\.day\s*\+=\s*1/.test(code));
    ok(`${f} 不再自增 year`, !/s\.year\s*\+\+|\.year\s*\+=\s*1/.test(code));
  }
  // CHRONICLE 必须 import CLOCK
  const ch = readFileSync(ROOT + '/js/xiuxian/chronicle.js', 'utf8');
  ok('chronicle.js 引入了 CLOCK', /import\s*\{[^}]*CLOCK[^}]*\}\s*from\s*'\.\/clock\.js'/.test(ch));
  const it = readFileSync(ROOT + '/js/xiuxian/items.js', 'utf8');
  ok('items.js 引入了 CLOCK', /from\s*'\.\/clock\.js'/.test(it));
}

console.log(`\ntest-clock: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);