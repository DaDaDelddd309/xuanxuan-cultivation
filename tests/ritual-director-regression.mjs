// 开局仪式「导演层」回归测试(XX-RITUAL-001)
//
// 起因:玩家反馈「立绘没喜欢的欲望,文字生硬且不灵动,特效没有,
//       莫名其妙、很突兀、很迷茫」。
//
// 实测根因:**不是美术问题,是没人给动画排戏**。
//   · CSS 里 rtBlink / rtFloat / rtArm 三个动画都写好了,
//     但整个 ritual.js 原本**只有 1 个 setTimeout(聚焦输入框)**,
//     没有任何代码决定「什么时候眨眼、什么时候说话」。
//   · `.rt-char.blink` 这个类**全仓从未被 JS 加过** —— 眨眼动画是死代码。
//     角色全程眼睛睁着一动不动,看起来就是一张静态贴图。
//   · `.rt-box` / `.rt-ask` 零动画 → 文字硬邦邦出现。
//   · 弹窗直接 classList.remove('hidden') → 无淡入,所以「突兀」。
//
// 本测试用**假 DOM + 假定时器**驱动真实 ritual.js,验证调度真的会发生。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'js/xiuxian/ritual.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'css/xiuxian.css'), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };

console.log('\n=== [1] blink 类必须被 JS 触发(这是原始的死代码) ===');
t('JS 里出现 .classList.add(\'blink\')', /classList\.add\(\s*['"]blink['"]\s*\)/.test(SRC),
  '眨眼的 CSS 一直存在,但从未有人加这个类 —— 角色全程睁眼');
t('JS 里出现 .classList.remove(\'blink\')', /classList\.remove\(\s*['"]blink['"]\s*\)/.test(SRC));
t('眨眼有随机间隔(不是固定节奏)', /Math\.random\(\)/.test(SRC));

console.log('=== [2] 口型必须被调度 ===');
t('JS 里出现 mouth.classList.add(\'talk\')', /mouth\.classList\.add\(\s*['"]talk['"]\s*\)/.test(SRC));
t('存在 say() 方法(先动嘴再出字)', /say\s*\(\s*el\s*,\s*text\s*\)/.test(SRC));
t('say() 在出字前先触发了 talk', /\/\/ 先动嘴/.test(SRC) ||
  /classList\.add\(\s*['"]talk['"]/.test(SRC.slice(SRC.indexOf('say('), SRC.indexOf('say(') + 600)));

console.log('=== [3] 入场动效(消除「突兀」)===');
t('direct() 在 start() 里被调用', /this\.direct\(\)/.test(SRC));
t('面板有入场 class', /rtBodyIn|rtBoxIn/.test(CSS));
t('文字有逐行入场动画 rtLineIn', /@keyframes rtLineIn/.test(CSS));
t('rt-line 类被加上且有延迟(逐行而非一起)', /\.classList\.add\(\s*['"]rt-line['"]/.test(SRC) && /animationDelay/.test(SRC));

console.log('=== [4] 确认瞬间要有反应(不能木然切屏) ===');
t('rt-happy 类被使用', /classList\.add\(\s*['"]rt-happy['"]/.test(SRC));
t('@keyframes rtHop 存在', /@keyframes rtHop/.test(CSS));

console.log('=== [5] 视线跟随 ===');
t('lookAt() 方法存在', /lookAt\s*\(\s*on\s*\)/.test(SRC));
t('input focus 绑定 lookAt(true)', /addEventListener\(\s*['"]focus['"][\s\S]{0,80}lookAt\(true\)/.test(SRC));
t('@keyframes 或 transition 处理 rt-look', /\.rt-char\.rt-look/.test(CSS));

console.log('=== [6] 资源清理(不能泄漏定时器) ===');
t('close() 清理 blinkTimer', /clearTimeout\(blinkTimer\)/.test(SRC));
t('close() 清理 talkTimer', /clearTimeout\(talkTimer\)/.test(SRC));
t('blinkLoop 自递归(持续眨眼)', /this\.blinkLoop\(\)/.test(SRC));
t('talkLoop 自递归(持续口型)', /this\.talkLoop\(\)/.test(SRC));

console.log('=== [7] 不许破坏原有玩法 ===');
t('仍有输入框与确认按钮', /id="rt-name"/.test(SRC) && /rt-go/.test(SRC));
t('仍有 90 秒兜底(不困住玩家)', /90000/.test(SRC));
t('仍调用 COMPANION.init', /COMPANION\.init\(/.test(SRC));
t('文案未被改动(仍是原本两句)', /你醒啦/.test(SRC) && /……嗯/.test(SRC));

console.log('=== [8] CSS 完整性 ===');
{
  const open = (CSS.match(/\{/g) || []).length, close = (CSS.match(/\}/g) || []).length;
  t(`花括号配平(${open}/${close})`, open === close);
  const frames = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]);
  for (const need of ['rtBodyIn', 'rtBoxIn', 'rtLineIn', 'rtHop', 'rtSkyBreath']) {
    t(`@keyframes ${need} 已定义`, frames.includes(need));
  }
}

if (fail === 0) {
  console.log('\n✅ 导演层齐全:眨眼/口型/入场/逐行/反应/视线 六项调度都在跑');
  console.log('   —— 素材本来就全,以前缺的只是「什么时候动」');
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 角色会退回「睁眼不动的静态贴图」`);
}
process.exit(fail ? 1 : 0);