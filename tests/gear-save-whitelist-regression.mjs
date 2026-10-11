// ===== 装备白名单门禁:save.js 的两份重复声明 ↔ gear.js 单一真源 =====
//
// 存在理由(为什么单独一条门禁,而不是塞进 gear-regression):
//   js/core/save.js 里**重复声明**了两份装备清单 —— VALID_GEAR(id 白名单)
//   与 GEAR_SLOT(id → 槽位)。它们必须和 js/game/gear.js 的 GEAR 完全一致,
//   而 save.js 不能反向 import gear.js(会把整个游戏层拖进 UI 层依赖链,方向反了),
//   所以**这份重复是故意的**,代价是:没有任何机制保证两边同步。
//
//   代价的具体形状(为什么危险到要单开一条门禁):
//     save.js:80  按 VALID_GEAR 白名单洗「穿着的」—— 不在白名单 → 清成 null
//     save.js:88  按 VALID_GEAR 白名单洗「背包里的」—— 不在白名单 → 静默剔除
//     save.js:94  「穿着的必须也在背包里」—— gearOwned 里没有 → 同样清成 null
//   ⇒ 有人往 gear.js 加了一件装备、只改一边,玩家下次 load() 时**那件装备被静默删除**:
//     不崩、不报错、没有任何提示,所有门禁全绿。纯数据层的错就是这么一路错到玩家身上。
//     这与 TICKETS.md 里 XX-AUDIT-006「存档金币 8888→30」是同一族事故(重复声明不同步)。
//
//   ⚠️ 本文件接的是一处**假注释**:save.js 的文件头原本写着
//     「两份列表若不一致,由 tests/gear-regression.mjs 的存档契约段报出来」——
//     实测 `grep -c 'core/save' tests/gear-regression.mjs` → 0,
//     那条存档契约段**从来不存在**。注释写着有门禁,不等于真的有门禁。
//     现在由本文件接手,save.js 的注释也已指向这里。
//
// 本门禁只读,不改任何文件、不碰存档。
//
// 为什么判据必须**双向**(本项目栽过的坑):
//   只判「save.js ⊆ gear.js」是**假绿** —— gear.js 加了新装备而 save.js 没跟上时,
//   那个子集关系依然成立,门禁会全绿,而玩家正在丢装备。反向同理。
//   所以 G1/G2 都拆成两条独立断言:多出来的、漏掉的,分别报。
//
// 写法沿用 gear-layout-regression 的规矩:parse/judge 写成**纯函数**(不碰磁盘),
//   先拿**合成样本**逼 judge() 两端都红(证明它有能力红),再判真实文件;
//   解析器在真实文件这一侧另有防退化下限 —— 拿不到该拿的量就 exit 2,
//   因为「空结果」和「干净结论」长得一模一样,而「没发现问题」比「发现问题」更危险。
//
// 运行: node tests/gear-save-whitelist-regression.mjs
//   0 = 通过
//   1 = 判出了问题(白名单不一致 / 槽位对不上)
//   2 = **门禁自身失效**(解析器退化或拿不到表,不产出结论 —— 别信结论)

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const SAVE_REL = 'js/core/save.js';
const GEAR_REL = 'js/game/gear.js';

/** 解析出的表至少要有这么多条,否则判定函数可能建立在「空解析」上。 */
const MIN = 4;

/** 门禁自身失效:不产出结论。 */
const die = (...m) => {
  console.log(`\n🛑 门禁自身失效:${m.join(' ')}`);
  console.log('   —— 别信结论:本次没有有效结论(EXIT=2,不是「通过」也不是「有问题」)。');
  process.exit(2);
};

// ════════════════════════════════════════════════════════════
// 纯函数区:解析 / 判定。不读磁盘,可被合成样本直接调用。
// ════════════════════════════════════════════════════════════

/** 剥注释,块注释与行注释都用**等量空格**替换 —— 保持行数不变,报错行号才可信。
 *  (逐行剥注释的老坑 gear-layout 记过:多行注释的中间行会整行漏过。) */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}

/** 从 open(开括号下标)起找配对的闭括号下标,带嵌套计数。 */
function matchBracket(s, open) {
  const pair = s[open] === '[' ? ['[', ']'] : ['{', '}'];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === pair[0]) depth++;
    else if (s[i] === pair[1] && --depth === 0) return i;
  }
  return -1;
}

