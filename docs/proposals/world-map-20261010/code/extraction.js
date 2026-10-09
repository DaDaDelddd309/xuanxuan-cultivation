// ===== 搜打撤(Extraction)· 状态机与结算 =====
//
// ⚠️ 先说清楚这个系统在项目里的位置:
//   项目**已经有**砍杀局(main.js startRun)和背包(items.js Bag)。
//   本文件**不重写任何一个**,只在其上加一层「带什么出去 / 带什么回来」。
//
// 它要解决的唯一问题:现在一局砍杀是**纯增益**的 ——
// 打死就掉,打死不掉,背包是单向的。所以时间一长,背包只会越来越大,
// 失败没有任何代价,搜打撤的紧张感不存在。
//
// 本文件让「带出去」变成一个需要**主动承担风险**的动作。
//
// 三条命脉(缺一条就不成立):
//   1. **有限时间**  —— extractBy 到点就强制结算
//   2. **有限容量**  —— stash.cap 满了带不走更多
//   3. **会失去东西** —— 死了 secured 全没
//
// 最容易做错的地方(也是本文件反复强调的):
//   **extract_fail ≠ death。**
//   失败撤离 = 东西丢了但人活着,还能再来一局;
//   死亡     = 人没了,额外掉装备耐久/雇工/声望。
//   把两者合并成一个「失败」是搜打撤设计里最常见的致命简化 ——
//   它让「再试一次」没有代价,于是玩家最优解变成永不撤离。
//   (对,永不撤离、死在半路,收益比成功撤离还高。这条路一开,搜打撤就死了。)

// ───────────────────────────────────────────────────────────
// 一、常量
// ───────────────────────────────────────────────────────────

/** 出击窗口。0.5 秒一次判定,够灵敏又不至于刷屏。 */
export const TICK_MS = 75 * 1000;

/** 一次出击的默认时限:6 个行动点 = 450 秒现实时间。 */
export const RAID_WINDOW_TICKS = 6;

/** 保价赔付率。玩家付保费,把「全损」换成「六折」。 */
export const INSURE_PAYOUT = 0.6;

/** 保价费率:按估值收 8%。 */
export const INSURE_PREMIUM = 0.08;

/** 仓库默认格子。**必须有上限**,否则搜打撤只剩时间一条命脉。 */
export const STASH_CAP = 30;

/** 撤离点:哪些节点类型能作为撤离目标。 */
export const EXTRACT_TYPES = new Set(['outpost', 'village', 'gate']);

// ───────────────────────────────────────────────────────────
// 二、携带物建模
// ───────────────────────────────────────────────────────────

/**
 * 三个槽位类别。整��搜打撤的规则表就是这 3 行:
 *
 *   类别     带出去   失败撤离   死亡        为什么
 *   ──────  ────────  ────────  ──────────  ──────────────────
 *   secured  赚       全没       全没        核心赌注。丢了才疼。
 *   insured  赚       全没       赔 60%      贵的货的安全网,但要交 8% 保费。
 *   keep     不算     保住       保住        装备/功法/身份牌。永不作为战利品损失。
 *
 * `keep` 的存在不是仁慈,是**防滚雪球归零**:
 * 没有它,连输三把就彻底重开,玩家会直接删档。
 *
 * @typedef {'secured'|'insured'|'keep'} SlotKind
 */

/** 新的空出击单。 */
export function newRaid({ id, originNode, targetNode, region }) {
  return {
    id, state: 'prepare',
    originNode, targetNode, region,
    loadout: { secured: [], insured: [], keep: [], mates: [], mateHp: 100 },
    deployedAt: 0, extractBy: 0, ticksLeft: RAID_WINDOW_TICKS,
    kills: 0, looted: {}, hpRatio: 1,
    result: null,
  };
}

// ───────────────────────────────────────────────────────────
// 三、状态机
// ───────────────────────────────────────────────────────────

/**
 * 合法迁移表。**故意显式写出来**,不要用 if/else 散落各处。
 *
 *   prepare ──deploy()──> deployed ──begin()──> in_run
 *      ▲                      │                    │
 *      │(cancel,全额退回)     │                    ├──extractSuccess()──> extract_success ●
 *      └──────────────────────┘                    ├──extractFail()─────> extract_fail    ●
 *                                                  └──death()───────────> death           ●
 *                                              ● = 终态,不可再迁出
 *
 * @type {Object.<string, string[]>}
 */
