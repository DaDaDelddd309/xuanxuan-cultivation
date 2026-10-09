// bindTap 防连点回归测试(XX-AUDIT-017)
//
// 2026-10-10 改名:原名 bindtap-regression.mjs —— 它既不匹配 run-all.sh 的
// `test-*.mjs` / `e2e-*.mjs` glob,也不在任何 npm script 里,
// 于是**文件存在却从来没被执行过**(孤儿检测只报警不红,因为它被 package.json
// 的 grep 规则跳过了)。测试不在基线里跑,和不存在是一回事。
//
// 背景:外部审计发现 `js/ui/screens.js` 的防连点状态是**模块级单例**
//   `let _lastTap`,被全站 10 处 bindTap 共享。
//   后果:在任何按钮点了之后的 300ms 内点**另一个**按钮,会被静默吞掉。
//   玩家实际遇到的症状就是「点了没反应」——
//   典型路径:点「砍杀」→ 结算层弹出 → 手快点「进入无尽」,落在 300ms 窗口内。
//
// 本测试断言:不同按钮之间**不应**互相影响。
// 若有人把 _lastTapByEl 改回模块级单例,这里会立刻红。
globalThis.document = {
  addEventListener(){}, createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),
  body:{appendChild(){}}, getElementById:()=>null,
};
globalThis.window = {};
globalThis.Audio = function(){ this.play=()=>Promise.resolve(); this.pause=()=>{}; };

// 只加载 screens.js 会拉进半个 UI 树,这里直接抠出 bindTap 的语义来测:
// 用同一份源码逻辑复刻两种实现,对比行为差异。
const SRC = (await import('fs')).readFileSync(
  new URL('../js/ui/screens.js', import.meta.url), 'utf8');

// 断言源码里已无模块级 _lastTap
const hasGlobalTap = /^let _lastTap = /m.test(SRC);
const hasWeakMap = /const _lastTapByEl = new WeakMap\(\)/.test(SRC);

// 两种实现,喂同一组点击序列
function makeImpl(kind) {
  let globalTap = -1e9;
  const map = new WeakMap();
  return (el, fn) => {
    el.onclick = () => {
      const now = el._now;
      if (kind === 'global') {
        if (now - globalTap < 300) return false;   // 静默吞掉
        globalTap = now;
      } else {
        const last = map.get(el) ?? -1e9;
        if (now - last < 300) return false;
        map.set(el, now);
      }
      fn();
      return true;
    };
  };
}

const mkEl = () => ({ _now: 0, onclick: null, fired: 0 });
const bind = makeImpl('per-el');

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log('  ❌', n)); };

console.log('\n=== 源码形态 ===');
t('已无模块级 `let _lastTap =`', !hasGlobalTap);
t('改用 WeakMap 按元素记录', hasWeakMap);

console.log('=== 不同按钮不应互相吞 ===');
{
  const a = mkEl(), b = mkEl();
  let aFired = 0, bFired = 0;
  bind(a, () => aFired++);
  bind(b, () => bFired++);

  a._now = 1000;
  a.onclick();                       // 点 A
  b._now = 1100;                     // 100ms 后点 B(在 300ms 窗口内)
  b.onclick();

  t('A 首次点击生效', aFired === 1);
  t('B 紧跟 A 点击**也**生效(旧实现会静默吞掉)', bFired === 1);
}

console.log('=== 同按钮连点仍应被防抖 ===');
{
  const a = mkEl();
  let fired = 0;
  bind(a, () => fired++);
  a._now = 1000; a.onclick();
  a._now = 1100; a.onclick();         // 100ms 内重复点同一按钮
  a._now = 1500; a.onclick();         // 500ms 后再点
  t('连点被防抖(2 次生效而非 3 次)', fired === 2);
}

console.log('=== 回归对照:旧实现确实会吞 ===');
{
  const bindOld = makeImpl('global');
  const a = mkEl(), b = mkEl();
  let bFired = 0;
  bindOld(a, () => {});
  bindOld(b, () => bFired++);
  a._now = 1000; a.onclick();
  b._now = 1100; b.onclick();
  t('旧实现(模块级单例)下 B 被吞 —— 证明该测试真的有区分力', bFired === 0);
}

console.log(`\nbindtap-regression: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);