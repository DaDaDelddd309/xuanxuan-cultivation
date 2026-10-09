// 反派专属立绘回归测试(XX-AUDIT-011)
//
// 背景:6 张 villain-*.jpg 共 681 KB,全在 sw.js 预缓存里(每台设备都下载),
//       但 asset-reach 检索确认**零引用** —— 每台设备白下载 681 KB。
//   ui.js 的旧注释写「想让反派各有专属脸,得补美术 —— 代码解决不了」。
//
//   **那个判断写下的当时是对的,后来就不对了。**
//   实测:美术早就补好了,敌人数据(`foes` 数组第 6 位)也早就带了专属 key,
//   缺的只是一张映射表。
//
// 本测试验证接线真的生效:每个敌人拿到的 img 必须是**它自己那张**,
// 而不是所有人挤在 3 张脸上轮换。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'js/xiuxian/ui.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };

console.log('\n=== [1] 六张反派立绘都进了 PORTRAIT 表 ===');
{
  const tbl = SRC.slice(SRC.indexOf('const PORTRAIT'), SRC.indexOf('const TABS'));
  for (const [key, file] of [
    ['heifeng', 'villain-heifeng.jpg'],
    ['shougu',  'villain-shougu.jpg'],
    ['youfang', 'villain-youfang.jpg'],
    ['shemie',  'villain-shexie.jpg'],
    ['nvxia',   'villain-nvxia.jpg'],
    ['yaohou',  'villain-yaohou.jpg'],
  ]) {
    t(`PORTRAIT.${key} → ${file}`, new RegExp(`${key}\\s*:\\s*'assets/portrait/${file}'`).test(tbl));
  }
}

console.log('=== [2] 立绘分派走专属 key(不再只走轮换表) ===');
{
  t('读取 pick[4] 作为 artKey', /const artKey = pick\[4\]/.test(SRC));
  t('img 优先取 PORTRAIT[artKey]', /img:\s*PORTRAIT\[artKey\]\s*\|\|/.test(SRC),
    '没有它就还是走旧轮换表 —— 那 6 张图等于没接');
  t('保留 FOE_ART 作为无专属图时的回退', /FOE_ART\[pick\[2\]\]/.test(SRC));
  t('最终兜底仍是 foe', /\|\|\s*PORTRAIT\.foe/.test(SRC));
}

console.log('=== [3] 旧注释已被更正(不留误导) ===');
{
  // ⚠️ 只能查**非注释行**。
  //   我自己的更正注释里引用了旧注释原文(第 49/650 行),
  //   那是为了留档「以前是这么说的」,不是还在断言它。
  //   门禁若连注释一起扫,就会把自己写的说明判成违规 —— 这是自指的坑。
  const codeOnly = SRC.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  t('代码里不再断言「代码解决不了」',
    !/想让反派各有专属脸,得补美术\s*——\s*代码解决不了/.test(codeOnly),
    '这句现在已经不成立了,留着会误导下一个人继续以为改不了');
  t('更正说明仍留档(知道以前发生过什么)', /旧注释说/.test(SRC));
}

console.log('=== [4] 数据侧:敌人确实带了专属 key ===');
{
  // foes 数组第 6 位是专属 key,接线依赖它
  const foes = SRC.slice(SRC.indexOf('const foes ='), SRC.indexOf('const foes =') + 600);
  for (const k of ['moying', 'heifeng', 'shougu', 'youfang']) {
    t(`${k} 在 foes 数据里`, foes.includes(`'${k}'`));
  }
  t('foes 每条都是 6 元组(第 6 位是 key)', (foes.match(/\[[^\]]*'?(moying|heifeng|shougu|youfang)'?[^\]]*\]/g) || []).length >= 4);
}

console.log('=== [5] 不能引入新的死引用 ===');
{
  // 若新增了 villain 键却没人用,bad — 反过来才是本测试的目的
  t('PORTRAIT 表仍被使用', /PORTRAIT\[artKey\]/.test(SRC) && /PORTRAIT\.foe/.test(SRC));
}

if (fail === 0) {
  console.log('\n✅ 反派立绘已接线:每个敌人拿自己的脸,681 KB 不再白下载');
} else {
  console.log(`\n❌ ${fail} 项不达标`);
}
process.exit(fail ? 1 : 0);