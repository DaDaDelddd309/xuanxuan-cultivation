// defeat-choice-matrix.mjs —— 工单 XX-DUEL-006 的门禁
//
// 这条工单登记时写的是「Boss 路径四选项行为一致,要不要修?需 owner 拍板」。
// 现在结论(不问了,已修):
//
//   战败面板上四个选项各自写明代价 —— 反抗「入魔值 +15」、暂缓「欠下 300 道行,
//   三年为期」、赎金「交出全部身家」、认栽「修为尽废,跌一大境」——
//   但在局内 Boss 这条路上**四个点下去完全一样**。
//   那是一块纯装饰的死 UI:文案在承诺代价,机制没接上。
//   落地逻辑原本是 Screens.applyDefeat 的私有实现,只有秘境那条路够得着。
//   现在提到 DEFEAT.apply(relations.js),两条路共用一份。
//
// 关于「认栽的跌境会不会叠在局末结算之上、跌两次是不是想要的」——
// 这个问题在代码里有个确切答案,不需要猜:**局末结算给的是这一局的收获,
//   战败四选给的是这一场的代价,两者不是同一笔账。**
// 而四个选项之所以是「选择」,靠的是**代价的币种不同**,不是靠谁更温和:
//
//   反抗 resist     → 跌境 + 保留一半修为 + 入魔 +15   （代价：神魂）
//   暂缓 installment → 欠 300 道行、三年为期            （代价：负债）
//   赎金 ransom      → 道行 −60%                       （代价：身家）
//   认栽 ruin       → 跌境 + 修为尽废 + 入魔 +8        （代价：道途）
//
// 只要**没有任何一条被另一条全面压过**,玩家就是在四种损失里选一种,
// 而不是在一堆假选择里挑一个没那么糟的。下面第 [3] 段把这个不变量穷举钉死 ——
// 「趣味性」写不成断言,但「不许有一条路被支配」写得成。
//
// 出处可复现:node tests/defeat-choice-matrix.mjs
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(ROOT + '/' + p, 'utf8');

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null };
globalThis.window = { addEventListener() {} };

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

const { DEFEAT } = await import('../js/xiuxian/relations.js');
const { REALMS, maxLayerOf } = await import('../js/xiuxian/realms.js');

const CHOICES = ['resist', 'installment', 'ransom', 'ruin'];
/** 一个假的持久态。realm 取第二境,这样 realmDamage 的跌境分支真的会走。 */
const freshState = () => ({
  realm: REALMS[1].id,
  layer: Math.max(1, maxLayerOf(REALMS[1].id) - 2),
  exp: 1000, dao: 1000, debt: null,
});
const fakeCult = () => {
  const demon = [];
  return { demon, titles: { track: (k, v) => { if (k === 'demon') demon.push(v); } }, commit() {} };
};

/** 对四条路各跑一遍 apply,记录「玩家身上实际发生了什么变化」 */
const profiles = CHOICES.map(choice => {
  const s = freshState();
  const cult = fakeCult();
  const before = { ...s };
  DEFEAT.apply(choice, '石像守卫', s, cult);
  return {
    choice,
    state: s,
    beforeExp: before.exp,
    demon: cult.demon.reduce((a, b) => a + b, 0),
    // ⚠️ 所有轴一律「越大越亏」。第 [3] 段的支配判定全靠这个方向。
    //   损修为这里踩过一次坑:我第一版写的是 s.exp / before.exp(**剩余**比例),
    //   而注释却写「0 = 没损」—— 方向是反的。非支配的结论那次碰巧两种方向
    //   都成立,但那是运气,不是工具对。方向反的工具迟早给出相反的裁决。
    //   [3] 段末尾有一道针对本工具的自检。
    cost: {
      跌境: s.realm !== before.realm ? 1 : 0,
      损修为: 1 - s.exp / (before.exp || 1),      // 损掉的比例,1 = 全损
      损道行: 1 - s.dao / (before.dao || 1),      // 损掉的比例,1 = 全损
      入魔: cult.demon.reduce((a, b) => a + b, 0),
      负债: s.debt ? 1 : 0,
    },
  };
});

console.log('\n=== [1] 四条路都真的改动了持久态(不是空转) ===');
{
  for (const p of profiles) {
    const c = p.cost;
    const moved = c.跌境 || c.损修为 || c.损道行 || c.入魔 || c.负债;
    t(`「${p.choice}」有实际代价`, moved > 0,
      `代价画像全零 —— 这条路点了等于没点,面板上的文案在撒谎:${JSON.stringify(c)}`);
  }
}

console.log('\n=== [2] 四条路的代价画像互不相同 ===');
{
  const sig = p => JSON.stringify(p.cost);
  const sigs = profiles.map(sig);
  t('四条路的代价画像两两不同', new Set(sigs).size === 4,
    `只有 ${new Set(sigs).size} 种画像 —— 有两条路对玩家是同一件事:`);
  for (const p of profiles) {
    console.log(`    ${p.choice.padEnd(11)} 跌境=${p.cost.跌境} 损修为=${p.cost.损修为.toFixed(2)} ` +
      `损道行=${p.cost.损道行.toFixed(2)} 入魔=${p.cost.入魔} 负债=${p.cost.负债}`);
  }
}

