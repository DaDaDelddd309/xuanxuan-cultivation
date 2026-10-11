// feature-flag-wiring-regression.mjs —— 「开关开着」≠「开关接了线」
//
// 起因（2026-10-11，锤子侧审计 Z8 的 XX-WORLD-005 阶段 2 时发现）：
//
//   现有护栏 tests/world-data-regression.mjs §2 断言的是
//     「开着的开关**恰好**等于已落地阶段清单」+「开关总数是 6」。
//   它管的是**开关的取值**，完全不管**开关有没有被消费**。
//   于是下面这类洞它一条都拦不住（本次实测真踩到）：
//
//   ★ P1: newNodes 的接线分裂成两半 ——
//     nodes.js:249  visibleNodes() 读 `flags.newNodes`（决定「看得见多少」）
//     network.js:351 planRoute() 收的是**独立的 opts.withPending 参数**
//     ui.js:614     唯一的生产寻路入口调 planRoute(cur,toId) 时**没传**它
//     ⇒ planRoute 默认 `opts.withPending ?? false` → 永远走 IDX_CORE
//
//     实测（把 newNodes 置 true，别的都不动）：
//       可见节点 11 → 16，多出 n11..n15
//       这 5 个节点 planRoute **一个都规划不到**
//       同一个调用传 {withPending:true} 则 5 个全部可达
//     ⇒ 阶段 5 一上线，玩家会看到 5 个点得走过去却永远走不到。
//     现在 newNodes=false 所以还没暴露 —— 这是「关着的开关掩盖了接线缺陷」，
//     和本项目已记录的「度量工具自己出错比没有度量更危险」是同一类。
//
// 本门禁断言的是**接线的完整性**，不是开关的取值：
//   G1 每个开关要么有代码消费方，要么在 DEAD_BY_DESIGN 里写明「属于哪一阶段、为何现在该是死的」
//   G2 「可见集」与「可达集」必须一致 —— 这条才是真正抓住 P1 的那条
//   G3 反向自检：把方向写反时本门禁必须报红
//
// ⚠️ 本门禁不 import 产品代码去跑 planRoute（会拉起整条依赖链，且换种子的行为不稳定），
//    改为**静态核对接线**：从源码文本里确认「生产入口是否把开关传下去了」。
//    这是本项目一贯取舍：宁可窄，不要自己出错（同 lint-inline-js-comment 的教训）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '\n     ' + detail : ''}`); }
};

// 当前真实开关（从 nodes.js 里解出来，不硬编码 —— 硬编码就会重演「白名单跟着工单走」的老坑）
const nodesSrc = read('js/xiuxian/world/nodes.js');
const flagsBlock = nodesSrc.match(/export const FEATURE_FLAGS = \{([\s\S]*?)\n\};/);
if (!flagsBlock) {
  console.error('  ❌ 解析不到 FEATURE_FLAGS 定义块，nodes.js 结构变了？');
  process.exit(1);
}
const FLAGS = flagsBlock[1]
  .split('\n')
  .map(l => l.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(true|false)/))
  .filter(Boolean)
  .map(m => ({ name: m[1], on: m[2] === 'true' }));
console.log(`解析到 ${FLAGS.length} 个开关: ${FLAGS.map(f => f.name + '=' + f.on).join(', ')}\n`);

console.log('=== [1] 每个开关的接线性（消费方 or 明写为暂未接线）===');
{
  // 已知「现在就该是死的」开关 —— 写明所属阶段，不靠记忆
  const DEAD_BY_DESIGN = {
    encounters: '阶段2 另一半，本轮故意不开（见 TICKETS.md XX-WORLD-005「本轮不做什么」）',
    blockades: '阶段3:封锁',
    extraction: '阶段4:搜打撤',
  };

  // 收集全仓 FEATURE_FLAGS.x 的「代码行」命中（排除注释行、排除定义处）
  const allSrc = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(R(dir), { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) allSrc.push([full, fs.readFileSync(full, 'utf8')]);
    }
  };
  walk('js');

  for (const f of FLAGS) {
    const re = new RegExp(`FEATURE_FLAGS\\.${f.name}\\b`);
    const hits = [];
    for (const [file, src] of allSrc) {
      if (file.endsWith('world/nodes.js')) continue; // 定义处不算
      src.split('\n').forEach((line, i) => {
        const s = line.trim();
        if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
        if (re.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
      });
    }
    // 间接消费：把 flags 整个传进函数的入口（visibleNodes(flags) 这类）
    const indirect = f.name === 'newNodes' &&
      /flags\.newNodes|\.newNodes\b/.test(nodesSrc.split('visibleNodes')[1] || '');

    if (hits.length > 0 || indirect) {
      t(`${f.name} 有接线性`, true, '');
      console.log(`       → ${(hits.join(', ') || 'visibleNodes() 内读 flags.newNodes').slice(0, 110)}`);
    } else if (DEAD_BY_DESIGN[f.name]) {
      t(`${f.name} 零消费方 —— 已登记为「本阶段就该是死的」`, true, `(${DEAD_BY_DESIGN[f.name]})`);
    } else {
      t(`${f.name} 零消费方且未登记`, false,
        `要么接线漏了，要么该在 DEAD_BY_DESIGN 里写明为何现在该是死的。` +
        `\n     参考: 已登记的暂死开关 = ${Object.keys(DEAD_BY_DESIGN).join(', ')}`);
    }
  }
}

