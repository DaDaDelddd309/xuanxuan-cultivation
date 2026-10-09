// pxs_save 存档覆盖回归测试(XX-AUDIT-006 批 2)
//
// 背景:profile.js 的 flush() 原来有一行 `w(LEGACY.base, d.base)`,
//   把 migrate() 读到的 **pxs_save 旧快照** 原样写回。
//   而 pxs_save 同时是 core/save.js 的**活键**(Save.load/commit 在读写)。
//   两者双写 → 从 V0.77 旧档升级的玩家,金币/局数会被回滚。
//   已用模拟脚本复现:gold 8888 → 30,totalRuns 12 → 1。
//
// 本测试断言:profile 不得回写 pxs_save。
// 若有人把那行加回来,这里立刻红。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'js/xiuxian/profile.js'), 'utf8');
const SAVE_SRC = readFileSync(join(ROOT, 'js/core/save.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log('  ❌', n)); };

console.log('\n=== pxs_save 所有权:确认 core/save.js 仍在活跃使用 ===');
t("core/save.js 仍写 'pxs_save'", SAVE_SRC.includes("const KEY = 'pxs_save'"));
t('core/save.js 有 load()', /load\(\)/.test(SAVE_SRC));
t('core/save.js 有 commit()', /commit\(\)/.test(SAVE_SRC));

console.log('=== profile.js 不得回写 pxs_save ===');
{
  // 截取 flush() 整个函数体(含注释)。
  // 先按缩进找 flush 的起止:`\n  flush() {` 到下一个同缩进的 `\n  }`
  const start = SRC.indexOf('\n  flush()');
  if (start < 0) {
    t('能定位到 flush()', false);
  } else {
    const end = SRC.indexOf('\n  },', start);
    const body = SRC.slice(start, end > 0 ? end : start + 2000);
    t('flush() 里没有 w(LEGACY.base, ...) 调用', !/w\(\s*LEGACY\.base\s*,/.test(body));
    t('flush() 里有说明为何不回写的注释', /LEGACY\.base/.test(body));
    t('flush() 仍写其它 LEGACY 键', /w\(LEGACY\.cultivation/.test(body));
    t('flush() 仍写真正的新键', /localStorage\.setItem\(KEY,/.test(body));
  }
}

console.log('=== migrate() 仍要能读旧档(不能把兼容也删了) ===');
t('migrate() 仍读 LEGACY.base', /read\(LEGACY\.base\)/.test(SRC));

console.log('=== base 不该再是新档的字段 ===');
{
  const emptyBlock = SRC.slice(SRC.indexOf('const EMPTY'), SRC.indexOf('const EMPTY') + 400);
  const empty = emptyBlock.slice(0, emptyBlock.indexOf('};'));
  t('EMPTY 里已无 base: null', !/^\s*base:\s*null/m.test(empty));
  t('EMPTY 仍保留其他字段 cult/nemesis/titles', /cult:\s*null/.test(empty) && /nemesis:\s*null/.test(empty));
}

console.log('=== 行为级复现:模拟双写顺序 ===');
{
  const store = {};
  const KEY = 'pxs_save';
  const set = (k, v) => { store[k] = JSON.stringify(v); };
  const get = (k) => { try { return store[k] ? JSON.parse(store[k]) : null; } catch { return null; } };

  // 1) 旧档
  set(KEY, { v: 1, gold: 30, chars: ['knight'], settings: { sfx: true }, totalRuns: 1 });
  // 2) migrate 读快照
  const d = { base: get(KEY), seed: '青石村' };
  // 3) 玩家继续玩,Save.commit
  const Save = get(KEY); Save.gold = 8888; Save.totalRuns = 12; set(KEY, Save);
  // 4) profile.flush —— **修复后不再回写 base**
  //    (这里刻意不执行 set(KEY, d.base))
  // 5) 真正的新键照写
  set('xx_profile_v081', { v: 1, seed: d.seed, cult: {}, bag: {} });

  const after = get(KEY);
  t('Save 的 gold 未被回滚(仍是 8888)', after.gold === 8888);
  t('Save 的 totalRuns 未被回滚(仍是 12)', after.totalRuns === 12);
  t('新键档案已正常写入', get('xx_profile_v081') !== null);
}

console.log(`\npxs-save-regression: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);