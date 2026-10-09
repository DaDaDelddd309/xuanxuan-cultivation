// 修为曲线模拟 —— 用项目自带的 harness 调真模块(工单 XX-BAL-001)
// 运行: node tools/art/sim_progress.mjs
import { install } from '../../tests/harness.mjs';
install();

const { Cult } = await import('../../js/xiuxian/index.js');
const { REALMS, layerCost } = await import('../../js/xiuxian/realms.js');

const KILLS = 122;            // 实测一局平均击杀
const EXP = 0.63;             // 与 index.js 里的指数保持一致
const TOTAL = {              // LAYER_COST 各段总和(用于估算打满一个大境界)
  qi: [50, 90, 150, 240, 360, 520, 720, 980, 1300, 1700, 2200],
  zhuji: [4000, 6500, 9500, 13500, 18500, 25000, 33000, 43000],
  jindan: [60000, 90000, 130000, 185000, 255000, 340000, 450000],
  yuanying: [600000, 900000, 1350000, 1900000, 2600000],
  huashen: [3500000, 5500000],
};

const s = Cult.get();
console.log('境界     层1成本    每局修为   累计局数   打满本境界');
console.log('-'.repeat(56));
let acc = 0;
for (const r of REALMS) {
  s.realm = r.id; s.layer = 1; s.exp = 0;
  const per = Math.round(KILLS * 2.5 * Math.pow((layerCost(r.id, 1) || 50) / 50, EXP));
  const need = TOTAL[r.id].reduce((a, b) => a + b, 0);
  const runs = Math.ceil(need / per);
  acc += runs;
  console.log(
    r.name.padEnd(7) +
    String(layerCost(r.id, 1)).padStart(9) +
    String(per).padStart(11) +
    String(acc).padStart(10) +
    String(runs).padStart(12) + ' 局');
}
console.log(`\n合计约 ${acc} 局到化神圆满（${(acc * 4 / 60).toFixed(0)} 小时纯修炼）`);
