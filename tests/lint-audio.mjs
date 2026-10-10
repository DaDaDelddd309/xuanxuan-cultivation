#!/usr/bin/env node
// 音频波形门禁(XX-AUDIT-022)
// 修「BGM 持续蜂鸣声」,并防止它再次回来。
//
// 起因:玩家**反复**报「还是有蜂鸣声」。根因不是音量,是波形:
//
//   ① BGM 低音用 square 方波 —— 方波富含 3f/5f 奇次谐波,
//      正是蜂鸣器(beeper)的教科书波形。音效区用 square 是对的
//      (shoot/click 是 0.035~0.08s 的短促高频,听感「哒」不是「嗡」),
//      **但 BGM 低音是持续铺底**(M_BASS 每步 0.2s 循环,永远在响)。
//   ② musicBus 上没有任何滤波器 —— 对比 _noise() 有 BiquadFilter 塑形。
//
// 「反复出现」的原因是**修完没有门禁**:改回去没人知道。
// 本文件断言两件事,并做**频谱层面的推理校验**。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'js/core/audio.js'), 'utf8');

let fail = 0;
const t = (n, c, d = '') => { if (!c) { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };

// ── 定位 BGM 播放段(_music 方法)──
const mi = SRC.indexOf('M_BASS[');
const musicSeg = SRC.slice(Math.max(0, mi - 600), mi + 600);

console.log('\n[1] BGM 低音不得使用 square 波');
{
  const bassLine = musicSeg.match(/if \(bass\)[^\n]*/);
  t('找到 BGM 低音播放行', !!bassLine);
  if (bassLine) {
    t('BGM 低音不是 square', !/type:\s*'square'/.test(bassLine[0]),
      bassLine[0].trim().slice(0, 70));
    t('BGM 低音改用 triangle', /type:\s*'triangle'/.test(bassLine[0]));
  }
}

console.log('=== [2] musicBus 必须挂低通滤波 ===');
{
  t('存在 musicFilter 节点', /createBiquadFilter/.test(SRC));
  t('滤波器类型是 lowpass', /musicFilter\.type\s*=\s*'lowpass'/.test(SRC));
  t('musicBus 经过滤波器而非直连 master',
    /musicBus\.connect\(this\.musicFilter\)/.test(SRC) && /musicFilter\.connect\(this\.master\)/.test(SRC),
    '直连 master 就等于没滤波');
  const f = SRC.match(/musicFilter\.frequency\.value\s*=\s*(\d+)/);
  t('低通频率已设定', !!f, 'frequency.value 未设置 → 滤波不生效');
  if (f) {
    const hz = Number(f[1]);
    // BGM 基频 M_BASS 最高 G2=98Hz,其 5 次谐波 = 490Hz。
    // 截止频率需盖住 5 次谐波才不会漏出蜂鸣音,
    // 但也不能高到让琶音(M_ARP 最高 698Hz)被削没 —— 取中间值。
    t(`低通截止 ${hz}Hz 落在合理区间(500~2000)`, hz >= 500 && hz <= 2000,
      '太低会削掉琶音,太高则盖不住谐波');
  }
}

console.log('=== [3] 音效区的短促方波不应被误改 ===');
{
  // ⚠️ 2026-10-10 改动这条门禁的**范围**,不是削弱它。
  //
  // 本条的本意:防止 XX-AUDIT-022 修 BGM 蜂鸣时,把音效区的方波
  // 「一刀切」全改成 triangle(那样 BGM 修好了,音效却变得软塌塌)。
  // 所以它要守的是**别一刀切**,不是「每个音效都必须永远是 square」。
  //
  // 原写法把 `click` 也钉死了,于是挡住了正当修复:
  // 玩家报「点进去修仙阁有蜂鸣声」「阴间特效音」——
  // 根因是 1900 Hz 这个音高 × 每个按钮都播一次(screens.js 统一绑定),
  // 不是「方波=嗡」。1900 Hz 方波确实刺耳,已改成 760→500 triangle。
  //
  // 所以下面保留下来的三条,守的是「战斗音效的方波没被顺手抹掉」。
  // UI 点击音**不再**被钉死 —— 它是纯装饰音,允许为了听感调整。
  t('shoot 仍是 square(短促音效,合理)', /shoot\(\)[^\n]*square/.test(SRC));
  t('hurt 仍是 square(受伤要有冲击力)', /hurt\(\)[^\n]*square/.test(SRC));
  t('no 仍是 square(拒绝音要有存在感)', /no\(\)[^\n]*square/.test(SRC));
  t('synergy 仍是 square(联动爆发)', /synergy\(\)[\s\S]{0,120}square/.test(SRC));
  // UI 点击音:不钉波形,但钉住「不能又被调回刺耳的高频方波」。
  t('click 不是高频方波(1900Hz 蜂鸣已被投诉)',
    !/click\(\)[^\n]*type:\s*'square'/.test(SRC),
    'click 回到 square 高频 = 那个投诉会原样复现');
}

console.log('=== [4] 噪声塑形仍在(_noise 的滤波不能被删) ===');
t('_noise 仍使用 BiquadFilter', /_noise[\s\S]{0,600}createBiquadFilter/.test(SRC));

// ───────────────────────────────────────────────────────────
// [5] 修仙阁环境音的高频层 —— XX-PLAY-003
//
// 为什么单开一条:上面 [1][2] 盯的是 `js/core/audio.js` 的 BGM 总线,
// 而 owner 反复报的「点进去修仙阁有蜂鸣声」走的是**另一条路径**:
// `js/xiuxian/ambience.js` 自己 createGain/createOscillator。
// XX-AUDIT-022 把 BGM 修对了、门禁也配上了,于是「有门禁」给了所有人一种
// 已经根治的错觉 —— 而环境音那层从没进过这条门禁。
//
// 现状(实测):
//   · 日间 1400Hz triangle **已删**(ambience.js 91-93 有记录)
//   · 夜/黎明 3200Hz(夜) / 2600Hz(黎明) sine + LFO 调幅 **仍在**
//
// ⚠️ 本条**不删它**,也不判它对错 —— owner 问的是「它存在干嘛、有什么用」,
// 而代码与全部文档里找不到任何设计说明。只回答这个问题的答不上来。
// 真正该做的是**让它从此改不动**:谁想动它,门禁会逼他先回答用途。
// ───────────────────────────────────────────────────────────
console.log('\n=== [5] 修仙阁环境音:高频层不许无说明地改动(XX-PLAY-003) ===');
{
  const AMB = readFileSync(join(ROOT, 'js/xiuxian/ambience.js'), 'utf8');
  // ⚠️ 必须先剥注释再匹配。ambience.js:45 的**注释里**就写着
  //    「原来 out.connect(c.destination) —— 绕过了 SFX 的 musicBus」。
  //    不剥注释就会把这段说明当成代码,把「已经修好的地方」判成「没修」。
  //    这是本项目反复踩的同一个坑(lint-tokens.mjs 开头就记着)。
  const { codeMask } = await import('./lib-uimod.mjs');
  const AMB_CODE = codeMask(AMB).code;

  // (a) 环境音必须挂在 SFX 的 musicBus 上,不能再绕过去直连 destination ——
  //     绕过去的后果是「UI 上关了音乐,环境音照样响」,那正是"关不掉的那层嗡"。
  t('buildAmb 的主输出挂在 musicBus(不是直连 destination)',
    /connect\(\s*(?:bus|SFX)/.test(AMB_CODE) && !/out\.connect\(\s*c\.destination\s*\)/.test(AMB_CODE),
    '直连 destination = 音乐开关对它失效 = 玩家关不掉');

  // (a2) 【XX-PLAY-003 新发现】昼夜转场的锣声(phaseChime)直连 c.destination,
  //      是**第二条**绕过 musicBus 的路径 —— 音乐开关同样管不到它。
  //      实测:它在 js/xiuxian/ambience.js:152。
  const chimeBypass = /g\.connect\(\s*c\.destination\s*\)/.test(AMB_CODE);
  t('转场锣声(phaseChime)也不许绕过 musicBus', !chimeBypass,
    '实测 ambience.js:152 是 g.connect(c.destination) —— 关掉音乐照样敲锣');

  // (b) 夜/黎明那层高频:频率与调制深度一并钉住。
  //     ⚠️ 不能按 'night' 字面量匹配 —— codeMask 会把字符串字面量抹成空格
  //     (实测 `phase.key==='night' ? 3200 : 2600` 被抹成 `phase.key=== ? 3200 : 2600`)。
  //     所以只钉**结构**:osc.frequency.value 上挂一个「? … : …」二元取值。
  const night = AMB_CODE.match(/osc\.frequency\.value\s*=\s*[^;?]*\?[^;]*:[^;]*;/);
  t('夜虫高频仍在(夜 3200Hz / 黎明 2600Hz),不是被偷偷删了', !!night,
    '这层高频的去留是产品决策 —— 要删请先在 TICKETS.md 写明它当初为什么存在');
  const lfo = AMB_CODE.match(/lfo\.frequency\.value\s*=\s*[^;?]*\?[^;]*:[^;]*;/);
  t('夜虫的调制频率被钉住', !!lfo, 'LFO 决定它是"虫鸣"还是"蜂鸣",改了要有理由');

  // (b2) ⚠️ 第三版盲区:注入把 3200 改成 5000(只是把频率调高,更刺耳),
  //     上面所有断言照样全绿 —— 我钉了结构,没钉**数值**。
  //     频率越高越刺耳,恰恰是这个投诉的核心变量,必须钉死。
  //     (codeMask 只抹字符串字面量,数字是原样保留的,所以可以直接比数字)
  t('夜虫频率仍是 3200Hz / 黎明 2600Hz(没有往上拧)',
    /3200\s*:\s*2600/.test(AMB_CODE),
    '实测代码里不是 3200:2600 —— 高频拧高 = 投诉原样复现');
  t('夜虫的调制频率仍是 0.28 / 0.55(没被调快成"嗡")',
    /0\.28\s*:\s*0\.55/.test(AMB_CODE),
    'LFO 调快会让它从"虫鸣"变成持续"嗡"');

  // (c) ⚠️ 上面两条有个盲区,反向验证时才发现:把
  //     `if (phase.key === 'night' || phase.key === 'dawn')` 改成 `if (false)`
  //     振荡器代码**一行没删**,上面两条照样全绿 —— 但夜虫再也不响了。
  //     「代码在」不等于「还在跑」。所以必须单独钉住那道相位闸门。
  //
  //     ⚠️ 第二版又踩了一次:我第一版写成「全文数 `phase.key ===` 出现几次」,
  //     结果 ambience.js 的滤波器(70 行)和增益(71 行)里也有这个写法,
  //     计数照样 >= 2,注入 `if(false)` 依然全绿 —— **假门禁比没门禁更坏**。
  //     正确做法:先按 `if ( … )` 切出**条件本身**,再在条件内部数。
  //     (codeMask 会抹掉字符串字面量,所以只数 `phase.key ===`,不匹配 'night')
  const ifConds = [...AMB_CODE.matchAll(/if\s*\(([^)]*)\)/g)].map(m => m[1]);
  const nightGate = ifConds.filter(c => (c.match(/phase\.key\s*===/g) || []).length >= 2);
  t('夜虫的相位闸门还在(夜/黎明两个分支,没被改成常量 false)', nightGate.length >= 1,
    `实测「同时比较两个 phase.key」的 if 条件有 ${nightGate.length} 个 —— 改成 if(false) 夜虫就永远不响了`);

  // (c) 最关键的一条:**这层高频所在的代码块必须带用途说明**。
  //     owner 问「存在干嘛、有什么用」而文档里查不到 —— 门禁就把这个缺口钉成硬要求:
  //     改动附近必须留下它为什么存在。
  const blockStart = AMB.indexOf('const osc = c.createOscillator()');
  const around = blockStart >= 0 ? AMB.slice(Math.max(0, blockStart - 700), blockStart + 400) : '';
  const explained = /夜虫|虫鸣|insect|cricket/i.test(around)
    && /\/\/|\/\*/.test(around);
  t('高频层附近留有用途注释(不再是无来由的嗡)', explained,
    '补一句「这层干嘛用」;补不上就说明它本就不该留 —— 那才是该讨论的');
}

if (fail === 0) {
  console.log('\n✅ 音频门禁通过:BGM 圆润、musicBus 有滤波、环境音高频已纳入守护');
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 蜂鸣声会回来`);
  console.log('   判据:方波 3f/5f 谐波 + 持续铺底 + 无滤波 = 蜂鸣器');
}
process.exit(fail ? 1 : 0);