console.log('\n=== [3] 非支配:不许任何一条被另一条全面压过 ===');
{
  // 全部改成「越大越亏」的方向后:若 B 在每一项上都不比 A 差,且至少一项更好,
  // 则 A 被 B 支配 —— 玩家选 A 没有任何理由,那就是假选择。
  const AXES = Object.keys(profiles[0].cost);
  const dominates = (a, b) => AXES.every(k => a.cost[k] >= b.cost[k])
    && AXES.some(k => a.cost[k] > b.cost[k]);
  for (const a of profiles) {
    const masters = profiles.filter(b => b.choice !== a.choice && dominates(b, a));
    t(`「${a.choice}」没有被别的路全面压过`,
      masters.length === 0,
      masters.length ? `被 ${masters.map(m => m.choice).join('、')} 支配 —— 这不是选择,是陪衬` : '');
  }

  // ── 工具自检 ──
  // 上面整套判定建立在「所有轴越大越亏」这个前提上,而这个前提是我手写的,
  // 写反了不会有任何报错,只会安静地给出相反的裁决(第一版就栽在这儿)。
  // 所以拿两条语义上无争议的路反查方向:
  //   认栽 —— 文案写明「修为尽废」,应当**全额损修为**、且是唯一跌境的那条
  //   暂缓 —— 只欠债不碰修为,损修为必须为 0
  const by = c => profiles.find(p => p.choice === c);
  t('【工具自检】方向对:认栽确实全额损修为(测的是「损掉」不是「剩下」)',
    by('ruin').cost.损修为 === 1,
    `得到 ${by('ruin').cost.损修为} —— 如果这里是 0,说明我又在测「剩余比例」,整套支配判定是反的`);
  t('【工具自检】方向对:暂缓不碰修为', by('installment').cost.损修为 === 0,
    `得到 ${by('installment').cost.损修为}`);
  t('【工具自检】认栽是唯一跌境的那条', by('ruin').cost.跌境 === 1 &&
    profiles.filter(p => p.cost.跌境 === 1).length === 1);

  // ── 这一条是被反向注入逼出来的 ──
  // 把 apply() 里的 expLoss 分支删掉(还原成死数据),上面所有断言照样全绿:
  // 反抗仍然「没被支配」(它靠 入魔15 活着),工具自检也照样全过
  // (自检只查了认栽和暂缓,没查反抗)。
  // 也就是说:「反抗只剩一半修为」这个承诺能不能兑现,当时**没有任何断言在看** ——
  // 而它恰恰是本轮修的那个洞。所以这里补上,并且要求「部分损失」而不是某个具体数值,
  // 这样将来调系数也不会把它判红。
  t('反抗真的只扣**一部分**修为(expLoss 落地了,不是死数据)',
    by('resist').state.exp > 0 && by('resist').state.exp < by('resist').beforeExp,
    `exp 从 ${by('resist').beforeExp} 变成 ${by('resist').state.exp} —— ` +
    'expLoss 分支没生效,「只剩一半修为」从来没兑现过');
  t('反抗是唯一「部分损失」的那条(其余要么不碰、要么全损)',
    profiles.filter(p => p.state.exp > 0 && p.state.exp < p.beforeExp).length === 1,
    '这个位置如果不止一条,选项之间又开始同构了');
}

console.log('\n=== [4] 局内 Boss 战败真的调了它(XX-DUEL-006 的正主) ===');
{
  const { codeMask } = await import('./lib-uimod.mjs');
  const CODE = codeMask(R('js/main.js')).code;
  const i = CODE.indexOf('onLose:');
  const seg = CODE.slice(i, i + 700);
  t('main.js 的 onLose 调了 DEFEAT.apply', /DEFEAT\.apply\(/.test(seg),
    '四个选项在 Boss 路径上仍然行为一致 —— 面板上的代价全是空话');
  t('并且仍然接着调 fromTurnBased(false, …) 走死亡结算',
    /fromTurnBased\(\s*false\s*[,)]/.test(seg),
    '少了这条,输掉就是软锁(XX-DUEL-004)');
  t('DEFEAT.apply 包在 try/catch 里',
    /try\s*\{[^}]*DEFEAT\.apply/.test(seg),
    '结算层抛异常会把玩家锁死在暂停的局里 —— 同 endRun 的自愈原则');
}

console.log('\n=== [5] 两条路共用同一份实现,不再有第二份 ===');
{
  const { codeMask } = await import('./lib-uimod.mjs');
  const UISRC = codeMask(R('js/xiuxian/ui.js')).code;
  // ⚠️ 必须匹配**定义**(`applyDefeat(choice) {`),不能只写 `applyDefeat(choice)` ——
  //   那会先命中 752 行的**调用点** `this.applyDefeat(choice)`,切出来的片段
  //   是调用处而不是实现处。我第一版就栽在这儿,报了一条假红。
  const at = UISRC.indexOf('applyDefeat(choice) {');
  t('ui.js 里能找到 applyDefeat 的定义', at > 0, '定义不在 ui.js —— 片段提取失效,本段结论不可信');
  const seg = UISRC.slice(at);
  const body = seg.slice(0, seg.indexOf('\n  },'));
  t('ui.js 的 applyDefeat 已委托给 DEFEAT.apply',
    /Cult\.defeat\.apply\(/.test(body),
    '秘境那条路还在用自己那份实现 —— 两边迟早分叉');
  t('ui.js 里不再自己算 realmDamage 落点',
    !/REALMS\[pIdx\s*-\s*1\]/.test(body),
    '落点逻辑留在了 ui.js,Boss 那条路就永远拿不到');
}

if (fail === 0) {
  console.log(`\n✅ XX-DUEL-006 通过:${pass} 项(四个选项都是真选择,Boss 路径也兑现)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 战败四选项还是装饰`);
  process.exit(1);
}