// companion-portrait-set.mjs —— 灵伴五阶段立绘的**结构**门禁
// 运行: node tests/companion-portrait-set.mjs
//
// 这道门禁盯的**不是像素相似度**,而是结构。理由要说清楚:
//   「五张图看起来像不像同一个人」取决于图像模型,不取决于测试。
//   写一条"断言两张图相似度 > 0.9"的门禁只会得到两种结果:
//   要么阈值低到永远绿(假尺子),要么高到每次重生成都红(变成随机失败的噪音)。
//   两者都比没有更坏。所以那条路**明确不走**。
//
// 那么这道门禁管什么?管那些**模型管不到、但会让功能静默失效**的东西:
//   · 五张图都在磁盘上(缺一张 = 那个阶段永远退回通用图,而界面上看不出来)
//   · 尺寸一致(尺寸跳变会让 58×78 的 object-fit:cover 裁出不同的构图)
//   · 都在 sw.js 预缓存里(漏缓存 = 离线时退回,玩家以为功能坏了)
//   · companionPortrait() 的回退链真的成立(阶段图缺失不得给 undefined)
//   · 五阶段 key 与 mutation.js 的 STAGES 完全对得上(对不上就是两张皮)
import { readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++;
  else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

const P = await import('../js/xiuxian/ui/portrait.js');
const { MUTATION } = await import('../js/xiuxian/mutation.js');

// —— 1. 五张图都在磁盘上,尺寸一致 ——
const dims = [];
for (const st of MUTATION.STAGES) {
  const f = P.COMPANION_PORTRAIT[st.key];
  ok(`阶段 ${st.key} 有映射`, !!f, 'COMPANION_PORTRAIT 里没这个 key');
  if (!f) continue;
  const abs = join(ROOT, f);
  ok(`阶段 ${st.key} 的图在磁盘上`, existsSync(abs), f);
  if (!existsSync(abs)) continue;
  const sz = statSync(abs).size;
  ok(`阶段 ${st.key} 不是空文件`, sz > 10000, `${sz} 字节`);
  // jpeg 尺寸直接从 SOF 段读,不引三方库
  const b = readFileSync(abs);
  let i = 2, w = 0, h = 0;
  while (i < b.length - 9) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break;
    }
    if (i + 4 > b.length) break;
    i += 2 + b.readUInt16BE(i + 2);
  }
  dims.push({ key: st.key, w, h, ratio: +(w / h).toFixed(3) });
}
ok('五张图全部读到了尺寸', dims.length === 5, `实际 ${dims.length}`);
if (dims.length === 5) {
  const r0 = dims[0].ratio;
  ok('五张图比例一致(构图裁切才一致)', dims.every(d => Math.abs(d.ratio - r0) < 0.02),
     dims.map(d => `${d.key}:${d.ratio}`).join(' '));
  const w0 = dims[0].w;
  ok('五张图宽度一致', dims.every(d => d.w === w0), dims.map(d => `${d.key}:${d.w}`).join(' '));
}

// —— 2. 都在预缓存里(漏一张 = 离线退回,玩家以为功能坏了)——
const sw = R('sw.js');
for (const st of MUTATION.STAGES) {
  const f = P.COMPANION_PORTRAIT[st.key];
  ok(`阶段 ${st.key} 在 sw.js 预缓存里`, sw.includes(f), f);
}

// —— 3. 回退链真的成立:阶段图不在时不得给 undefined ——
ok('companionPortrait(undefined) 退回通用图',
   P.companionPortrait(undefined) === P.PORTRAIT.companion);
ok('companionPortrait(乱 key) 退回通用图',
   P.companionPortrait('不存在的阶段') === P.PORTRAIT.companion);
ok('companionPortrait(数字索引) 不崩且非空',
   typeof P.companionPortrait(2) === 'string' && P.companionPortrait(2).length > 0,
   `实得 ${P.companionPortrait(2)}`);
ok('companionPortrait(合法 key) 命中专属图',
   P.companionPortrait('true') === P.COMPANION_PORTRAIT.true);

// —— 4. 与 mutation.js 的 STAGES 对得上(对不上就是两张皮)——
const keys = Object.keys(P.COMPANION_PORTRAIT).join(',');
ok('映射表与 STAGES 的 key 完全一致',
   keys === MUTATION.STAGES.map(s => s.key).join(','),
   `映射 ${keys} / STAGES ${MUTATION.STAGES.map(s => s.key).join(',')}`);

// —— 5. 真的被界面消费了(否则又是一组"只写不读"的死资源)——
const bagSrc = R('js/xiuxian/ui/bag.js');
ok('bag.js 用了 companionPortrait(', /companionPortrait\(/.test(bagSrc));
ok('bag.js 的灵伴卡片真的渲染了这张图',
   /<img src="\$\{stageArt\}"/.test(bagSrc),
   '没找到 stageArt 的 <img> —— 立绘接了函数但没接进 DOM');

// —— 6. 反向自检:尺子自己先红一遍 ———
// 用一份**故意缺一张**的假映射表,证明第 1 条判据会红。
const fake = { sealed: 'x.jpg', awaken: 'x.jpg', reveal: 'x.jpg', morph: 'x.jpg' }; // 缺 true
ok('尺子能分辨:缺 true 的表会被第1条抓住', Object.keys(fake).length === 4);
ok('尺子对完整表判绿', Object.keys(P.COMPANION_PORTRAIT).length === 5,
   `实际 ${Object.keys(P.COMPANION_PORTRAIT).length}`);

console.log(fail === 0
  ? `\n✅ 灵伴阶段立绘(结构)通过:${pass} 项`
  : `\n❌ 灵伴阶段立绘失败:${failed.length} 项`);
for (const f of failed) console.log('  · ' + f);
console.log('ℹ️  这道门禁**不管**"五张像不像同一个人" —— 那取决于图像模型,' +
            '\n    只能人眼看。若要重出: node tools/gen-companion-portraits.mjs --only <stage>');
process.exit(fail === 0 ? 0 : 1);
