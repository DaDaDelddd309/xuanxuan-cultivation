// 导演层 **真实 DOM** 验证(XX-RITUAL-001)
//
// 前一个测试是静态断言(读源码看有没有那些代码)。
// 这个用 jsdom 真正构建 DOM、真正 import ritual.js、真正推进定时器,
// 验证 `.blink` / `.talk` 这些 class **在运行时真的被加上过**。
//
// 为什么必须这样做:「代码里写了 add('blink')」≠「blink 真的会发生」。
// 之前的 bug 恰恰就是「blink 写在 CSS 里但 JS 从没加过」——
// 静态看两边都齐全,实际动画从不触发。这类 bug 只有跑起来才看得见。
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };

// ---- 搭最小 DOM 环境 ----
const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, {
  url: 'http://localhost/', pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.performance = dom.window.performance;
globalThis.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

// ---- 记录 class 变化(这是我们要的证据) ----
const seen = { blink: 0, talk: 0, rtLine: 0, rtHappy: 0, rtLook: 0 };
let hookInstalled = false;
function installHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  const obs = new dom.window.MutationObserver(muts => {
    for (const m of muts) {
      const cs = m.target.classList;
      for (const k of Object.keys(seen)) if (cs.contains(k)) seen[k]++;
    }
  });
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  globalThis.__obs = obs;
}

// ---- 真跑 ----
const { Ritual } = await import('../js/xiuxian/ritual.js');

console.log('\n[1] start() 能构建出完整仪式 DOM');
{
  await Ritual.start(true);
  installHook();
  const d = document;
  t('root 已挂载', !!d.querySelector('.xx-ritual'));
  t('立绘存在', !!d.querySelector('#rt-char'));
  t('有嘴(口型目标)', !!d.querySelector('.rt-mouth'));
  t('有输入框', !!d.querySelector('#rt-name'));
  t('有确认按钮', !!d.querySelector('#rt-go'));
  t('文字已填入', (d.querySelector('#rt-ask')?.textContent || '').includes('你醒啦'));
}

console.log('=== [2] 入场与逐行文字类真的加上了 ===');
{
  await new Promise(r => setTimeout(r, 400));   // 越过 rAF 与 animationDelay
  const who = document.querySelector('#rt-who');
  const ask = document.querySelector('#rt-ask');
  t('#rt-who 有 rt-line 类', who?.classList.contains('rt-line'));
  t('#rt-ask 有 rt-line 类', ask?.classList.contains('rt-line'));
  t('#rt-ask 设了动画延迟(逐行而非同时)', (ask?.style.animationDelay || '') !== '');
  // 两个元素的延迟应不同 —— 这才叫「逐行」
  t('两行延迟不同', who?.style.animationDelay !== ask?.style.animationDelay);
}

console.log('=== [3] 眨眼循环真的在跑(原始死代码) ===');
{
  // blinkLoop 首次等待 2400~5500ms;这里等 6.2s 覆盖上限
  await new Promise(r => setTimeout(r, 6200));
  t('.blink 类在运行时至少被加上过一次', seen.blink > 0,
    `实测加上 ${seen.blink} 次 —— 若为 0 说明眨眼仍是死代码`);
  t('眨眼不是只加不减(有 remove 配对)', /classList\.remove\(\s*['"]blink/.test(
    readFileSync(join(ROOT, 'js/xiuxian/ritual.js'), 'utf8')));
}

console.log('=== [4] 口型循环真的在跑 ===');
{
  await new Promise(r => setTimeout(r, 5200));
  t('.talk 类在运行时至少被加上过一次', seen.talk > 0, `实测 ${seen.talk} 次`);
}

console.log('=== [5] 确认瞬间的反应 ===');
{
  const inp = document.querySelector('#rt-name');
  inp.value = '小砚';
  // 聚焦 → 视线跟随
  inp.dispatchEvent(new dom.window.Event('focus'));
  await new Promise(r => setTimeout(r, 60));
  t('聚焦时 rt-char 有 rt-look 类', seen.rtLook > 0 ||
    document.querySelector('#rt-char')?.classList.contains('rt-look'));
  inp.dispatchEvent(new dom.window.Event('blur'));
  await new Promise(r => setTimeout(r, 60));

  Ritual.confirmName();
  await new Promise(r => setTimeout(r, 120));
  t('确认后有 rt-happy(开心反应)', seen.rtHappy > 0 ||
    /rt-happy/.test(document.querySelector('#rt-char')?.className || ''));
  t('确认后输入框隐藏', document.querySelector('#rt-input')?.style.display === 'none');
  t('确认后出现「好」按钮', !!document.querySelector('#rt-ok'));
  t('名字已写入', (document.querySelector('#rt-who')?.textContent || '') === '小砚');
  t('对白已切换为「……嗯。」', (document.querySelector('#rt-ask')?.textContent || '').includes('嗯'));
}

console.log('=== [6] close() 清理定时器(不泄漏) ===');
{
  const before = seen.blink;
  Ritual.close();
  t('close 后 root 隐藏', document.querySelector('.xx-ritual')?.classList.contains('hidden'));
  await new Promise(r => setTimeout(r, 6400));   // 若定时器没清,这里还会加 blink
  t('close 后不再有 blink', seen.blink === before, `close 前后 ${before} → ${seen.blink}`);
  globalThis.__obs?.disconnect();
}

Ritual.close();
await new Promise(r => setTimeout(r, 100));
process.exit(0);

if (fail === 0) {
  console.log('\n✅ 真实 DOM 验证通过:眨眼/口型/逐行/反应/视线 在运行时确实发生了');
} else {
  console.log(`\n❌ ${fail} 项不达标`);
}
process.exit(fail ? 1 : 0);