/** 取出 `const <name> = [ ... ]` / `= { ... }` 的**内容部分**(不含外层括号)。
 *  找不到、或括号不配对,一律返回 null —— 绝不返回半个表。 */
function literalBody(src, name) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([\\[{])`);
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBracket(src, open);
  if (close < open) return null;
  return { text: src.slice(open + 1, close), open: open + 1 };
}

/** 源码 → {validGear:[{id,line}], validSlots:[{id,line}], gearSlot:{id:{slot,line}}} */
function parseSaveTables(src) {
  const clean = stripComments(src);
  const out = { validGear: [], validSlots: [], gearSlot: {} };

  const arr = name => {
    const b = literalBody(clean, name);
    if (!b) return [];
    // 引号 id;行号按 open 在**原文**里的位置算(剥注释不改行数,偏移可直接换算)
    return [...b.text.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => ({
      id: m[1] ?? m[2],
      line: clean.slice(0, b.open + m.index).split('\n').length,
    }));
  };

  out.validGear = arr('VALID_GEAR');
  out.validSlots = arr('VALID_SLOTS');

  const g = literalBody(clean, 'GEAR_SLOT');
  if (g) {
    for (const m of g.text.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*'([^']*)'/g)) {
      out.gearSlot[m[1]] = {
        slot: m[2],
        line: clean.slice(0, g.open + m.index).split('\n').length,
      };
    }
  }
  return out;
}

/**
 * 判定纯函数:两张表 vs 单一真源。
 * @param save {validGear:[{id,line}], validSlots:[{id,line}], gearSlot:{id:{slot,line}}}
 * @param gear {ids:[id], byId:{id:{slot}}, slots:[slotKey]}
 * @returns [{code,name,ok,detail}]
 */
function judge(save, gear) {
  const checks = [];
  const add = (code, name, ok, detail = '') => checks.push({ code, name, ok, detail });

  const saveIds = save.validGear.map(x => x.id);
  const gearIds = gear.ids;
  const saveSet = new Set(saveIds);
  const gearSet = new Set(gearIds);
  const lineOfGear = {};
  save.validGear.forEach(x => { lineOfGear[x.id] = x.line; });

  // —— G1 装备集合:两个方向各一条,少一条就是假绿 ——
  const extra = saveIds.filter(id => !gearSet.has(id));
  const missing = gearIds.filter(id => !saveSet.has(id));
  add('G1', 'G1a VALID_GEAR ⊆ GEAR:save.js 没有 gear.js 之外的野 id',
      extra.length === 0,
      extra.length ? extra.map(id => `${id}@save.js:${lineOfGear[id]}`).join(', ') : '');
  add('G1', 'G1b GEAR ⊆ VALID_GEAR:gear.js 每件装备都在 save.js 白名单里',
      missing.length === 0,
      missing.length
        ? missing.map(id => `${id}(玩家存档里的这件会在下次 load() 被 sanitize() 静默清掉)`).join(', ')
        : '');

  // —— G2 槽位映射:多出 / 少掉 / 逐项相等,三个方向缺一不可 ——
  // ⚠️ 野条目(GEAR_SLOT 里有、gear.js 没有的 id)也必须报出来,不能因为「它对无害」
  //    就跳过 —— 这张表是双写,双写的常态就是有一边忘了删,而「忘了删」正是本门禁要拦的形状。
  const slotIds = Object.keys(save.gearSlot);
  const slotExtra = slotIds.filter(id => !gearSet.has(id));
  const noEntry = gearIds.filter(id => !slotIds.includes(id));
  const wrongSlot = [];
  for (const id of slotIds) {
    if (!gearSet.has(id)) continue;              // 野条目由 G2a 单独报
    const got = save.gearSlot[id];
    if (gear.byId[id].slot !== got.slot) {
      wrongSlot.push(`${id}: save.js='${got.slot}'@save.js:${got.line} vs gear.js='${gear.byId[id].slot}'`);
    }
  }
  add('G2', 'G2a GEAR_SLOT 没有 gear.js 之外的野条目',
      slotExtra.length === 0,
      slotExtra.length ? slotExtra.map(id => `${id}@save.js:${save.gearSlot[id].line}`).join(', ') : '');
  add('G2', 'G2b GEAR_SLOT 不少掉:gear.js 每件装备都有槽位条目',
      noEntry.length === 0,
      noEntry.length ? `缺 ${noEntry.join(', ')}(equip() 会静默拒绝,装备进得了背包穿不上)` : '');
  add('G2', 'G2c 共同条目逐项相等:GEAR_SLOT 的槽位 = gear.js 的 slot 字段',
      wrongSlot.length === 0, wrongSlot.join('; '));

  // —— G3 槽位合法性 ——
  const badSlot = Object.entries(save.gearSlot)
    .filter(([, v]) => !gear.slots.includes(v.slot))
    .map(([id, v]) => `${id}→'${v.slot}'@save.js:${v.line}`);
  add('G3', 'G3a GEAR_SLOT 里每个 slot 值都在 gear.js 的 SLOTS key 集合内',
      badSlot.length === 0, badSlot.join(', '));

  // 顺带钉住 sanitize() 实际遍历的那张表:save.js 的 VALID_SLOTS 与 gear.js 的 SLOT_KEYS
  // 少一个 → 新槽位的存档项永远洗不掉;多一个 → 白洗一轮。两头都会静默。
  const wsExtra = save.validSlots.map(x => x.id).filter(s => !gear.slots.includes(s));
  const wsMiss = gear.slots.filter(s => !new Set(save.validSlots.map(x => x.id)).has(s));
  add('G3', 'G3b VALID_SLOTS 与 gear.js 的 SLOT_KEYS 双向一致',
      wsExtra.length === 0 && wsMiss.length === 0,
      [wsExtra.length ? `VALID_SLOTS 多出: ${wsExtra.join(',')}` : '',
       wsMiss.length ? `VALID_SLOTS 缺: ${wsMiss.join(',')}` : ''].filter(Boolean).join('; '));

  return checks;
}

// ════════════════════════════════════════════════════════════
// [G0] 读文件 + 解析。先证明门禁自己读到了东西,再谈结论。
// ════════════════════════════════════════════════════════════
console.log('\n=== [G0] 读真实文件 ===');

const savePath = join(ROOT, SAVE_REL);
if (!existsSync(savePath)) die(`${SAVE_REL} 不存在 —— 门禁没有可判的对象,退出 2。`);
const saveSrc = readFileSync(savePath, 'utf8');
const SAVE = parseSaveTables(saveSrc);

// gear.js 用**动态 import**:静态 import 在它解析失败时会抛栈、退出码 1 ——
// 而 1 在 CI 里和「查出问题」完全一样。动态 import 才能把「读不到真源」(2)
// 与「白名单对不上」(1) 分开。
let GEARM;
try {
  GEARM = await import('../js/game/gear.js');
} catch (e) {
  die(`js/game/gear.js 导入失败(${e.message}) —— 拿不到单一真源,退出 2。`);
}
const GEAR = { ids: GEARM.GEAR_IDS, byId: GEARM.GEAR, slots: GEARM.SLOT_KEYS };

console.log(`  ${SAVE_REL}:VALID_GEAR ${SAVE.validGear.length} 条,GEAR_SLOT ${Object.keys(SAVE.gearSlot).length} 条,VALID_SLOTS ${SAVE.validSlots.length} 条`);
console.log(`  ${GEAR_REL}:GEAR ${GEAR.ids.length} 件,SLOTS ${GEAR.slots.length} 个(${GEAR.slots.join(' ')})`);

// ════════════════════════════════════════════════════════════
// [G5] 判定函数反向自检:合成样本,与真实文件毫无关系。
//      真实代码当前是**一致**的,所以自检若绑在真实状态上会恒绿/恒红,两种都没意义。
// ════════════════════════════════════════════════════════════
console.log('\n=== [G5] 判定函数自检(合成样本,不碰真实文件) ===');
{
  const mkSave = (ids, slotObj, slots = ['head', 'body']) => ({
    validGear: ids.map(id => ({ id, line: 1 })),
    validSlots: slots.map(id => ({ id, line: 1 })),
    gearSlot: Object.fromEntries(Object.entries(slotObj).map(([k, v]) => [k, { slot: v, line: 1 }])),
  });
  const mkGear = () => ({
    ids: ['aa_thing', 'bb_thing', 'cc_thing'],
    byId: { aa_thing: { slot: 'head' }, bb_thing: { slot: 'body' }, cc_thing: { slot: 'head' } },
    slots: ['head', 'body'],
  });
  // ⚠️ GOOD_SLOT 保持**纯 {id: 槽位字符串}**,不要用已包装过的 GOOD.gearSlot 去 spread:
  //    mkSave 会再包一层 {slot,line},套两层后 v.slot 变成对象,
  //    于是每个样本都凭空多出 G2/G3 —— 第一版就是这么写错的,被下面「好样本判零问题」抓住。
  const GOOD_IDS = ['aa_thing', 'bb_thing', 'cc_thing'];
  const GOOD_SLOT = { aa_thing: 'head', bb_thing: 'body', cc_thing: 'head' };
  const GOOD = mkSave(GOOD_IDS, GOOD_SLOT);

  // 每项:[样本名, save, gear, 期望红到的码]
  // 期望零问题的样本必须真的判零问题 —— 否则「好样本混进假红」会被放过。
  const CASES = [
    ['好样本:两边一致', GOOD, mkGear(), []],
    // ↓ 这两条是本门禁存在的理由:单向包含是假绿
    ['save.js 多出一个 gear.js 没有的 id', mkSave([...GOOD_IDS, 'dd_ghost'], { ...GOOD_SLOT, dd_ghost: 'head' }), mkGear(), ['G1']],
    ['save.js 漏掉一件真实装备', mkSave(['aa_thing', 'bb_thing'], { aa_thing: 'head', bb_thing: 'body' }), mkGear(), ['G1', 'G2']],
    ['GEAR_SLOT 的槽位值被改', mkSave(GOOD_IDS, { ...GOOD_SLOT, bb_thing: 'head' }), mkGear(), ['G2']],
    ['GEAR_SLOT 少一条', mkSave(GOOD_IDS, { aa_thing: 'head', bb_thing: 'body' }), mkGear(), ['G2']],
    ['GEAR_SLOT 多出一条(gear.js 没有的 id)', mkSave(GOOD_IDS, { ...GOOD_SLOT, dd_ghost: 'head' }), mkGear(), ['G2']],
    ['VALID_GEAR 与 GEAR_SLOT 都多一条野 id', mkSave([...GOOD_IDS, 'dd_ghost'], { ...GOOD_SLOT, dd_ghost: 'head' }), mkGear(), ['G1', 'G2']],
    ['槽位值不在 SLOTS 里', mkSave(GOOD_IDS, { ...GOOD_SLOT, cc_thing: 'wing' }), mkGear(), ['G3']],
    ['VALID_SLOTS 少一个槽', mkSave(GOOD_IDS, GOOD_SLOT, ['head']), mkGear(), ['G3']],
  ];

  let selfFail = 0;
  for (const [name, save, gear, expect] of CASES) {
    const codes = [...new Set(judge(save, gear).filter(c => !c.ok).map(c => c.code))].sort();
    const hit = expect.length ? expect.every(e => codes.includes(e)) : codes.length === 0;
    if (!hit) selfFail++;
    console.log(`  ${hit ? '✅' : '❌'} ${name}:期望 ${expect.join(',') || '(零问题)'} → 实得 [${codes.join(',') || '干净'}]`);
  }

  // 解析器自检:好样本必须解析出料,注释里的表必须解析不出来。
  const SRC_SAMPLE = `
const VALID_SLOTS = ['head', 'body'];
const VALID_GEAR = [
  'aa_thing', 'bb_thing', 'cc_thing',
];
const GEAR_SLOT = {
  aa_thing:'head', bb_thing:'body', cc_thing:'head',
};
`;
  const p = parseSaveTables(SRC_SAMPLE);
  const parsedOk = p.validGear.length === 3 && p.validSlots.length === 2
    && Object.keys(p.gearSlot).length === 3 && p.gearSlot.bb_thing.slot === 'body';
  if (!parsedOk) { selfFail++; console.log(`  ❌ 解析器在合成样本上就退化了: ${JSON.stringify(p)}`); }
  else console.log(`  ✅ 解析器在合成样本上解析出 3 id / 2 slot / 3 映射(判定不是建立在空解析上)`);

  // 负向对照:把整张表塞进注释里,必须解析出 0 条 —— 否则注释掉的表会伪装成真表。
  const commented = SRC_SAMPLE.split('\n').map(l => '// ' + l).join('\n');
  const pc = parseSaveTables(commented);
  if (pc.validGear.length !== 0 || Object.keys(pc.gearSlot).length !== 0) {
    selfFail++;
    console.log(`  ❌ 注释里的表被当成了真表(${pc.validGear.length} 条)—— 解析器退化`);
  } else console.log('  ✅ 注释掉的表解析出 0 条(负向对照成立)');

  if (selfFail) die(`自检 ${selfFail} 项不过,判定函数已退化,不再判真实文件。`);
}

// ════════════════════════════════════════════════════════════
// [G4] 解析器防退化(真实文件这一侧):拿不到该拿的量就退出 2。
// ════════════════════════════════════════════════════════════
console.log('\n=== [G4] 解析器防退化(真实文件) ===');
{
  const counts = [
    [`${SAVE_REL} VALID_GEAR`, SAVE.validGear.length],
    [`${SAVE_REL} GEAR_SLOT`, Object.keys(SAVE.gearSlot).length],
    [`${GEAR_REL} GEAR_IDS`, GEAR.ids.length],
  ];
  const thin = counts.filter(([, n]) => n < MIN);
  // 下限刻意压低:MIN 只管「解析器退化了」,不管「装备数量变了」——
  // 数量由 gear-regression §1 断言,这里重复断言只会制造两个打架的真相来源。
  if (thin.length) {
    for (const [k, n] of thin) console.log(`  ❌ ${k} 只解析出 ${n} 条(下限 ${MIN})`);
    die(`有表解析到 ${thin.map(([k, n]) => `${k}=${n}`).join(', ')} —— 门禁自身失效,退出 2。`);
  }
  for (const [k, n] of counts) console.log(`  ✅ ${k} 解析出 ${n} 条(下限 ${MIN})`);
  if (!GEAR.slots.length) die('gear.js 的 SLOT_KEYS 为空 —— G3 会变成永真,退出 2。');
  console.log(`  ✅ SLOT_KEYS 解析出 ${GEAR.slots.length} 个(非空,G3 有判据)`);
}

// ════════════════════════════════════════════════════════════
// 真实判定
// ════════════════════════════════════════════════════════════
let pass = 0, fail = 0;
const report = list => {
  for (const c of list) {
    if (c.ok) { pass++; console.log(`  ✅ ${c.name}`); }
    else { fail++; console.log(`  ❌ ${c.name} — ${c.detail}`); }
  }
};

console.log('\n=== [G1] 装备集合:save.js 白名单 ↔ gear.js 真源(双向) ===');
const checks = judge(SAVE, GEAR);

// 逐条装备列出映射,报数量也报位置 —— 绿灯时也得让人一眼看出「比的是哪几件」
console.log('  (id → save.js:VALID_GEAR/GEAR_SLOT 槽位  vs  gear.js:槽位)');
for (const id of GEAR.ids) {
  const inWhitelist = SAVE.validGear.some(x => x.id === id);
  const g = SAVE.gearSlot[id];
  console.log(`    ${id.padEnd(16)} ${inWhitelist ? '✅白' : '❌缺'}  ${g ? `slot=${g.slot}@save.js:${g.line}` : '❌无槽位条目'}`
    + `  vs gear.js slot=${GEAR.byId[id].slot}`);
}
report(checks.filter(c => c.code === 'G1'));
console.log('\n=== [G2] 槽位映射:GEAR_SLOT ↔ gear.js 的 slot 字段(双向) ===');
report(checks.filter(c => c.code === 'G2'));
console.log('\n=== [G3] 槽位合法性 ===');
report(checks.filter(c => c.code === 'G3'));

const total = pass + fail;
if (fail === 0) {
  console.log(`\n✅ 白名单门禁通过:${GEAR.ids.length} 件装备 / ${Object.keys(SAVE.gearSlot).length} 条槽位映射,双向一致(${total} 条断言全绿)`);
  console.log('   提醒:这份一致性**由本文件守着**。往 gear.js 加装备时,save.js 的 VALID_GEAR 与 GEAR_SLOT 必须同步改 ——');
  console.log('   只改一边时玩家存档里那件装备会在下次 load() 被静默删除(save.js:80 / :88 / :94)。');
  process.exit(0);
} else {
  console.log(`\n❌ ${fail}/${total} 条断言不达标 —— 装备白名单与真源不同步,玩家存档会被静默删装备`);
  console.log('   最小修法:把 save.js 的 VALID_GEAR / GEAR_SLOT 改成与 gear.js 完全一致(逐项,不要只补一边)。');
  process.exit(1);
}