export const TRANSITIONS = {
  prepare:         ['deployed'],
  deployed:        ['prepare', 'in_run'],
  in_run:          ['extract_success', 'extract_fail', 'death'],
  extract_success: [],   // 终态
  extract_fail:    [],   // 终态
  death:           [],   // 终态
};

export const TERMINAL = new Set(['extract_success', 'extract_fail', 'death']);

/** 迁移是否合法。非法迁移返回 {ok:false} 而不是静默放行。 */
export function canTransit(from, to) {
  if (TERMINAL.has(from)) return { ok:false, reason:`${from} 是终态` };
  if (!(TRANSITIONS[from] || []).includes(to)) return { ok:false, reason:`${from} → ${to} 非法` };
  return { ok:true };
}

/** 当前出击单处于什么状态。null = 不在局内。 */
export function stateOf(raid) {
  return raid ? raid.state : null;
}

// ───────────────────────────────────────────────────────────
// 四、仓库(Stash)
// ───────────────────────────────────────────────────────────

/**
 * 仓库 = 存在某个节点上的家当。
 *
 * 为什么仓库和背包必须分开(而不是共用一个 Bag):
 *   Bag 是「随身」,会被打劫(死亡丢 secured);
 *   Stash 是「放着的」,只受容量限制,不受死亡影响。
 *   两者混一个,搜打撤就没有意义了 —— 你只是带了个标签的背包。
 *
 * 结构刻意与 Bag 同构({items:{}}),这样搬运是纯赋值,不需要转换层。
 *
 * @param {string} nodeId
 * @param {Object} [init]
 * @returns {import('./types.js').Stash}
 */
export function newStash(nodeId, init = {}) {
  return { id: nodeId, nodeId, items: init.items || {}, cap: init.cap ?? STASH_CAP, lastVisitAt: 0 };
}

/** 仓库用了多少格。items 里每个 key 算一格(合并同类)。 */
export function stashUsed(stash) {
  return Object.keys(stash?.items || {}).length;
}

export function stashFree(stash) {
  return Math.max(0, (stash?.cap ?? STASH_CAP) - stashUsed(stash));
}

/**
 * 存进去。满格则拒绝。
 * @returns {{ok:boolean, msg:string}}
 */
export function stashPut(stash, itemId, n = 1) {
  if (!(itemId in stash.items) && stashFree(stash) <= 0) {
    return { ok:false, msg:'仓库满了。' };
  }
  stash.items[itemId] = (stash.items[itemId] || 0) + n;
  return { ok:true, msg:`存入 ${itemId}×${n}` };
}

export function stashTake(stash, itemId, n = 1) {
  const have = stash.items[itemId] || 0;
  if (have < n) return { ok:false, msg:'仓库里没有那么多。' };
  stash.items[itemId] = have - n;
  if (stash.items[itemId] <= 0) delete stash.items[itemId];
  return { ok:true, msg:`取出 ${itemId}×${n}` };
}

// ───────────────────────────────────────────────────────────
// 五、部署(出仓)
// ───────────────────────────────────────────────────────────

/**
 * 把背包里的东西**锁进**出击单,并交保价费。
 *
 * 注意「锁」这个字:deploy 之后 loadout 就冻结了,中途不能改。
 * 这是搜打撤的第二条命脉 —— 如果出击后还能回仓取货,
 * 那玩家就会在死亡前反复往返,提取压力归零。
 *
 * @param {import('./types.js').Raid} raid
 * @param {Object} bag  items.js 的 Bag.s({items,demon,charter})
 * @param {Object} [opts]
 * @returns {{ok:boolean, msg:string}}
 */
