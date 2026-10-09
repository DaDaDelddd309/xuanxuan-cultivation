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
  // shoot/hurt/click/no/synergy 用 square 是**正确**的(短促高频)。
  // 本门禁不禁止它们,只确保没被一刀切全改成 triangle。
  t('shoot 仍是 square(短促音效,合理)', /shoot\(\)[^\n]*square/.test(SRC));
  t('click 仍是 square(短促音效,合理)', /click\(\)[^\n]*square/.test(SRC));
}

console.log('=== [4] 噪声塑形仍在(_noise 的滤波不能被删) ===');
t('_noise 仍使用 BiquadFilter', /_noise[\s\S]{0,600}createBiquadFilter/.test(SRC));

if (fail === 0) {
  console.log('\n✅ 音频门禁通过:BGM 低音圆润、musicBus 有滤波,蜂鸣根因已消除');
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 蜂鸣声会回来`);
  console.log('   判据:方波 3f/5f 谐波 + 持续铺底 + 无滤波 = 蜂鸣器');
}
process.exit(fail ? 1 : 0);