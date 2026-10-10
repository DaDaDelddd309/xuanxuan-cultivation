// 立绘资产闸门 —— 格式/数量/调色板三道约束(XX-ART-001)
//
// 为什么要有:立绘是"游戏的灵魂之一"(owner 原话),但这一块已经出过两次问题:
//   1. 数量不够 —— 4 个反派只能轮换 3 张图,打谁都是同一张脸
//   2. 风格不统一 —— 游戏本体是像素 canvas,立绘却是水墨画风,两套视觉语言
// 所以格式不写死成检查项,它就会漂。
//
// 三道约束:
//   [数量] 修仙阁与回合制会用到的角色,每人有独立立绘
//   [尺寸] 足够小 —— 立绘以 58x78 / 300x550 两种尺寸显示,
//         原图 1024 级的直接塞进仓库是纯浪费带宽(PWA 要预缓存)
//   [调色板] 采样统计:暗部与中间色必须是中性灰,不能是蓝/绿/高饱和
//
// 调色板依据(不是拍脑袋,是从 12 张定稿插画反推的,见 css/palette.css 头注释):
//   中性灰(暗) 87.0% · 暖调(纸/金) 13.0% · 蓝 0% · 绿 0% · 饱和色 0%
import { readFileSync, existsSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const DIR = join(ROOT, 'assets/portrait');

let fail = 0, skip = 0;
const ok = (n, c, d = '') => {
  if (c) console.log(`  ✓ ${n}`);
  else { fail++; console.log(`  ❌ ${n} ${d}`); }
};
// 「没检查」与「查出问题」是两件事,必须分开记账(XX-AUDIT-028)。
// 混在一起的后果实测过:三星缺 Pillow,采样器返回 2 并明写「这不是风格超标」,
// 而这里原先用 execFileSync —— 非零就抛,于是「跑不了」被报成「立绘超标」。
const skipNote = (n, d = '') => {
  skip++;
  console.log(`  ⚠️  ${n}${d ? ' :: ' + d : ''}`);
};

console.log('\n[1] 数量:每个角色一张独立立绘');
// 会出现在界面上的角色。少一张就意味着轮换用,玩家会觉得"谁都是那张脸"。
const CAST = [
  ['knight',   '主角·剑客'], ['mage',    '主角·道人'],
  ['ranger',   '主角·游侠'], ['white',   '主角·白衣剑仙'],
  ['companion','灵伴'],       ['momocha', '么么茶'],
  ['merchant', '流浪商人'],   ['villain-shexie', '反派·蛇蝎美人'],
  ['villain-nvxia',  '反派·女侠'],
  ['villain-yaohou', '反派·妖后'],
  ['villain-moying',  '反派·墨影'],
  ['villain-youfang', '反派·游方剑客'],
  ['villain-heifeng', '反派·黑风散修'],
  ['villain-shougu',  '反派·守谷妖修'],
];
const files = existsSync(DIR) ? readdirSync(DIR).filter(f => /\.(jpg|png|webp)$/i.test(f)) : [];
const stem = f => f.replace(/\.(jpg|png|webp)$/i, '');
const have = new Set(files.map(stem));
const missing = CAST.filter(([id]) => !have.has(id));
// 别名:ui.js 的 PORTRAIT 表把某些角色指向别的文件,这里跟着它
const ALIAS = { foe: 'villain-moying' };
for (const m of missing.slice()) {
  const a = ALIAS[m[0]];
  if (a && have.has(a)) missing.splice(missing.indexOf(m), 1);
}
ok(`${CAST.length} 个角色都有立绘`, missing.length === 0,
   '缺: ' + missing.map(m => m[0]).join(', '));

console.log('\n[2] 尺寸:原图不该是 1024 级(立绘显示只有 58x78 / 300x550)');
let bigCount = 0; const big = [];
for (const f of files) {
  const b = readFileSync(join(DIR, f));
  // 只看体积 —— 精确宽高要解码,这里用体积做快筛,精确值在采样时拿
  if (b.length > 220 * 1024) { bigCount++; big.push(`${f} ${Math.round(b.length/1024)}KB`); }
}
ok(`没有超过 220KB 的立绘（当前 ${files.length} 张）`, bigCount === 0, big.join(' | '));

console.log('\n[3] 调色板:真采样(饱和度与亮度必须落在实测区间)');
// ⚠️ 这一项原来只查文件名,等于没查 —— 上一批「红衣护法」饱和度 14.41%
// 照样混了进来,肉眼看只是「有点红」。现在改成真的采样。
const meas = join(ROOT, 'tools/art/measure_style.py');
if (existsSync(meas)) {
  // ⚠️ 必须用 spawnSync 而不是 execFileSync:后者非零退出就抛,
  //    拿不到退出码就分不清「超标(1)」和「跑不了(2)」。
  const r = spawnSync('python3', [meas, '--gate'], { encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  for (const line of out.split('\n')) if (line.trim()) console.log('  ' + line);
  const code = r.status;
  if (code === 0) {
    ok('全部立绘落在实测调色板区间内', true);
  } else if (code === 1) {
    ok('全部立绘落在实测调色板区间内', false, '采样器报超标,明细见上');
  } else if (code === 2) {
    skipNote('调色板本项未检查(采样器缺依赖)', '不是「超标」;按上方提示装上依赖即可自动恢复');
  } else {
    skipNote('调色板本项未检查(采样器起不来)',
      r.error ? r.error.message.slice(0, 120) : `非预期退出码 ${code}`);
  }
} else {
  // 采样器本身是入库文件,它不见了 = 有人删了,那是仓库缺陷,不是「没检查」。
  ok('tools/art/measure_style.py 存在', false, '缺采样器,调色板这项等于没查');
}

console.log(`\nlint-portraits: ${fail ? 'FAIL' : 'PASS'} (${fail ? fail : 'ok'}`
  + `${skip ? `, ${skip} 项未检查` : ''})`);
process.exit(fail ? 1 : 0);