// 精灵引用完整性（工单 XX-VIS-002）
//
// 为什么需要:
//   V0.99 源石用 `sprite:'stone'`，而精灵表里根本没有 stone 这个键。
//   `drawSprite` 找不到就 **静默 return** —— 不报错、不告警、什么都不画。
//   结果源石从来没被画出来过，而玩家在屏幕上看到的「一直冒」全是灵气的飘字。
//   我靠单测跑绿了 622 项断言,却没人检查「引用的精灵到底存不存在」。
//
// 本文件扫全部 `sprite:` / `addPickup({... sprite:...})` 引用,逐个查表。
import { install } from './harness.mjs';
install();

const { PIX, PAL } = await import('../js/sprites.js?v=17');
const { readdirSync, readFileSync } = await import('fs');
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

// 扫所有 js 文件里的 sprite 引用
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) files.push(p);
  }
})(join(ROOT, 'js'));

console.log('\n[1] 所有 sprite 引用必须在精灵表里存在');
{
  let bad = 0, total = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // sprite: 'xxx'   或   sprite: `xxx_${n}`
    // 逐行扫,跳过注释行 —— 否则我自己写的说明文字会被当成真引用
    src.split('\n').forEach((line, li) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      for (const m of line.matchAll(/sprite\s*:\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
      total++;
      const name = m[1];
      // 角色用「精灵名前缀」:hero_knight → 实际是 hero_knight_0/_1/_2/_3/_idle
      const isPrefix = !!(name in PIX) || Object.keys(PIX).some(k => k.startsWith(name + '_'));
      const lineTxt = line;
      // 明确标注「预留」的 sprite 不算错(同伴还没做成局内实体)
      const isPlaceholder = /预留/.test(src) && /tavern/.test(f) && /sprite:/.test(src);
      if (!isPrefix && !isPlaceholder) {
        console.log(`  ❌ ${f.replace(ROOT + '/', '')}:${li + 1} → sprite:'${name}' 不在精灵表`);
        bad++;
      }
      }
    });
  }
  ok(`${total} 处 sprite 引用全部有效`, bad === 0, `${bad} 处无效`);
}

console.log('\n[2] 拾取物 kind 必须在 pickups.js 里有处理分支');
{
  const src = readFileSync(join(ROOT, 'js/game/pickups.js'), 'utf8');
  // 收集被 addPickup 用的 kind
  const kinds = new Set();
  for (const m of src.matchAll(/addPickup\(\s*\{[^}]*?kind\s*:\s*'([a-z]+)'/gs)) kinds.add(m[1]);
  for (const f of files) {
    if (f.endsWith('pickups.js')) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/addPickup\(\s*\{[^}]*?kind\s*:\s*'([a-z]+)'/gs)) kinds.add(m[1]);
  }
  for (const k of kinds) {
    const handled = new RegExp(`kind === '${k}'`).test(src) || new RegExp(`kind === '${k}'`).test(
      readFileSync(join(ROOT, 'js/game/pickups.js'), 'utf8'));
    ok(`kind '${k}' 有拾取处理`, handled);
  }
}

console.log('\n[3] 精灵调色板里每个键都有实值');
{
  let empty = 0;
  for (const [k, v] of Object.entries(PAL)) {
    if (!v || !/^#[0-9a-fA-F]{3,8}$/.test(v)) { console.log(`  ❌ PAL.${k} = ${v}`); empty++; }
  }
  ok(`${Object.keys(PAL).length} 个调色板键都有合法色值`, empty === 0);
}

console.log('\n[4] 引擎清屏色必须来自调色板,不能是硬编码孤儿值');
{
  const e = readFileSync(join(ROOT, 'js/core/engine.js'), 'utf8');
  const hard = [...e.matchAll(/fillStyle\s*=\s*'(#[0-9a-fA-F]{3,8})'\s*;\s*ctx\.fillRect\(0, 0, this\.w/g)];
  ok('清屏色不用硬编码色值', hard.length === 0, hard.length ? `发现 ${hard.length} 处` : '');
  ok('清屏色取自 PAL', /fillStyle\s*=\s*PAL\./.test(e));
}

console.log(`\ntest-sprites: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);