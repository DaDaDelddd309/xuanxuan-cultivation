// 神通链路闸门 —— 防「悟道永久锁死」(XX-ARCH-006)
//
// 曾经的死循环:起始 {jianqi:1} → 悟道需两门满级 → 局内升级池无神通
//               → Cult.syncArt 0 调用 → 13/14 门永久灰死。
// 修法是补两头:局内 rollChoices 给出神通、局末 syncArt 回写修仙阁。
// 本 lint 盯住这两头不被再拆掉。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const rd = p => readFileSync(join(ROOT, p), 'utf8');

let fail = 0;
const ok = (n, c, d = '') => {
  if (c) console.log(`  ✓ ${n}`);
  else { fail++; console.log(`  ❌ ${n} ${d}`); }
};

const up = rd('js/game/upgrades.js');
const main = rd('js/main.js');
const arts = rd('js/xiuxian/arts.js');

console.log('\n[1] 局内:升级池必须给出神通');
ok('RUN_ARTS 表存在', /const RUN_ARTS = \[/.test(up));
ok("rollChoices 里 push kind:'art'", /kind:\s*'art'/.test(up));
ok("applyChoice 处理 kind==='art'", /c\.kind === 'art'/.test(up));
ok('applyChoice 给了真实属性增益(不是空壳)',
   /p\.stats\.(might|armor|areaMult)|p\.stats\[k\]/.test(up));

console.log('\n[2] 局末:必须回写修仙阁');
ok('main.js 调用 runArtSync', /runArtSync\s*\(/.test(main));
ok('main.js 调用 Cult.syncArt', /Cult\.syncArt\s*\(/.test(main));
ok('Cult.syncArt 有实现', /syncArt\s*\(\s*id\s*,\s*lv\s*\)/.test(rd('js/xiuxian/index.js')));

console.log('\n[3] RUN_ARTS 的 id 必须与 arts.js 的 ARTS 对得上');
const real = new Set([...arts.matchAll(/^\s{2}(\w+):\s*\{\s*name:/gm)].map(m => m[1]));
const used = [...up.matchAll(/\['(\w+)','([^']+)','(\w+)'\]/g)];
ok(`RUN_ARTS 解析出 ${used.length} 条`, used.length > 0);
const bogus = used.filter(m => !real.has(m[1]));
ok('RUN_ARTS 里没有不存在的 id', bogus.length === 0,
   bogus.map(m => m[1]).join(',') + ' ← 编造 id 是历史上出过的错(herb/iron、sha/shalei)');
// arts.js 里是 `jianqi: { name:… family:… }` —— id **不带引号**。
// 第一版正则写成 'id': 于是 14 门全判不一致 —— 尺子的问题,不是数据的问题。
const famMissing = used.filter(m => !new RegExp(`\\b${m[1]}:\\s*\\{[^}]*family:\\s*'${m[3]}'`).test(arts));
ok('family 与 arts.js 一致', famMissing.length === 0, famMissing.map(m => m[1]).join(','));

console.log(`\nlint-arts: ${fail ? 'FAIL' : 'PASS'} (${fail ? fail : 'ok'})`);
process.exit(fail ? 1 : 0);
