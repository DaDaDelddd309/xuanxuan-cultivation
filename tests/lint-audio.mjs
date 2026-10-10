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

  // (b) 【XX-AUDIO-004 已反转】夜/黎明那层高频**已删除**。
  //
  //   这组断言从第一版起就在钉「3200/2600 不许被偷偷删掉」,还经历三轮返工
  //   (钉结构 → 钉数值 → 钉相位闸门)才做到无盲区。现在 owner 授权我决定
  //   (TICKETS.md XX-AUDIO-004),结论是删:
  //     · 来历只有 CHANGELOG.md:901 的「WebAudio 实时合成、零外部音频文件」——
  //       那是实现手段,不是产品理由
  //     · 同一文件里已有一声 1400Hz 因「听起来就是蜂鸣」被删的先例,
  //       夜虫 3200Hz 比它还高 2.3 倍,波形还是更"电子"的纯 sine
  //     · LFO 0.28Hz 让它每 3.6 秒涨落一次 = 周期性蜂鸣,不是虫鸣脉冲
  //
  //   断言从「必须在」反转成「必须不在」。
  //   用 AMB_CODE(已剥注释)判定:解释删除理由的注释里写着 3200/2600,
  //   原始源码会误伤,codeMask 抹掉注释后才不会 —— 这正是该工具的用途。
  // ⚠️ 下面这些「必须不在」的判定,只扫 buildAmb() 函数体 ——
  //   ambience.js 里还有 phaseChime(转场锣声),它也用 createOscillator,
  //   而且**必须留着**(XX-PLAY-003 刚修好它绕过 musicBus 的问题)。
  //   全文件扫会把正当组件误判成「夜虫没删干净」—— 范围要收准。
  const baStart = AMB_CODE.indexOf('function buildAmb');
  const baEnd = AMB_CODE.indexOf('phaseChime', baStart);
  const buildAmb = baStart >= 0 ? AMB_CODE.slice(baStart, baEnd > baStart ? baEnd : AMB_CODE.length) : '';
  t('找得到 buildAmb 函数体(判定范围)', buildAmb.length > 100, `${buildAmb.length} 字符`);

  t('夜虫高频已删除(osc.frequency 上不再有 ?/: 二元取值)',
    baStart < 0 || !/osc\.frequency\.value\s*=\s*[^;?]*\?[^;]*:[^;]*;/.test(buildAmb),
    'XX-AUDIO-004 已定删除;要恢复先改 TICKETS.md 的结论');
  t('3200/2600 这组频率不在 buildAmb 里了', baStart < 0 || !/3200\s*:\s*2600/.test(buildAmb),
    '实测 buildAmb 内仍有 3200:2600 —— 夜虫没删干净');
  t('LFO 的 0.28/0.55 调制不在 buildAmb 里了', baStart < 0 || !/0\.28\s*:\s*0\.55/.test(buildAmb),
    '调制还在 = 那层振荡器没删干净');
  t('buildAmb 里那个高频振荡器块整体没了',
    baStart < 0 || !/const osc = c\.createOscillator\(\)/.test(buildAmb),
    '实测 buildAmb 内仍有 const osc = c.createOscillator()');

  // 转场锣声必须还在 —— 它和夜虫是两回事,不能顺手删掉。
  t('转场锣声 phaseChime 仍在(与夜虫无关,别顺手删)',
    /function phaseChime/.test(AMB_CODE), 'XX-PLAY-003 刚修好它的 musicBus 接线');

  // (b2) 删除必须有据可查:门禁原来要求「改动附近留用途注释」,
  //      现在反过来 —— 必须能在 TICKETS.md 查到删除结论和理由,
  //      否则就是「静默删音频」,下一个人会以为它从来不存在。
  let tickTxt = '';
  try { tickTxt = readFileSync(ROOT + '/TICKETS.md', 'utf8'); } catch {}
  t('TICKETS.md 写明了夜虫的来历与删除理由(不是静默删除)',
    /XX-AUDIO-004/.test(tickTxt) && /夜虫/.test(tickTxt) && /CHANGELOG\.md:901/.test(tickTxt),
    '补上:它当初为什么存在 + 凭什么判定该删');

  // (b3) ⚠️ 反过来也要防「删过头」:风声底噪才是承载「昼夜不同」的那一层。
  //      夜虫删了它必须还在 —— 否则就是把整个氛围音删掉换一片绿。
  t('风声底噪仍在(没把整个氛围音删掉换绿)',
    /createBufferSource/.test(AMB_CODE) && /src\.connect\(\s*f\s*\)/.test(AMB_CODE),
    '布朗噪声 + 滤波那段没了 = 昼夜感知也没了,那是删过头');
  t('昼夜频率分档仍在(夜/晨昏/昼 三档)',
    /\b320\b/.test(AMB_CODE) && /\b500\b/.test(AMB_CODE) && /\b700\b/.test(AMB_CODE),
    '昼夜三档频率不见了 —— 风声底噪不该被动');
}

if (fail === 0) {
  console.log('\n✅ 音频门禁通过:BGM 圆润、musicBus 有滤波、环境音高频已纳入守护');
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 蜂鸣声会回来`);
  console.log('   判据:方波 3f/5f 谐波 + 持续铺底 + 无滤波 = 蜂鸣器');
}
process.exit(fail ? 1 : 0);