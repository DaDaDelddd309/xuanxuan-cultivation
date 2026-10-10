// tests/xx-village-tune-merge-regression.mjs —— merge/p0-village-tune 三处修复的回归门禁
// 运行: node tests/xx-village-tune-merge-regression.mjs
//
// 本门禁钉三处**已经在工作区修好、尚未 commit** 的缺陷。三处都不是平衡调整,
// 而是「静默失效」型缺陷 —— 共同点是:症状完全无声,不抛错、不掉帧、存档照样能读。
// 这类缺陷 90+ 门禁一条都拦不住,因为它们验的都是「接线对不对」,
// 而这三处的接线从头到尾都是**对的**,错的是值和下标。
//
// ① js/xiuxian/relations.js  Titles.load()
//    原: `if (r) this.s = JSON.parse(r);` —— 全仓**唯一**一个不做默认合并的 load
//    (craft / merchant / index / spine 全是 `{...默认, ...JSON.parse(r)}`)。
//    存档缺一个字段 → this.s 变残缺对象 → track() 里 `this.s.flags[action]` TypeError
//    → 称号系统永久卡死,且外层 catch 只包住 parse 那一步,track() 完全没有报错出口。
//    修: 默认合并 + 形状兜底(非对象复位 / flags 补 {} / active 非数组补 [])。
//
// ② js/xiuxian/build.js  place() / remove()
//    原: `this.s.placed.push(inst)`,slot 只当记录字段写进 inst。
//    但**数组下标就是位置** —— harvest / tickField / fieldYield / ui/build.js:31
//    全部用 `this.s.placed[i]` 寻址,全仓没有一处读 inst.slot。
//    于是 ui.js:463 那条链「玩家点第 v 号空位 → BUILD.place(inv[0], v) → 紧接着
//    BUILD.harvest(v)」在 placed.length ≠ v 时取到别的建筑(bid!=='bld_field' 挡下,
//    只是静默不生效)或 undefined —— 灵田自动下种静默失效。
//    修: place() 按请求下标 splice(idx, 0, inst),idx clamp 到 [0, placed.length];
//        remove() 在 splice 之后重排 slot 字段。
//
// ③ js/game/player.js  攻击成长公式的**注释**
//    原注释声称「总上限 ≈×2.84」,那个数不存在。公式数值**刻意没动**
//    (改公式 = 后期攻击 −43% 的大幅重平衡,已上报 owner 裁定,裁定前不许动),
//    只把注释订正成实测真相,并写明若要真拿到 ×2.84 该怎么改。
//
// ★ 本门禁钉**结构性质**,不钉平衡数字。
//   「存档缺 flags 时 track() 仍能正常计数」是结构性质;
//   「点第 v 号空位后 placed[v] 就是那栋建筑」是结构性质;
//// 「成长曲线无上界」是结构性质 —— 但「lv=60 攻击是 4.940」是平衡数字,
//   今天对、明天被 owner 一句话改掉就假红,所以**一条都不钉**。
//
// ★ 反向注入自检在文件末尾(第 4 节):三处修复各自回退,门禁必须变红。
//   这是本项目铁律「度量工具自己出错比没有度量工具更危险」的直接落实
//   (已连续栽 6 次)。没有这一节,上面所有断言都可能恒真。
//
// 退出码:0 = 通过;1 = 不通过;2 = 门禁自身失效(没读到节点 / 反向注入造不出变体) —— 别信结论。

import { install } from './harness.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- 浏览器环境:relations.js / build.js 经 assets.js 在**模块求值期**就摸
// document(音频解锁)。ESM 会把静态 import 提到所有语句之前,所以这里必须
// 用 tests/harness.mjs 的 install()(test-market / test-craft / test-tavern 同一套做法)
// + 动态 import —— 不是新发明,也不是我能自己挑的写法。
install();

const MEM = globalThis.localStorage._mem;   // harness 的内存 localStorage

const { Titles }        = await import('../js/xiuxian/relations.js');
const { BUILD }         = await import('../js/xiuxian/build.js');
const { Bag }           = await import('../js/xiuxian/items.js');
const { TIERS }         = await import('../js/xiuxian/bestiary.js');
const { Player }        = await import('../js/game/player.js');

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TITLE_KEY = 'xx_titles_v077';