export function deploy(raid, bag, opts = {}) {
  const t = canTransit(raid.state, 'deployed');
  if (!t.ok) return t;

  const secured = opts.secured || [];
  const insured = opts.insured || [];
  const keep    = opts.keep || [];

  // 1) 校验:出发前先把「买不起单子」的判定掉,不要到死的那一刻才发现
  const items = (bag?.items) || {};
  const missing = [];
  const spend = [...secured, ...insured];
  const need = {};
  for (const s of spend) need[s.itemId] = (need[s.itemId] || 0) + s.n;
  for (const [id, n] of Object.entries(need)) {
    if ((items[id] || 0) < n) missing.push(`${id} 差 ${n - (items[id] || 0)}`);
  }
  if (missing.length) return { ok:false, msg:'东西不够:' + missing.join('、') };

  // 2) 扣保费(insured 按估值 8%)—— 先扣,不是死亡时才扣。
  //    「保了才敢带」和「死了才收钱」是两种完全不同的经济。
  const premium = insured.reduce((a, s) => a + Math.round((s.value || 0) * INSURE_PREMIUM), 0);
  if (premium > 0) {
    const cur = items.stone_1 || 0;
    if (cur < premium) return { ok:false, msg:`保价费 ${premium} 源石,不够` };
    items.stone_1 = cur - premium;
  }

  // 3) 从背包扣除 → 锁进 loadout
  for (const [id, n] of Object.entries(need)) items[id] = (items[id] || 0) - n;

  raid.loadout.secured = secured.map(s => ({ ...s, kind:'secured' }));
  raid.loadout.insured = insured.map(s => ({ ...s, kind:'insured' }));
  raid.loadout.keep   = keep.slice();
  raid.loadout.mates  = (opts.mates || []).slice();

  raid.state = 'deployed';
  raid.deployedAt = Date.now();
  raid.extractBy = raid.deployedAt + RAID_WINDOW_TICKS * TICK_MS;
  raid.ticksLeft  = RAID_WINDOW_TICKS;
  return { ok:true, msg:`已出发。${raid.ticksLeft} 次行动内必须撤离。` };
}

/** 未出发就反悔:全额退回。 */
export function cancel(raid, bag) {
  const t = canTransit(raid.state, 'prepare');
  if (!t.ok) return t;
  const items = (bag?.items) || {};
  for (const s of [...raid.loadout.secured, ...raid.loadout.insured]) {
    items[s.itemId] = (items[s.itemId] || 0) + s.n;
  }
  raid.loadout = { secured:[], insured:[], keep:[], mates:[], mateHp:100 };
  raid.state = 'prepare';
  return { ok:true, msg:'取消,原物退回。' };
}

// ───────────────────────────────────────────────────────────
// 六、结算
// ───────────────────────────────────────────────────────────

/**
 * 核心结算。三个终态都走这里,只有 payout 不同。
 *
 * @param {import('./types.js').Raid} raid
 * @param {'success'|'fail'|'death'} outcome
 * @param {Object} bag items.js 的 Bag.s
 * @param {Object} [opts]
 * @param {Object} [opts.stash] 撤离点上的仓库(success 时存进去)
 * @returns {{ok:boolean, msg:string, result:Object}}
 */
export function settle(raid, outcome, bag, opts = {}) {
  const target = { success:'extract_success', fail:'extract_fail', death:'death' }[outcome];
  const t = canTransit(raid.state, target);
  if (!t.ok) return { ok:false, msg:t.reason, result:null };

  const items = (bag?.items) || {};
  const { secured = [], insured = [], keep = [] } = raid.loadout;
  const kept = [], lost = [];

  // 局内拾取物:永远属于「带出来才算」的那一类
  const looted = Object.entries(raid.looted || {})
    .map(([itemId, n]) => ({ kind:'secured', itemId, n }));
  const pool = [...secured, ...insured, ...looted];

  if (outcome === 'success') {
    for (const s of pool) {
      if (opts.stash) {
        // 有仓库就先存仓库 —— 这是「带出来」的正规路径
        stashPut(opts.stash, s.itemId, s.n);
      } else {
        items[s.itemId] = (items[s.itemId] || 0) + s.n;
      }
      kept.push(s);
    }
  } else if (outcome === 'fail') {
    // 失败撤离:东西全丢,人没事。可以再来一局。
    lost.push(...pool);
  } else {
    // 死亡:secured 全丢;insured 赔 60%。keep 永不作为战利品损失。
    for (const s of secured) lost.push(s);
    for (const s of insured) {
      const back = Math.floor(s.n * INSURE_PAYOUT);
      if (back > 0) {
        items[s.itemId] = (items[s.itemId] || 0) + back;
        kept.push({ ...s, n:back, note:`保价赔 ${back}` });
      }
      if (back < s.n) lost.push({ ...s, n:s.n - back, note:'保价后仍有损失' });
    }
    for (const s of looted) lost.push(s);
    // 死亡额外的、搜打撤特有的损失(钩子,具体见 integration.md §4.4)
    if (raid.loadout.mates?.length) {
      lost.push({ kind:'insured', itemId:'__mate__', n:raid.loadout.mates.length,
                  note:'雇工折损' });
    }
  }

  raid.state = target;
  raid.result = {
    outcome, reason: opts.reason || '',
    kept, lost,
    exp: outcome === 'death' ? 0 : Math.round(raid.kills * 12),
    dao: outcome === 'death' ? 0 : Math.round(raid.kills * 4),
  };
  raid.loadout = { secured:[], insured:[], keep, mates: [], mateHp: 0 };
  raid.looted = {};

  const msg = outcome === 'success' ? `撤出,带回 ${kept.length} 项`
            : outcome === 'fail'    ? '撤离失败,物资尽失 —— 但你活着。'
            :                         `死了。损失 ${lost.length} 项。`;
  return { ok:true, msg, result:raid.result };
}