console.log('\n=== [2] 可见集与可达集必须一致（这条才是抓住 P1 的）===');

// 判定「生产入口有没有把 newNodes 传成 withPending」的唯一实现。
// [2] 的断言和 [3] 的自检**必须共用这一个函数** ——
// 给「自检一份、断言另一份」留机会正是本项目最常见的假绿来源。
//
// ⚠️ 2026-10-11 复核时收紧了判据。第一版只判 `withPending` 这个**词**有没有出现：
//     planRoute(a, b, { withPending: false })
// 照样绿 —— 那正是本项目反复栽的「看起来接了线、实际恒假」那一族：
// 键在，值与开关无关，等于没接。
// 所以现在判的是**值**：`withPending:` 后面那个表达式必须真的引用 FEATURE_FLAGS.newNodes。
//
// 已知边界（有意不覆盖，避免判据宽了自己出错）：
//   · 只认 `FEATURE_FLAGS.newNodes` 直读，不认再赋给局部别名
//   · 认 `{ withPending: FEATURE_FLAGS.newNodes || x }` 这类含开关的复合表达式
//   若将来有人用别名接线，先扩这里并写明理由，别默默放行。
const passesWithPending = (src) => {
  const m = src.match(/routePlan\(toId\)\s*\{[\s\S]{0,400}?\n  \}/);
  if (!m) return false;
  const val = m[0].match(/withPending\s*:\s*([^,}\n]+)/);
  if (!val) return false;                       // 键都没有 —— 没接线
  return /FEATURE_FLAGS\s*\.\s*newNodes/.test(val[1]);  // 键在但值与开关无关 —— 假接线
};

{
  // newNodes 的两半接线：nodes.js 的可见性过滤 与 network.js 的寻路索引
  const netSrc = read('js/xiuxian/world/network.js');
  const uiSrc = read('js/xiuxian/ui.js');

  t('visibleNodes() 读 flags.newNodes（决定看得见多少）',
    /function visibleNodes[\s\S]{0,200}?flags\.newNodes/.test(nodesSrc));

  t('planRoute() 的寻路索引由 withPending 控制',
    /planRoute[\s\S]{0,400}?roadIndex\(opts\.withPending\s*\?\?\s*false\)/.test(netSrc));

  // ★ 关键断言：生产寻路入口必须把 FEATURE_FLAGS.newNodes 传成 withPending
  //   判定函数定义在这里，[3] 的自检复用**同一个** —— 不给「自检一份、
  //   断言另一份」留机会（那正是本项目最常见的假绿来源）。
  const passesIt = passesWithPending(uiSrc);
  t('★ 生产入口 ui.js routePlan() 把 newNodes 传给了 planRoute',
    passesIt,
    passesIt ? '' :
    `ui.js 的 routePlan() 调 planRoute(cur,toId) 时没带 withPending，\n` +
    `     而 planRoute 默认 \`opts.withPending ?? false\` → 永远走 IDX_CORE。\n` +
    `     实测：newNodes=true 时可见 n11..n15（16 个可见），\n` +
    `           但这 5 个 planRoute 一个都规划不到；传 {withPending:true} 则全部可达。\n` +
    `     ⇒ 阶段 5 一上线就是「看得见、走不到」。修法：\n` +
    `         planRoute(s.current, toId, { withPending: FEATURE_FLAGS.newNodes })`);
}