let pass = 0, fail = 0;
const failed = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failed.push(name + (detail ? ' :: ' + detail : '')); console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`); }
}
// 只提醒、不拦路
const warn = (name, detail = '') => console.log(`  ⚠️  ${name}${detail ? '  — ' + detail : ''}`);

// 每节实际跑了多少个场景。为 0 → 该节等于没测 → exit 2。
const ran = { titles: 0, build: 0, comment: 0 };

// ───────────────────────────────────────────────────────────
console.log('=== ① Titles.load():存档缺字段时,track() 必须还能正常计数 ===');
{
  /** 把 Titles 复位成出厂态,并把 localStorage 塞成指定的原始字符串(raw=null 表示清空)。 */
  const seed = (raw) => {
    MEM.clear();
    if (raw !== null) MEM.set(TITLE_KEY, raw);
    Titles.s = { flags:{}, active:[] };
    return Titles.load();
  };

  // 核心场景:存档只有 active、没有 flags(= flags 字段是后加的,老存档就是这样)
  {
    ran.titles++;
    seed(JSON.stringify({ active:['jianfa'] }));
    t('缺 flags 时 load() 后 flags 是可用对象', Titles.s.flags && typeof Titles.s.flags === 'object');
    let threw = null;
    try { Titles.track('challenge', 30); } catch (e) { threw = e; }
    t('缺 flags 时 track() 不抛(TypeError 就是那个永久卡死的 bug)', !threw,
      threw ? `${threw.constructor.name}: ${threw.message}` : '');
    t('缺 flags 时 track() 真的把计数写进去了', Titles.s.flags.challenge === 30,
      `实际 challenge=${Titles.s.flags.challenge}`);
    // 计数可用 ⇒ 称号解锁链路仍然通(track → check → add)
    t('缺 flags 时解锁链路仍然通(jianfa 条件已满足)', Titles.has('jianfa') === true);
  }

  // 对称面:缺 active ⇒ add()/has()/list() 必须还能用
  {
    ran.titles++;
    seed(JSON.stringify({ flags:{ challenge:30 } }));
    t('缺 active 时 load() 后 active 是数组', Array.isArray(Titles.s.active));
    let threw = null;
    try { Titles.add('chizi'); } catch (e) { threw = e; }
    t('缺 active 时 add() 不抛', !threw, threw ? `${threw.constructor.name}: ${threw.message}` : '');
    t('缺 active 时 add() 真的加进去了', Titles.has('chizi') === true);
  }

  // 形状兜底:合并语义下,存档里显式写了脏值会**覆盖**掉默认值,
  // 光靠 {...this.s, ...parsed} 救不回来 —— 这正是加那三行 if 的原因。
  const dirty = [
    ['null(整个存档是 null)', 'null',            () => Titles.s && typeof Titles.s === 'object' && Titles.s.flags && Array.isArray(Titles.s.active)],
    ['flags:null',            '{"flags":null}', () => Titles.s.flags && typeof Titles.s.flags === 'object'],
    ['active 是字符串',        '{"active":"x"}', () => Array.isArray(Titles.s.active)],
    ['flags 是数字',           '{"flags":7}',    () => Titles.s.flags && typeof Titles.s.flags === 'object'],
    ['空对象',                '{}',             () => Titles.s.flags && Array.isArray(Titles.s.active)],
  ];
  for (const [label, raw, okShape] of dirty) {
    ran.titles++;
    seed(raw);
    t(`脏存档 ${label}:load() 之后形状仍合法`, !!okShape(),
      `得到 ${JSON.stringify(Titles.s)}`);
  }

  // 往返:正常存档 track → save → load,计数不能丢
  {
    ran.titles++;
    seed(null);
    Titles.track('spare', 7);
    Titles.load();                       // 真的走一遍 load(读的就是 MEM 里那条)
    t('往返:track → save → load 后计数仍在', Titles.s.flags.spare === 7,
      `实际 spare=${Titles.s.flags.spare}`);
  }
}

// ───────────────────────────────────────────────────────────
console.log('\n=== ② BUILD.place():点第 v 号空位,placed[v] 就该是那栋建筑 ===');
{
  /**
   * ⚠️ `placed` 必须走 getter,不能 `const P = BUILD.s.placed` 抓一次。
   * `reset()` 是 `BUILD.s.placed = []` —— **换了一个新数组**。
   * 我第一版抓了一次引用,于是 reset 之后 P 指着旧数组,后面 20 条断言全在测一个
   * 已经被丢弃的对象(place 全失败 → indexOf 返回 -1 → clamp 全「落在 -1」)。
   * 又一次「度量工具自己出错」:门禁红了 20 条,而生产代码是好的。
   * 症状很有欺骗性 —— 红得理直气壮,仿佛抓到 20 个 bug。所以这里留注释钉住。
   */
  const P = () => BUILD.s.placed;
  /** 复位领地到「最高阶位 + 空地」,保证 canPlace 的槽位上限不挡路(默认阶位只有 2 格)。 */
  const reset = () => {
    BUILD.s.placed = [];
    BUILD.s.tierLv = TIERS[TIERS.length - 1].lv;
    Bag.s.items = {};
  };
  const seedB = (ids) => {
    reset();
    for (const [i, bid] of ids.entries()) { Bag.add(bid, 1); BUILD.place(bid, i); }
  };

  /**
   * 复刻 ui/build.js:29-32 渲染格子的那一步 —— `for (let i=0;i<6;i++)`,
   * 跳过 i>=t.slots 的锁定格,`BUILD.s.placed[i]` 为空就渲染成可点的「＋」,data-v=i。
   * ui.js:463 收到的 v 就是这个 i。
   * ⚠️ 必须按 **slots()** 扫,不能按 placed.length 扫:length 是「已放几个」,
   *    而 UI 上第一个「＋」在 length 处 —— 两者恰好相等只在数组致密时成立,
   *    而数组一旦有洞(remove 之后)就不相等了,那正是本节要抓的形态。
   *    我第一版用 placed.findIndex((_,i)=>!P()[i]) —— findIndex 遍历到 length-1 为止,
   *    致密数组里根本找不到洞,直接返回 -1,place(bid,-1) 又被 clamp 成 0,
   *    于是「点第 0 号空位」测的其实是末尾追加。度量工具自己出错了,这正是要避免的。
   */
  const firstEmptySlot = () => {
    const n = BUILD.slots();
    for (let i = 0; i < n; i++) if (!BUILD.s.placed[i]) return i;
    return -1;   // 满了
  };

  // 核心场景:复刻 ui.js:463 —— 找第一个空位 v,放灵田,紧接着 harvest(v)
  {
    ran.build++;
    seedB(['bld_well', 'bld_tower']);
    const v = firstEmptySlot();
    t('能找到一个可点的空位(UI 前提)', v >= 0, `slots()=${BUILD.slots()} v=${v}`);
    Bag.add('bld_field', 1);
    const r = BUILD.place('bld_field', v);
    t('place() 返回 ok', r && r.ok === true, r && r.msg);
    t(`点第 ${v} 号空位后 placed[${v}] 就是那栋灵田`, P()[v] === r.inst && P()[v].bid === 'bld_field',
      `placed[${v}]=${P()[v] ? P()[v].bid : 'undefined'}`);
    // 这正是修复前静默失效的那一步
    const h = BUILD.harvest(v);
    t('紧接着的 harvest(v) 自动下种成功(修复前这里是 ok:false 静默失效)',
      h.ok === true && P()[v] && P()[v].plantAt > 0, `harvest → ${h.msg}`);
  }

  // 「有洞」形态:UI 上第 0 格显示的是建筑 A,但数组里 placed[0] 是空的 ——
  // 这种状态下 UI 传出来的 v 与「末尾」不再重合,回退版必然取错建筑。
  {
    ran.build++;
    reset();
    // ⚠️ 造洞必须用**下标赋值**,不能用 push ——
    //    `P().push(x)` 往空数组推,落点是 0,1,2,数组是致密的,压根没有洞。
    //    我第一版就是这么写的,于是这条断言 v=3 / len=3,「洞」根本没造出来,
    //    后面的断言测的还是末尾追加。下标赋值才会留下空洞(稀疏数组)。
    P()[1] = { bid:'bld_well', slot:1, workers:[], plantAt:0 };
    P()[2] = { bid:'bld_tower', slot:2, workers:[], plantAt:0 };
    P()[3] = { bid:'bld_market', slot:3, workers:[], plantAt:0 };
    const v = firstEmptySlot();
    t('先造出「placed 有洞」的状态(第 0 格为空)', v === 0 && !P()[0] && P().length === 4,
      `v=${v} len=${P().length}`);
    Bag.add('bld_field', 1);
    const r = BUILD.place('bld_field', v);
    t(`有洞时点第 ${v} 号空位,placed[${v}] 就是那栋灵田`,
      r.ok === true && P()[v] === r.inst && P()[v].bid === 'bld_field',
      `placed[${v}]=${P()[v] ? P()[v].bid : 'undefined'}`);
    const h = BUILD.harvest(v);
    t('有洞时 harvest(v) 也能自动下种(不再静默取到 bld_well 而失败)',
      h.ok === true && P()[v] && P()[v].plantAt > 0, `harvest → ${h.msg}`);
  }

  // 中间插入:放置顺序不得影响「下标即位置」
  {
    ran.build++;
    seedB(['bld_well', 'bld_tower', 'bld_market']);
    Bag.add('bld_field', 1);
    const r = BUILD.place('bld_field', 1);
    t('中间插入:placed[1] 就是新建筑', P()[1] === r.inst && P()[1].bid === 'bld_field',
      `placed[1]=${P()[1] && P()[1].bid}`);
    t('中间插入:新建筑自己的 slot 字段记的是真实下标', r.inst.slot === 1, `slot=${r.inst.slot}`);
    t('中间插入:后面的建筑被整体后移一位(没有覆盖丢件)',
      P().length === 4 && P()[2].bid === 'bld_tower' && P()[3].bid === 'bld_market',
      P().map((p, i) => `[${i}]${p.bid}`).join(' '));
    // 下标寻址(harvest/tickField/fieldYield 走的全部是这条路)拿到的必须是同一栋
    t('下标寻址取到的确实是同一栋(tickField 命中灵田)', !!BUILD.tickField(1),
      `tickField(1)=${JSON.stringify(BUILD.tickField(1))}`);
  }

  // 数组必须**致密**:UI 按 i 遍历 placed[i],有空洞就会出现「看得见的空位 + 看不见的洞」
  {
    ran.build++;
    seedB(['bld_well', 'bld_tower', 'bld_market']);
    Bag.add('bld_field', 1); BUILD.place('bld_field', 1);
    BUILD.remove(1); BUILD.remove(0); BUILD.remove(0);
    t('反复增删后 placed 仍致密(无空洞),下标寻址才不会取到 undefined',
      P().every((p, i) => p != null), `${P().length} 项`);
  }

  // clamp:非法下标不得越界,也不得静默插到界外
  {
    const cases = [
      ['负数', -5, 0], ['越界(远大于末尾)', 99, null], ['小数', 1.7, 1],
      ['数字串', '2', 2], ['NaN', NaN, null], ['undefined', undefined, null],
      ['null', null, null], ['非数字串', 'x', null],
    ];
    for (const [label, slot, want] of cases) {
      ran.build++;
      seedB(['bld_well', 'bld_tower']);
      Bag.add('bld_field', 1);
      const r = BUILD.place('bld_field', slot);
      const idx = P().indexOf(r.inst);
      const n = P().length - 1;
      const expect = want === null ? n : want;
      t(`clamp ${label} → 落到下标 ${expect}(共 ${n + 1} 项)`, idx === expect,
        `实际落在 ${idx}`);
    }
  }

  // remove():splice 之后必须重排 slot 字段
  {
    ran.build++;
    seedB(['bld_well', 'bld_tower', 'bld_market', 'bld_furnace']);
    BUILD.remove(1);
    t('remove() 之后 slot 字段整体重排,与真实下标一致',
      P().every((p, i) => p.slot === i),
      P().map((p, i) => `[${i}]${p.bid}(s=${p.slot})`).join(' '));
    t('remove() 只删目标那一栋,其余原序保留',
      P().length === 3 && P()[0].bid === 'bld_well' && P()[1].bid === 'bld_market' && P()[2].bid === 'bld_furnace',
      P().map((p, i) => `[${i}]${p.bid}`).join(' '));
  }
}

// ───────────────────────────────────────────────────────────
console.log('\n=== ③ player.js 攻击成长注释:不得再声称一个不存在的上界 ===');
{
  // 运行时曲线(结构性质:单调、无上界)。**不钉任何平衡数字** ——
  // 公式数值是 owner 的裁定范围,钉了就是给未来的平衡调整埋雷。
  const curveOf = (Mod) => {
    const p = new Mod.Player('knight');
    return lv => { p.level = lv; p.recalc(); return p.stats.might / CHARACTER_BASE; };
  };
  const CHARACTER_BASE = 1;   // knight 的 char.might = 1,故 stats.might 即倍率本身

  const curve = curveOf({ Player });
  let mono = true;
  for (let lv = 2; lv <= 120; lv++) if (curve(lv) <= curve(lv - 1)) { mono = false; break; }
  ran.comment++;
  t('攻击成长曲线在 1..120 级严格单调递增', mono, '出现持平/回落 ⇒ 存在上界或非线性截断');
  ran.comment++;
  t('成长曲线无上界(lv=120 明显高于 lv=60)',
    curve(120) > curve(60) * 1.2,
    `lv=60 → ${curve(60).toFixed(2)},lv=120 → ${curve(120).toFixed(2)}`);
  // 「总上限 ≈×2.84」是**被撤回的**论断:它在早期就已被突破。
  // 这里断言的是「那个上界不存在」这个结构事实,不是在认可某个平衡值。
  ran.comment++;
  let crossed = null;
  for (let lv = 25; lv <= 120 && crossed === null; lv++) if (curve(lv) > 2.84) crossed = lv;
  t('被注释撤回的「总上限 ×2.84」在真代码里确实不成立(早已被突破)',
    crossed !== null, '若这条不成立,说明公式已变,本节断言要重写');

  // 注释形态:钉「订正了什么」,不钉「写了哪几个字」。
  //
  // ⚠️ 这里刻意做成一个**可复用的判据函数** commentOK(),
  //    第 ④ 节的反向注入把同一份源码换成旧注释后,喂给同一个函数,
  //    断言它变 false —— 否则「自检」只是在测另一段临时代码,证明不了本节有牙齿。
  //
  //    ⚠️ 判据不能写成「源码里不含 ×2.84」:新注释为了说明「原来那个数不存在」,
  //    **必须**提到它。真正要禁的是「挂着 ×2.84 却没撤回」这种形态。
  const src = readFileSync(join(REPO, 'js/game/player.js'), 'utf8');
  const commentOK = (s) => {
    const mentions = /总上限\s*≈?\s*×?2\.84|×2\.84/.test(s);
    const retracts  = /那个数不存在|实测是错的|并不存在/.test(s);
    return {
      ok: !mentions || retracts,
      mentions, retracts,
      unbounded: /无界/.test(s),
      recipe: /Math\.min\(lv\s*-\s*1,\s*24\)/.test(s),
      pending: /裁定/.test(s),
    };
  };
  const c = commentOK(src);

  ran.comment++;
  t('注释若提到 ×2.84,必须同时撤回它(不许留成一句断言)',
    c.ok, c.mentions && !c.retracts ? '还挂着一句没有撤回的 ×2.84 断言' : '');
  ran.comment++;
  t('注释写明了真实现状是无界的', c.unbounded, '这是本次订正的核心事实');
  ran.comment++;
  t('注释写明了要真拿到 ×2.84 该怎么改(给出可执行配方)',
    c.recipe, '缺了配方,下一个人还得自己重推一遍');
  ran.comment++;
  t('注释写明该改动已上报 owner、裁定前不动数值',
    c.pending, '否则下一个人会「顺手把公式改了」—— 那正是不能做的重平衡');

  // 公式**数值**必须一个字节都没动(这次只订正注释)
  ran.comment++;
  const formula = (src.match(/const lvMight = .*/) || [''])[0];
  t('公式数值未被夹带修改(仍是无界的线性主项)',
    /\(lv\s*-\s*1\)\s*\*\s*0\.06/.test(formula) && /Math\.max\(0,\s*lv\s*-\s*25\)/.test(src),
    `公式行: ${formula.trim()}`);

  // 把判据函数挂出去,供第 ④ 节复用
  globalThis.__commentOK = commentOK;
}

// ───────────────────────────────────────────────────────────
console.log('\n=== ④ 反向注入自检:三处修复各自回退,门禁必须变红 ===');
{
  // 造一份「只回退这一处」的临时副本,和真模块同口径各跑一遍。
  // 全部在 mkdtemp 的副本里改 —— **真文件一个字节都不动**。
  const dir = mkdtempSync(join(tmpdir(), 'xxtune-'));
  /** 把相对 import 改写成绝对路径,否则副本移出仓库后找不到依赖。 */
  const absolutize = (s, fromDir) =>
    s.replace(/from '(\.\.?\/[\w./-]+?)(\?[^']*)?'/g,
      (_m, p, q) => `from '${join(REPO, fromDir, p)}${q || ''}'`);

  /** 写入变体并 import。返回 null 表示锚点变了 —— 老实认输,不瞎判。 */
  const variant = (relFile, fromDir, tag, edit) => {
    const src = readFileSync(join(REPO, relFile), 'utf8');
    const out = edit(src);
    if (out === null) return null;                 // 锚点没命中
    const f = join(dir, `${tag}.mjs`);              // 文件名带 tag,避免互相覆盖
    writeFileSync(f, absolutize(out, fromDir));
    return f;
  };

  try {
    // —— 回退 ①:Titles.load() 恢复成 `this.s = JSON.parse(r)` + 去掉三行形状兜底 ——
    {
      // ⚠️ 锚点必须是**整行、且带 xx_titles_v077 这个键**。
      //    我第一版锚点写成 `if (r) this.s = { ...this.s, ...JSON.parse(r) };` ——
      //    而 Nemesis.load()(同文件、更靠前)也是同一行字面量,
      //    replace 只替换**第一处** ⇒ 回退打在了 Nemesis 上,Titles 原封不动。
      //    于是变体表现完全正常,自检反而判「门禁恒真」。
      //    教训:反向注入的锚点不唯一时,门禁不会红,它会**假装自己有牙齿**。
      //    所以下面每一处替换都断言「恰好命中一次」。
      const TITLES_LINE =
        "try { const r = localStorage.getItem('xx_titles_v077'); if (r) this.s = { ...this.s, ...JSON.parse(r) }; } catch {}";
      const f = variant('js/xiuxian/relations.js', 'js/xiuxian', 'reverted-relations', (s) => {
        if (s.split(TITLES_LINE).length - 1 !== 1) return null;    // 必须恰好一处
        let out = s.replace(TITLES_LINE,
          "try { const r = localStorage.getItem('xx_titles_v077'); if (r) this.s = JSON.parse(r); } catch {}");
        for (const guard of [
          `    if (!this.s || typeof this.s !== 'object') this.s = { flags:{}, active:[] };\n`,
          `    if (!this.s.flags || typeof this.s.flags !== 'object') this.s.flags = {};\n`,
          `    if (!Array.isArray(this.s.active)) this.s.active = [];\n`,
        ]) {
          if (out.split(guard).length - 1 !== 1) return null;
          out = out.replace(guard, '');
        }
        // 复核:变体里确实不该再有合并写法
        if (out.includes('this.s = { ...this.s, ...JSON.parse(r) }; if (r)')) return null;
        return out;
      });
      if (!f) {
        warn('① 的反向注入造不出变体(锚点变了),本节未执行 —— 请人工确认',
          `找不到 "if (r) this.s = { ...this.s, ...JSON.parse(r) };" 或三行形状兜底`);
      } else {
        const { Titles: Old } = await import(f + '?t=' + Date.now());
        // 与上面 ① **完全同一口径**的探针(同样的脏存档、同样的 track 调用),
        // 只是 load() 换成了回退版。探针返回布尔,不做 truthy 包装 ——
        // 我第一版返回的是表达式原值(可能是 undefined),
        // 于是 `probe(...) === false` 判成了不成立,自检自己翻了车。
        const probe = (raw) => {
          MEM.clear();
          if (raw !== null) MEM.set(TITLE_KEY, raw);
          Old.s = { flags:{}, active:[] };
          Old.load();
          try { Old.track('challenge', 30); } catch { /* 回退版就崩在这 */ }
          return !!(Old.s && Old.s.flags && typeof Old.s.flags === 'object'
            && Old.s.flags.challenge === 30);
        };
        t('反向自检 ①:回退后「缺 flags 仍能计数」必须不成立(否则本门禁恒真)',
          probe(JSON.stringify({ active:['jianfa'] })) === false,
          '回退版 this.s 被整体替换成 {active:[...]} ⇒ flags 为 undefined ⇒ track 抛 TypeError 且计数丢失');
        t('反向自检 ①:回退后脏存档形状兜底必须失效',
          (() => { MEM.clear(); MEM.set(TITLE_KEY, '{"flags":null}');
            Old.s = { flags:{}, active:[] }; Old.load();
            return !!(Old.s.flags && typeof Old.s.flags === 'object'); })() === false);
      }
    }

    // —— 回退 ②:place() 恢复成 push,remove() 去掉 slot 重排 ——
    {
      const f = variant('js/xiuxian/build.js', 'js/xiuxian', 'reverted-build', (s) => {
        const splice = `    this.s.placed.splice(idx, 0, inst);`;
        const resync  = `    this.s.placed.forEach((p, k) => { p.slot = k; });\n`;
        if (!s.includes(splice) || !s.includes(resync)) return null;
        return s.replace(splice, '    this.s.placed.push(inst);').replace(resync, '');
      });
      if (!f) {
        warn('② 的反向注入造不出变体(锚点变了),本节未执行 —— 请人工确认',
          '找不到 "this.s.placed.splice(idx, 0, inst);" 或 remove() 的 slot 重排行');
      } else {
        const { BUILD: OldB } = await import(f + '?t=' + Date.now());
        // 同样是 getter —— setup() 里 `OldB.s.placed = []` 换的是新数组
        const OP = () => OldB.s.placed;
        const setup = () => {
          OldB.s.placed = [];
          OldB.s.tierLv = TIERS[TIERS.length - 1].lv;
          Bag.s.items = {};
          for (const [i, bid] of ['bld_well','bld_tower'].entries()) { Bag.add(bid, 1); OldB.place(bid, i); }
        };
        // 与 ② 同一口径的第一个空位算法(不能用 findIndex,理由见 ② 的注释)
        const firstEmpty = () => {
          for (let i = 0; i < OldB.slots(); i++) if (!OP()[i]) return i;
          return -1;
        };
        // ①「有洞」形态:0 号格空着,建筑挤在 1..2。
        //    ui/build.js:31 会把 0 号格渲染成可点的「＋」,data-v=0 → ui.js:463 传 v=0。
        //    回退版(push)把灵田落到末尾 2,placed[0] 仍是 undefined ⇒ harvest(0) 静默失效。
        setup();
        // setup() 已经把 0,1 占满了 —— 必须先 delete 出洞,再往 2 补一栋,
        // 否则数组是致密的,firstEmpty() 返回末尾,回退版的 push 恰好也对上,自检抓不到。
        delete OP()[0];
        OP()[2] = { bid:'bld_tower', slot:2, workers:[], plantAt:0 };
        const v = firstEmpty();
        Bag.add('bld_field', 1);
        const r1 = OldB.place('bld_field', v);
        t('反向自检 ②a:回退后「有洞时点第 v 号空位 → placed[v] 是那栋建筑」必须不成立',
          !(OP()[v] === r1.inst),
          `v=${v} 回退版 placed[${v}]=${OP()[v] ? OP()[v].bid : 'undefined'}(新建筑被 push 到了末尾)`);
        // ② 中间插入:请求下标 ≠ 末尾,回退版必然取到别人
        setup();
        Bag.add('bld_field', 1);
        const r2 = OldB.place('bld_field', 1);
        t('反向自检 ②b:回退后「中间插入 → placed[1] 是新建筑」必须不成立',
          !(OP()[1] === r2.inst), `回退版 placed[1]=${OP()[1] && OP()[1].bid}`);
        // ③ remove() 的 slot 重排:setup() 放的是 0,1 两条,remove(0) 后剩一条 slot=1
        setup();
        OldB.remove(0);
        t('反向自检 ②c:回退后「remove 后 slot 字段整体重排」必须不成立',
          !OP().every((p, i) => p.slot === i),
          OP().map((p, i) => `[${i}]${p.bid}(s=${p.slot})`).join(' '));
      }
    }

    // —— 回退 ③:把订正后的注释换回旧的那句「总上限 ≈×2.84」断言 ——
    {
      const src = readFileSync(join(REPO, 'js/game/player.js'), 'utf8');
      const cur = src.match(/\/\/ 攻击成长:25 级前每级[\s\S]*?\n(?=\s*const lvOver)/);
      if (!cur) {
        warn('③ 的反向注入造不出变体(锚点变了),本节未执行 —— 请人工确认',
          '找不到本次订正的注释块(以「// 攻击成长:25 级前每级」开头的那段)');
      } else {
        const OLD = '    // 攻击成长软上限:25 级前每级 +6%(25 级时 ×2.44),之后增量指数衰减,总上限 ≈×2.84\n'
                  + '    // —— 旧曲线 60 级即 ×4.5 且无界,配合强力被动后期乘区过高;现保住前期爽感、封住挂机乱杀\n';
        const reverted = src.replace(cur[0], OLD);
        // 喂**同一个**判据函数(第 ③ 节用的那个),证明它真有区分力
        const rc = globalThis.__commentOK(reverted);

        // ⚠️ 这里**不能**拿「源码里有没有『无界』二字」当区分力:
        //    旧注释里也有「旧曲线 60 级即 ×4.5 且无界」——
        //    那个『无界』说的是**被换掉的那条旧曲线**,不是当前这条。
        //    正因为如此,判据必须是「提到 ×2.84 ⇔ 同时撤回它」这种**成对**关系,
        //    单个关键词匹配在这里是没有牙齿的。这条我第一版写错过一次。
        t('反向自检 ③:回退后「提到 ×2.84 且未撤回」必须被判不合格(否则本门禁恒真)',
          rc.ok === false, `回退版 mentions=${rc.mentions} retracts=${rc.retracts}`);
        t('反向自检 ③:回退后「写明要真拿到 ×2.84 该怎么改」必须判不合格',
          rc.recipe === false, '旧注释只给了结论,没给配方');
        t('反向自检 ③:回退后「已上报 owner、裁定前不动数值」必须判不合格',
          rc.pending === false, '旧注释没提裁定,下一个人会直接改公式');
        t('反向自检 ③:回退版里「之后增量指数衰减」这句话确实回来了(证明该检查有区分力)',
          /之后增量指数衰减/.test(reverted) && !/之后增量指数衰减/.test(src),
          '现行源码里没有这句被证伪的因果表述,回退版里有 ⇒ 上面那条断言不是恒真');
        // 公式数值:回退注释不影响公式 —— 这条恒成立,记下来防止有人误以为回退会改数值
        t('反向自检 ③:回退注释不动公式数值(确认这是纯注释订正)',
          reverted.includes('const lvMight = 1 + (lv - 1) * 0.06 + 0.4 * (1 - Math.exp(-lvOver * 0.12));'));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────
console.log('\n=== 门禁自身有效性 ===');
{
  t('三节都真的跑了场景(没有任何一节读到 0 个节点)', ran.titles > 0 && ran.build > 0 && ran.comment > 0,
    `titles=${ran.titles} build=${ran.build} comment=${ran.comment}`);
  t('断言总数非 0', pass + fail > 20, `共 ${pass + fail} 条`);
  if (ran.titles === 0 || ran.build === 0 || ran.comment === 0) {
    console.log('\n❌ 有整节跑到 0 个场景 —— 门禁自身失效,别信结论');
    process.exit(2);
  }
}

if (fail === 0) {
  console.log(`\n✅ merge/p0-village-tune 三处修复全部钉住:${pass} 项`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 有修复退化了(或门禁自身判断有误):`);
  for (const f of failed) console.log(`   · ${f}`);
  process.exit(1);
}