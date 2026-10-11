// lint-dead-effect-key.mjs —— 「声明了没人读」的通用门禁(工单 XX-QA-065)
//
// 为什么要有它:本项目这一轮连续抓到三个同型缺陷,都是**声明了、没接线、
// 然后所有人以为它管用**:
//   ① `DEFEAT.resolve()` 的 `expLoss` —— 战败面板写「只剩一半修为」,从来没兑现
//   ② `lore.js` 奇遇的 `hpLoss` —— 写了「丢了些东西」,不掉血
//   ③ `NAGER.request(opt)` 的 `reason` —— 文件头当成设计原则宣传,实现里零引用
// 三个都不是「忘了写」,是**数据模型按「将来要实现什么」写全了字段,
// 中间接线层在几个版本里零散补上当场需要的那几个键,没人回头清点**。
//
// 现有的 `lint-deadwire` / `lint-deadexport` 查的是**导出与调用**,
// 查不到「对象字面量里的某个 key 有没有读者」—— 这类缺陷正好落在它们的盲区。
//
// 【口径】宁可漏报,不可误报(与本项目既有 lint 一致):
//   · 只扫 `effect:` / `result:` / `fx:` 三种字面量 —— 它们是「契约对象」的固定写法
//   · 消费点必须形如 `.key` / ['key'] / key],**`key: value` 形式算再声明,不算消费**
//   · 任何整体遍历(Object.keys / entries / for-in)一律视为「有读者」,
//     不去分辨它到底读了哪几个键 —— 分辨不了就别报,免得假红
//   · 剥注释、剥字符串/模板串之后再统计,避免文案里的同名字段被算成消费点
//
// 【自带反向注入自检】:§3 会往源码里注入一个假死键,门禁必须报红;
//   不红就是扫描器自己坏了(本项目铁律:度量工具自己出错比没有度量工具更危险)。
//
// 退出码:0 = 通过;非 0 = 有新增死键,或扫描器自检失败
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const JS = _rv(ROOT, 'js');
const C = { red: s => `\x1b[31m${s}\x1b[0m`, grn: s => `\x1b[32m${s}\x1b[0m`, yel: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` };

// 已登记的死键。基线**只减不增**;新增即红。
const BASELINE = new Set([
  'js/xiuxian/relations.js::death',   // DEFEAT.settleDebt 返回值里的 death:'rout'
                                        //   —— settleDebt 本身零调用点(工单 XX-QA-066),
                                        //   所以这一格是「死函数里的死键」,等接线时一起处理
]);

const files = [];
(function walk(d) {
  for (const f of readdirSync(d).sort()) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(JS);

/** 剥注释与字符串字面量,只留真实代码 */
function strip(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

let dynSites = 0;
function scan() {
  const src = files.map(f => ({ f: f.slice(ROOT.length + 1), code: strip(readFileSync(f, 'utf8')) }));
  const all = src.map(s => s.code).join('\n');
  // ⚠️ 这里**曾经**有一个「全仓存在任意动态遍历 ⇒ 全部视为有读者」的总开关。
  //   它让本 lint 变成**永远报 0 条** —— 而那正是「看起来在工作、实际从不工作」
  //   最恶劣的一种形态:104 个文件扫下来一片绿,实际上什么都没查。
  //   触发它的就是 battle.js 里一句 `for (const k in s.cooldown)`。
  //   §3 的反向注入自检当场把它抓了出来(注入的死键没被报出来)。
  //   现在:动态遍历**只做提示,不参与判定**。宁可多报一条要人看的,也不要整条 lint 哑掉。
  dynSites = (all.match(/Object\.(?:keys|entries|values)\s*\(|for\s*\([^)]*\bin\s/g) || []).length;

  const hits = [];
  const KEY = /\b(?:effect|result|fx)\s*:\s*\{([^}]*)\}/g;
  for (const { f, code } of src) {
    let m;
    KEY.lastIndex = 0;
    while ((m = KEY.exec(code))) {
      const keys = m[1].split(',').map(s => s.split(':')[0].trim()).filter(k => /^[A-Za-z_$][\w$]*$/.test(k));
      for (const k of new Set(keys)) {
        const read = new RegExp(`\\.${k}\\b|\\[['"]${k}['"]\\]|\\b${k}\\s*\\]`, 'g');
        let n = 0, r;
        while ((r = read.exec(all))) n++;
        if (n === 0) hits.push(`${f}::${k}`);
      }
    }
  }
  return hits;
}

console.log(`\n${C.dim('══ 「声明了没人读」的 effect/result 键 ══')}`);
const hits = scan();
const fresh = hits.filter(h => !BASELINE.has(h));
const known = hits.filter(h => BASELINE.has(h));

console.log(`  扫描 ${C.grn(files.length + ' 个文件')} · 死键 ${C.yel(hits.length)} 个`
  + `（其中 ${known.length} 个已登记基线）\n`);
for (const h of known) console.log(`  ${C.dim('·')} ${C.dim(h)}  ${C.dim('(已登记)')}`);
for (const h of fresh) console.log(`  ${C.red('❌')} ${C.red(h)}`);

// §3 反向注入自检:临时塞一个假死键,必须被抓到
console.log(`\n${C.dim('── 扫描器自检(注入一个假死键,必须报红)──')}`);
const VICTIM = join(JS, 'xiuxian', 'relations.js');
const backup = readFileSync(VICTIM, 'utf8');
let selfCheckOk = false, selfCheckMsg = '';
try {
  const polluted = backup.replace(/effect:\{ realmDamage:1, expLoss:1, demon:\+8 \}/,
    'effect:{ realmDamage:1, expLoss:1, demon:+8, __selfCheckDeadKey:1 }');
  if (polluted === backup) { selfCheckMsg = '注入锚点没命中(代码已变),自检作废 —— 扫描器有效性未经检验'; }
  else {
    writeFileSync(VICTIM, polluted);
    const caught = scan().some(h => h.endsWith('::__selfCheckDeadKey'));
    selfCheckOk = caught;
    selfCheckMsg = caught ? '注入的死键被抓到了 ✅ 扫描器有效'
      : '注入的死键没被抓到 ❌ 扫描器在撒谎';
  }
} finally {
  writeFileSync(VICTIM, backup);
}
// 还原后再扫一次,确认工作区回到注入前的样子
const after = scan();
if (JSON.stringify(after) !== JSON.stringify(hits)) {
  console.log(`  ${C.red('❌ 还原后扫描结果与注入前不一致 —— 自检污染了工作区')}`);
  process.exit(3);
}
console.log(`  ${selfCheckOk ? C.grn('✅') : C.red('❌')} ${selfCheckMsg}`);
console.log(`  ${C.grn('✅')} 注入已还原,还原后扫描结果与注入前逐条一致`);
console.log(`  ${C.dim(`ℹ️  全仓动态遍历点 ${dynSites} 处 —— 若某条报红看起来像被遍历覆盖,请人工确认(本 lint 不替你猜)`)}`);

if (!selfCheckOk) process.exit(3);
if (fresh.length) {
  console.log(`\n${C.red(`❌ ${fresh.length} 个新增死键 —— 声明了没人读`)}`);
  console.log(C.dim('  要么接上消费方,要么把这个键删掉(别留着一个永远不生效的承诺)。'));
  process.exit(1);
}
console.log(`\n${C.grn('✅ 无新增死键')}${known.length ? C.dim(`(基线 ${known.length} 条)`) : ''}`);
process.exit(0);