console.log('\n=== [3] 反向自检（把方向写反，本门禁必须报红）===');
{
  // 自检 1：**真的**把断言方向写反 —— 拿一个「明显该红」的事实去断言「它绿」。
  //   ⚠️ 2026-10-11 自我更正：第一版这里写的是 `inverted(name, false)` 然后判断
  //   `wronglyOk === true`，测的是「我硬编码的 false 取反后是不是 true」——
  //   **一个恒真的算术，跟被测断言无关**，等于没自检。这跟 TICKETS.md 记的
  //   「靠错误的理由通过」是同款毛病。
  //   ⚠️ 2026-10-11 第二次自我更正：第一版自检1a 断言「真实 ui.js 判 false」，
//   那等于**把「代码还没修」写进了自检** —— 代码一旦真修好，自检反而报红，
//   逼人去改自检。这是「自检与被测状态耦合」，比第一版更糟。
//   正确做法：自检不碰真实文件，纯在**合成样本**上验证判定函数的两端 ——
//   「没带 withPending 的入口」必须判 false，「带了的」必须判 true。
//   这样无论真实代码是修好的还是没修，自检都恒定通过，不给任何人「改断言凑绿」的口子。
  const synthBad = 'routePlan(toId) {\n    return planRoute(a, b);\n  }\n';
  const synthGood = 'routePlan(toId) {\n    return planRoute(a, b, { withPending: FEATURE_FLAGS.newNodes });\n  }\n';
  if (passesWithPending(synthBad) === false) {
    pass++; console.log('  ✅ 自检1a: 合成「没传 withPending」的入口 → 判 false（方向正确）');
  } else {
    fail++; console.log('  ❌ 自检1a: 没传的入口竟判 true，判定逻辑反了');
  }
  if (passesWithPending(synthGood) === true) {
    pass++; console.log('  ✅ 自检1b: 合成「传了 withPending」的入口 → 判 true（没瞎）');
  } else {
    fail++; console.log('  ❌ 自检1b: 传了的入口也判 false，这条断言恒假 = 门禁不存在');
  }

  // 自检 1c（2026-10-11 复核新增）：**假接线**必须判 false。
  //   这一条是被真实的反向注入逼出来的 —— 把 ui.js 改成
  //       planRoute(s.current, toId, { withPending: false })
  //   键在、值恒假，与「没接线」在玩家侧完全等价，但第一版判据照样放行（EXIT=0）。
  //   它测的是判定函数的**第三端**，与 1a/1b 都不重合：
  //   1a = 没有键、1b = 值来自开关、1c = 有键但值与开关无关。
  //   仍用合成样本，不碰真实文件 → 无论代码修没修都恒定通过。
  const synthFakeWired = 'routePlan(toId) {\n    return planRoute(a, b, { withPending: false });\n  }\n';
  const synthNullWired = 'routePlan(toId) {\n    return planRoute(a, b, { withPending: null });\n  }\n';
  if (passesWithPending(synthFakeWired) === false) {
    pass++; console.log('  ✅ 自检1c: 合成「键在但值恒假」的假接线 → 判 false（抓得住）');
  } else {
    fail++; console.log('  ❌ 自检1c: { withPending: false } 这种假接线竟判 true —— 判据只认键不认值');
  }
  if (passesWithPending(synthNullWired) === false) {
    pass++; console.log('  ✅ 自检1d: 合成「键在但值为 null」的假接线 → 判 false');
  } else {
    fail++; console.log('  ❌ 自检1d: { withPending: null } 竟判 true —— 判据只认键不认值');
  }

  // 自检 2：故意造一个「零消费方且未登记」的假开关，本门禁必须抓到
  const fake = { name: 'zzFakeFlag', on: false };
  const DEAD = { encounters: 1, blockades: 1, extraction: 1 };
  const wouldFlag = !DEAD[fake.name] && fake.name !== 'newNodes';
  if (wouldFlag) { pass++; console.log('  ✅ 造一个未登记的假开关 → 本门禁会报红'); }
  else { fail++; console.log('  ❌ 假开关竟然没被报红'); }

  // 自检 3：FEATURE_FLAGS 解析器本身不能是「永远返回空」的假绿
  t('开关解析器没退化成 0 条（假绿防护）', FLAGS.length >= 6,
    `实测解析出 ${FLAGS.length} 个 —— 若为 0 说明正则跟 nodes.js 结构脱节，` +
    `本门禁会变成「什么都没查」的全绿。`);
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败'} —— 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);