/** 成功撤离。必须已经站在撤离点上。 */
export function extractSuccess(raid, bag, opts = {}) {
  if (!EXTRACT_TYPES.has(opts.nodeType)) {
    return { ok:false, msg:'这里不是撤离点。' };
  }
  return settle(raid, 'success', bag, opts);
}

/** 撤离失败(超时/被打断但没死)。 */
export function extractFail(raid, bag, opts = {}) {
  return settle(raid, 'fail', bag, { ...opts, reason: opts.reason || '撤离超时' });
}

/** 死亡。由 main.js 的 Bus('runend', {victory:false}) 桥接进来。 */
export function death(raid, bag, opts = {}) {
  return settle(raid, 'death', bag, { ...opts, reason: opts.reason || '殒命' });
}

// ───────────────────────────────────────────────────────────
// 七、超时判定
// ───────────────────────────────────────────────────────────

/**
 * 是否已超时。UI 轮询用。**不要用 setTimeout** ——
 * 页面切后台会把定时器节流到分钟级,撤离窗口会被无声吞掉。
 * 轮询 Date.now() 才是和 clock.js 的离线推算一致的做法。
 *
 * @param {import('./types.js').Raid} raid
 * @param {number} [now]
 */
export function isExpired(raid, now = Date.now()) {
  return !!raid && raid.state === 'in_run' && now >= raid.extractBy;
}

/** 剩余秒数,给 UI 显示倒计时。 */
export function secondsLeft(raid, now = Date.now()) {
  if (!raid?.extractBy) return 0;
  return Math.max(0, Math.round((raid.extractBy - now) / 1000));
}

/**
 * 撤离成功率提示值 0..1。**只是提示,不是判据** ——
 * 搜打撤的规矩:玩家永远拿不到一个精确数字,否则就变成纯数值游戏了。
 * UI 最多显示「稳妥 / 稳妥 / 悬 / 凶」四档。
 */
export function extractOdds(raid, opts = {}) {
  const timeLeft = raid?.extractBy ? Math.max(0, raid.extractBy - Date.now()) / (RAID_WINDOW_TICKS * TICK_MS) : 0;
  const hp = raid?.hpRatio ?? 1;
  const p = Math.max(0, Math.min(1, 0.15 + 0.45 * timeLeft + 0.40 * hp));
  return opts.bucket === false ? p : ['凶', '悬', '不稳', '稳妥', '稳妥'][Math.min(4, Math.floor(p * 4))];
}

// ───────────────────────────────────────────────────────────
// 八、完整性校验
// ───────────────────────────────────────────────────────────

/** 出击单自身是否自洽。测试用。 */
export function verifyRaid(raid) {
  const problems = [];
  if (!raid) return { ok:true, problems };
  if (!TERMINAL.has(raid.state) && !TRANSITIONS[raid.state]) {
    problems.push(`未知状态: ${raid.state}`);
  }
  const { secured = [], insured = [] } = raid.loadout || {};
  for (const s of [...secured, ...insured]) {
    if (s.kind === 'secured' && s.itemId == null) problems.push('secured 槽有项缺 itemId');
    if (s.n < 0) problems.push(`${s.itemId} 数量为负`);
  }
  if (raid.state === 'extract_success' && raid.result?.lost?.length) {
    problems.push('成功撤离不该有损失项');
  }
  if (raid.state === 'death' && !raid.result?.lost?.length) {
    problems.push('死亡却零损失 —— 赔率写错了');
  }
  return { ok: problems.length === 0, problems };
}
