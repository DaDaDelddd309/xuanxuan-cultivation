// XX-PLAY-004 / XX-PLAY-007 · owner 2026-10-10 一次性拍板的回归门禁
//
// 本轮 owner 拍板三件事,这里逐条钉死,免得以后又被改回去:
//   1. 护栏数值「弄好」      —— 旧值 LV5=830 比整个视口还大,是照着虚构的拾取 800 调的
//   2. 护栏文字挡画面        —— 标签原本锚在圆圈上边缘,半径一变文字就飘
//   3. 吐纳冻结              —— 冻结不是删除,逻辑留着,改一个开关就能解冻
//
// 断言原则(踩过的坑写在这,别再犯):
//   · **基准必须来自真实数据**,不能沿用注释里的虚构值。
//     旧测试用 BIG_PICKUP=800 / pickup=4000,那是错的 —— 真实满配拾取是 270。
//   · 断言要独立于被检查的数据:这里重新从 player.js / upgrades.js / tavern.js
//     抓真实构成,而不是把 270 再抄一遍当常量。
import { install } from './harness.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

install();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => readFileSync(join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, info = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${info ? '  ' + info : ''}`); }
  else { fail++; bad.push(`${name} :: ${info}`); console.log(`  ❌ ${name}  ${info}`); }
}

// ————————————————————————— 0. 从源码反推真实拾取上限 —————————————————————————
console.log('\n[0] 基准:拾取半径的真实构成(不写死,现读源码)');

const playerSrc = rd('js/game/player.js');
const upgSrc    = rd('js/game/upgrades.js');
const tavSrc    = rd('js/xiuxian/tavern.js');

// 基础:magnet: 60 + charBonus + b.magnetFlat
const baseM = playerSrc.match(/magnet:\s*(\d+)\s*\+/);
const BASE_MAGNET = baseM ? +baseM[1] : NaN;
ok('player.js 抓到拾取基础值', Number.isFinite(BASE_MAGNET), `= ${BASE_MAGNET}`);

// 磁石:magnetFlat +25/级,maxLv 5
// ⚠️ 增量在**生效表**里(`magnet: { key:'magnetFlat', mode:'add', v:25 }`),
//    不是名称表(`magnet: { name:'磁石', maxLv:5 }`)—— 第一次写正则抓成了
//    maxLv 那个 5,算出 140 这种假基准。分表抓,别混。
const magMaxLv = upgSrc.match(/magnet:\s*\{\s*name:[^}]*?maxLv:\s*(\d+)/s);
const MAG_MAXLV = magMaxLv ? +magMaxLv[1] : NaN;
const magStepM = upgSrc.match(/key:\s*'magnetFlat'[^}]*?v:\s*(\d+)/s);
const magStep = magStepM ? +magStepM[1] : NaN;
ok('upgrades.js 抓到磁石每级增量(生效表,非名称表)', magStep === 25, `= ${magStep}, 满级 ${MAG_MAXLV} 级`);
ok('磁石满级确实是 5 级', MAG_MAXLV === 5, `= ${MAG_MAXLV}`);

// 酒馆:mods.magnet
const tavMag = tavSrc.match(/mods:\s*\{\s*magnet:\s*(\d+)/);
const TAV_MAGNET = tavMag ? +tavMag[1] : NaN;
ok('tavern.js 抓到酒馆拾取加成', Number.isFinite(TAV_MAGNET), `= ${TAV_MAGNET}`);

// 角色自带:游侠 magnet:30(满配要算上,不然基准偏低 30)
const charMags = [...playerSrc.matchAll(/magnet:\s*(\d+)\s*[,}]/g)].map(m => +m[1]);
const CHAR_MAGNET = charMags.length ? Math.max(...charMags) : 0;
ok('player.js 抓到角色自带拾取', CHAR_MAGNET > 0, `= ${CHAR_MAGNET}`);

const REAL_MAX_PICKUP = BASE_MAGNET + CHAR_MAGNET + magStep * MAG_MAXLV + TAV_MAGNET;
console.log(`  → 真实满配拾取 = ${BASE_MAGNET}(基础) + ${CHAR_MAGNET}(角色) + ${magStep}×${MAG_MAXLV}(磁石) + ${TAV_MAGNET}(酒馆) = ${REAL_MAX_PICKUP}`);
ok('真实满配拾取落在可考区间(240~300)', REAL_MAX_PICKUP >= 240 && REAL_MAX_PICKUP <= 300,
   `= ${REAL_MAX_PICKUP}`);

// ————————————————————————— 1. 护栏数值 —————————————————————————
console.log('\n[1] 护栏数值:回到「一屏看得见」且仍盖得住真实拾取');

const { computeWard, wardSlack, canIdleCamp } = await import('../js/game/director.js');

const lv5day = computeWard({ campLv: 5, phase: 'day', pickup: 0 });
const lv1day = computeWard({ campLv: 1, phase: 'day', pickup: 0 });

ok('5 级白天护栏 ≤ 300(一屏看得见完整圆环)', lv5day <= 300, `= ${lv5day}`);
ok('5 级白天护栏远小于旧值 830', lv5day < 400, `旧 830 → 现 ${lv5day}`);
ok('5 级白天盖得住真实满配拾取(能挂机)', lv5day >= REAL_MAX_PICKUP,
   `${lv5day} vs 满配 ${REAL_MAX_PICKUP}`);

// 随投入单调递增 —— 这是「值得投」的根据,不能被压平
let prev = -1, mono = true, series = [];
for (let lv = 1; lv <= 5; lv++) {
  const w = computeWard({ campLv: lv, phase: 'day', pickup: 0 });
  series.push(w);
  if (w <= prev) mono = false;
  prev = w;
}
ok('护栏随篝火等级严格递增', mono, series.join(' → '));

// 昼夜:夜里更大(老板测试的老断言)
const dDay = computeWard({ campLv: 3, phase: 'day' });
const dNight = computeWard({ campLv: 3, phase: 'night' });
ok('同等级夜里护栏更大', dNight > dDay, `${dDay} → ${dNight}`);

// 取舍仍在:1 级追不上满配拾取,外沿有可捡的
const poor = computeWard({ campLv: 1, phase: 'day', pickup: REAL_MAX_PICKUP });
ok('1 级追不上满配拾取(外沿有代价)', wardSlack(poor, REAL_MAX_PICKUP) > 0,
   `ward=${poor} pickup=${REAL_MAX_PICKUP} slack=${wardSlack(poor, REAL_MAX_PICKUP)}`);

// 挂机判定仍可用
ok('1 级不能挂机', canIdleCamp(1, 60) === false);
ok('5 级 + 真实满配拾取 = 能挂机', canIdleCamp(5, REAL_MAX_PICKUP) === true,
   `lv5ward=${computeWard({ campLv: 5, pickup: REAL_MAX_PICKUP })} pickup=${REAL_MAX_PICKUP}`);

// ————————————————————————— 2. 护栏文字锚点 —————————————————————————
console.log('\n[2] 护栏文字:锚在玩家身上,不随半径飘(XX-PLAY-004)');

const css = rd('css/style.css');
const bRule = (css.match(/\.hud-ward b\s*\{[^}]*\}/) || [''])[0];
ok('找到 .hud-ward b 规则', !!bRule, bRule.slice(0, 60));
ok('不再用 top:-20px(那是相对圆圈上边缘,半径一变就飘)',
   !/top:\s*-20px/.test(bRule), '');
ok('改成锚玩家:calc(50% - 偏移)', /top:\s*calc\(50%\s*-\s*\d+px\)/.test(bRule),
   (bRule.match(/top:[^;]*/) || [''])[0]);

// 横向本来就锚玩家(left:50%),确认没被改坏
ok('横向仍锚玩家(left:50%)', /left:\s*50%/.test(bRule));

// ————————————————————————— 3. 吐纳冻结 —————————————————————————
console.log('\n[3] 吐纳冻结:入口和处理器都要挡(只藏按钮等于没冻)');

const { Cult } = await import('../js/xiuxian/index.js');
ok('冻结开关存在且为 true', Cult.MEDITATE_FROZEN === true, `= ${Cult.MEDITATE_FROZEN}`);

// 逻辑仍在(冻结不是删除)
ok('产出公式 killYield 仍在', typeof Cult.killYield === 'function');
ok('MEDITATE_AS_KILLS 旋钮仍在', typeof Cult.MEDITATE_AS_KILLS === 'number',
   `= ${Cult.MEDITATE_AS_KILLS}`);

// 按钮真的不渲染了 —— 直接渲染页面验,不看源码
const { vRealm } = await import('../js/xiuxian/ui/realm.js');
const html = vRealm({}, { realm: 'qi', layer: 1, exp: 0, dao: 0, totalKills: 0, pills: {} });
ok('境界页不再渲染吐纳按钮', !html.includes('吐 纳 修 炼'), `html ${html.length} 字节`);
ok('境界页给出冻结说明', html.includes('吐纳已冻结'));

// 处理器也要挡:存档里残留 data-act="meditate" 时不能点出产出
const uiSrc = rd('js/xiuxian/ui.js');
// ⚠️ 别写 /case 'meditate':[\s\S]{0,700}?/ —— 尾部的 ? 让它惰性匹配 0 字符,
//    结果 medCase 是空串,两条断言永远红。第一次就栽在这。
const medCase = (uiSrc.match(/case 'meditate':\s*\{[\s\S]{0,900}/) || [''])[0];
ok('抓到 meditate 分支', medCase.length > 50, `${medCase.length} 字符`);
// ⚠️ 断言必须匹配**可执行代码**,不能只搜「MEDITATE_FROZEN 这个词」。
//    闸门上面的注释里就写着「改 MEDITATE_FROZEN 就能解冻」——
//    用 /MEDITATE_FROZEN/ 断言时,把整段 if 删掉它照样绿(实测注入验证抓到)。
//    只有匹配 `if (Cult.MEDITATE_FROZEN)` 这种真实语句才算数。
const gateRe = /if\s*\(\s*Cult\.MEDITATE_FROZEN\s*\)/;
ok('处理器里有可执行的冻结闸门(if (Cult.MEDITATE_FROZEN))', gateRe.test(medCase),
   gateRe.test(medCase) ? (medCase.match(/if\s*\(\s*Cult\.MEDITATE_FROZEN\s*\)/) || [''])[0] : '只剩注释里的字样,没有真闸门');
const gateAt = medCase.search(gateRe);
const expAt  = medCase.indexOf('addExp');
ok('闸门在 addExp 之前(不会先发产出再判断)', gateAt >= 0 && gateAt < expAt,
   `闸门@${gateAt} addExp@${expAt}`);

// ————————————————————————— 4. boss 立绘校准(XX-PLAY-008)—————————————————————————
console.log('\n[4] boss 立绘:跟着类型走,不再一律顶着墨影');

const enSrc = rd('js/game/enemies.js');
const mainSrc = rd('js/main.js');
const { BOSS_PORTRAIT, bossPortrait, PORTRAIT } = await import('../js/xiuxian/ui/portrait.js');

// 从 enemies.js 现抓 boss 类型,不写死列表
const bossTypes = [...enSrc.matchAll(/^\s*(boss_\w+):\s*\{[^\n]*boss:\s*1/gm)].map(m => m[1]);
ok('从 enemies.js 抓到 boss 类型', bossTypes.length >= 2, bossTypes.join(', '));

// 每个 boss 都必须有专属立绘,漏一个就红
const missing = bossTypes.filter(t => !BOSS_PORTRAIT[t]);
ok('每个 boss 都有专属立绘(不再退回通用反派图)', missing.length === 0,
   missing.length ? `缺: ${missing.join(', ')}` : bossTypes.map(t => `${t}→${BOSS_PORTRAIT[t]}`).join('  '));

// 关键回归:boss 绝不能拿到墨影的脸
const asFoe = bossTypes.filter(t => bossPortrait(t) === PORTRAIT.foe);
ok('没有任何 boss 拿到墨影的脸', asFoe.length === 0,
   asFoe.length ? `仍是墨影: ${asFoe.join(', ')}` : '');

// 立绘文件必须真的存在(映射表写了、文件没有 = 又一次假绿)
const { existsSync } = await import('fs');
const badFiles = Object.values(BOSS_PORTRAIT).filter(p => !existsSync(join(ROOT, p)));
ok('立绘文件都真实存在', badFiles.length === 0, badFiles.join(', ') || 'ok');

// 语义对得上:石像守卫必须是石头/golem,不能是张人脸
ok('石像守卫用的是 golem 资产', /golem/.test(BOSS_PORTRAIT.boss_golem || ''), BOSS_PORTRAIT.boss_golem);
ok('无常尊者用的是「尊者」立绘(戴冠坐像)', /yaohou/.test(BOSS_PORTRAIT.boss_overlord || ''), BOSS_PORTRAIT.boss_overlord);

// 复用闲置资产可以,但**绝不能复用正在轮换里的反派脸** —— 那等于制造
// 新的张冠李戴,正是 XX-PLAY-005 那一类 bug。
const uiJs = rd('js/xiuxian/ui.js');
const rotBlock = (uiJs.match(/const foes =[\s\S]{0,600}?\];/) || [''])[0];
const rotatedKeys = [...rotBlock.matchAll(/'([a-z]+)'\]/g)].map(m => m[1]);
const clash = Object.entries(BOSS_PORTRAIT).filter(([, p]) =>
  rotatedKeys.some(k => (PORTRAIT[k] || '') === p));
ok('boss 立绘不与修仙阁轮换中的反派撞脸', clash.length === 0,
   clash.length ? `撞脸: ${clash.map(([b, p]) => `${b}=${p}`).join(', ')}`
                : `轮换 key: ${rotatedKeys.join(',') || '(boss 位固定 墨影)'}`);

// main.js 必须走 bossPortrait(),不能再出现 foe 立绘写死
const foeBlock = (mainSrc.match(/foe:\s*\{[\s\S]{0,900}?\n\s{8}\},/) || [''])[0];
ok('回合制 foe 走 bossPortrait(boss.type)', /bossPortrait\(\s*boss\.type\s*\)/.test(foeBlock),
   (foeBlock.match(/img:[^\n]*/) || [''])[0]);
ok('回合制 foe 不再写死 PORTRAIT.foe', !/img:\s*PORTRAIT\.foe/.test(foeBlock),
   /img:\s*PORTRAIT\.foe/.test(foeBlock) ? '还写死着' : '');

// ————————————————————————— 汇总 —————————————————————————
console.log(`\nxx-play-feedback: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (fail) { console.log('失败项:'); bad.forEach(b => console.log('  - ' + b)); }
process.exit(fail ? 1 : 0);
