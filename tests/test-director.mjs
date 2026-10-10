// 刷怪导演测试 —— 工单 XX-SPAWN-001 / 002
// 运行: node tests/test-director.mjs
//
// 验证的是 owner 提的四条:
//   1. 捡宝石会刷怪(随机 1~3 只)
//   2. 高级怪掉高级宝石,高级宝石刷高级怪(同档位)
//   3. 站着不动、宝石不捡 → 刷怪频率逐渐归零 → 可以挂机
//   4. 篝火护栏随昼夜变大变小
// 外加:纯时间驱动那套(timed)没被删,留给幻境/副本。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
globalThis.localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};
const { Director, P, WARD_BY_PHASE, wardTarget, stepWard, resetWard, computeWard, wardSlack, canIdleCamp,
         tickEmber, resetEmber, emberPoints } =
  await import('../js/game/director.js');
const { ENEMY_TYPES } = await import('../js/game/enemies.js?v=17');
const { setSpawnMode, getSpawnMode } = await import('../js/game/spawner.js?v=17');
const { spawnEnemy } = await import('../js/game/enemies.js?v=17');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

function mkG(over = {}) {
  const g = Object.assign({
    time: 0, w: 960, h: 640, cam: { zoom: 1 },
    player: { x: 0, y: 0 },
    enemies: [], pickups: [], projectiles: [], zones: [],
    grid: { insert() {}, clear() {} },
  }, over);
  // spawnEnemy 走的是 g.addEnemy(由 initCombat 注入),mock 要补上,
  // 否则一调用就 TypeError —— 测的就不是导演,是桩没搭好。
  g.addEnemy = e => { g.enemies.push(e); return e; };
  g.addProjectile = p => { g.projectiles.push(p); return true; };
  g.addZone = z => { g.zones.push(z); return true; };
  g.spawnText = () => {};
  g.addParticles = () => {};
  g.__spawnOpts = () => ({});
  return g;
}
const gem = (sprite) => ({ kind: 'gem', sprite, xp: 3, x: 0, y: 0, r: 8, t: 0 });

console.log('\n[1] 捡宝石 → 加压力 + 当场刷怪');
{
  Director.reset();
  const g = mkG();
  const p0 = Director.s.pressure;
  const n = Director.onGemPickup(g, gem('gem_b'));
  ok('压力上升', Director.s.pressure > p0, `${p0} → ${Director.s.pressure.toFixed(3)}`);
  ok('当场刷出 1~3 只', n >= 1 && n <= 3, `刷了 ${n} 只`);
  ok('刷的怪真的进了场', g.enemies.length === n, `场上 ${g.enemies.length}`);
  // 宝石掉在玩家身边(视野外环带),不是贴身刷
  const far = g.enemies.every(e => Math.hypot(e.x - g.player.x, e.y - g.player.y) > 200);
  ok('刷在视野外环带(不是贴脸)', far);
}

console.log('\n[2] 档位匹配:高级宝石刷高级怪');
{
  for (const [sprite, loXp, hiXp] of [['gem_b', 1, 2], ['gem_g', 2, 6], ['gem_r', 5, 99]]) {
    Director.reset();
    const g = mkG();
    for (let i = 0; i < 40; i++) Director.onGemPickup(g, gem(sprite));
    const types = [...new Set(g.enemies.map(e => e.type))];
    const allInBand = types.every(t => { const xp = ENEMY_TYPES[t].xp; return xp >= loXp && xp < hiXp + 1; });
    ok(`${sprite} 刷出的怪在对应档位`, allInBand, types.join(','));
    ok(`${sprite} 不是所有怪种都出现`, types.length < 6, `${types.length} 种`);
  }
}

console.log('\n[3] 站着不动 → 频率变低,但仍有保底');
{
  Director.reset();
  const g = mkG();
  for (let i = 0; i < 3; i++) Director.onGemPickup(g, gem('gem_b'));
  g.enemies.length = 0;
  g.time = 0;
  Director.tick(0.016, g);
  const r0 = Director.rate(g, 0);

  // 注意:比较"速率"要控制住**当前怪量**同样。否则不同时刻缺口不同,
  // 速率差是缺口造成的、不是压力造成的 —— 那个对比说明不了问题。
  // 这里固定场上怪量,只让压力泄掉,看**目标带**怎么变。
  g.enemies = Array.from({ length: 10 }, () => ({ type: 'slime' }));
  Director.tick(0.016, g);
  const dBusy = Director.desiredAlive(g, g.time);

  g.time = 0;
  for (let i = 0; i < 200; i++) { g.time += 1; Director.tick(1, g); }   // 一动不动 200 秒
  g.enemies = Array.from({ length: 10 }, () => ({ type: 'slime' }));
  const dIdle = Director.desiredAlive(g, g.time);
  const rIdle = Director.rate(g, g.time);

  ok('不动之后目标带下降', dIdle < dBusy, `${dBusy.toFixed(1)} → ${dIdle.toFixed(1)}`);
  ok('但**不会归零**(不能变成免费暂停)', dIdle > 0, `desired=${dIdle.toFixed(2)}`);
  ok('回落到保底附近', dIdle <= P.MIN_ALIVE * 1.25 + 0.5, `desired=${dIdle.toFixed(2)} MIN=${P.MIN_ALIVE}`);
  // 场上已经 10 只、比保底还多 → 此时 rate=0 是正确的(不需要补)。
  // 真正该验的是:场上**空**的时候,不捡宝石仍会有零星补给。
  g.enemies = [];
  Director.tick(0.016, g);
  const rEmpty = Director.rate(g, g.time);
  ok('场空时不捡宝石仍有零星补给(不是完全停刷)', rEmpty > 0, `rate=${rEmpty.toFixed(3)}`);
  ok('但这个补给很低,不是保底刷怪', rEmpty < P.RATE_MAX, `rate=${rEmpty.toFixed(3)} max=${P.RATE_MAX}`);
  ok('刚捡完时目标带明显更高', dBusy > dIdle * 3, `${dBusy.toFixed(1)} vs ${dIdle.toFixed(1)}`);
}

console.log('\n[4] 场上没捡的宝石:只提供有限燃料');
{
  Director.reset();
  const g = mkG();
  // 堆 200 颗宝石在地上
  for (let i = 0; i < 200; i++) g.pickups.push(gem('gem_b'));
  const fuel = Director.pendingFuel(g);
  ok('存量燃料被封顶', fuel <= P.fuelCap + 1e-9, `fuel=${fuel.toFixed(3)} cap=${P.fuelCap}`);
  ok('200 颗宝石撑不起无限刷怪', fuel < 0.4, `${fuel.toFixed(3)}`);
}

console.log('\n[5] 两道闸门(连续,不是硬阈值)');
{
  Director.reset();
  const g = mkG(); g.time = 0;
  Director.s.pressure = 1;
  g.enemies = Array.from({ length: 20 }, () => ({ type: 'slime' }));
  Director.tick(0.016, g);
  const few = Director.s.read.popGate;

  g.enemies = Array.from({ length: P.MAX_ALIVE }, () => ({ type: 'slime' }));
  Director.tick(0.016, g);
  const many = Director.s.read.popGate;
  ok('怪多时 populationGate 更低', many < few, `${few.toFixed(3)} → ${many.toFixed(3)}`);
  ok('闸门有下限(不会把场面清零成单机)', many > 0.1, `${many.toFixed(3)}`);
  ok('满场时不再补怪', Director.rate(g, 0) === 0);

  // 闸门 2:档位太高 → 收手,但有保底
  Director.reset();
  const g2 = mkG(); g2.time = 0;
  Director.s.pressure = 1;
  const weak = Array.from({ length: 20 }, () => ({ type: 'slime' }));
  g2.enemies = weak.slice();
  Director.tick(0.016, g2);
  const tWeak = Director.s.read.tierGate;
  g2.enemies = Array.from({ length: 20 }, () => ({ type: 'reaper' }));
  Director.tick(0.016, g2);
  const tStrong = Director.s.read.tierGate;
  ok('强怪遍地时 tierGate 更低', tStrong < tWeak, `${tWeak.toFixed(3)} → ${tStrong.toFixed(3)}`);
  ok('tierGate 有下限(不会彻底断供)', tStrong >= 1 - P.tierGateMax - 1e-9, `${tStrong.toFixed(3)}`);
}

console.log('\n[6] 压力有上下限,不越界');
{
  Director.reset();
  const g = mkG(); g.time = 0;
  for (let i = 0; i < 500; i++) Director.onGemPickup(g, gem('gem_r'));
  ok('压力不超过 1', Director.s.pressure <= 1, `${Director.s.pressure}`);
  ok('压力不为负', Director.s.pressure >= 0);
}

console.log('\n[7] 纯时间驱动那套没被删(留给幻境/副本)');
{
  ok('可以切到 timed 模式', setSpawnMode('timed') === true);
  ok('当前是 timed', getSpawnMode() === 'timed');
  ok('拒绝未知模式', setSpawnMode('chaos') === false);
  setSpawnMode('budget');
  ok('切回 budget', getSpawnMode() === 'budget');
  // 源码里必须还留着那条时间曲线,不然"以后做幻境"就是空话
  const src = readFileSync(ROOT + '/js/game/spawner.js', 'utf8');
  ok('spawner 里还留着时间间隔曲线', /0\.9 - Math\.min\(t, 360\) \* 0\.0011/.test(src));
  ok('两种模式都有分支', /spawnMode === 'timed'/.test(src) && /Director\.rate\(g, t\)/.test(src));
}

console.log('\n[8] 篝火护栏:昼夜伸缩 + 可投入');
{
  ok('夜 > 黄昏 > 晨 > 昼',
    WARD_BY_PHASE.night > WARD_BY_PHASE.dusk
    && WARD_BY_PHASE.dusk > WARD_BY_PHASE.dawn
    && WARD_BY_PHASE.dawn > WARD_BY_PHASE.day,
    JSON.stringify(WARD_BY_PHASE));

  // 昼夜:同一等级下夜里护栏更大
  const dDay = computeWard({ campLv: 3, phase: 'day', pickup: 120 });
  const dNight = computeWard({ campLv: 3, phase: 'night', pickup: 120 });
  ok('同等级夜里护栏更大', dNight > dDay, `${dDay} → ${dNight}`);

  // 平滑:stepWard 朝目标靠拢,单帧变化有上限(不是瞬移)
  resetWard();
  let cur = 0;
  const tgt = dNight;
  for (let i = 0; i < 3000; i++) cur = stepWard(1 / 60, tgt);
  ok('最终逼近目标', Math.abs(cur - tgt) < 0.5, `cur=${cur.toFixed(1)} target=${tgt}`);
  const before = cur;
  const oneFrame = stepWard(1 / 60, tgt * 2) - before;
  ok('单帧变化不超过 24px/秒', Math.abs(oneFrame) <= 0.41 + 1e-6, `${oneFrame.toFixed(3)}px`);
  ok('火灭时护栏为 0', stepWard(1 / 60, 0) === 0);
}

console.log('\n[9] 机制不被看穿:不向外泄露阈值');
{
  const src = readFileSync(ROOT + '/js/game/director.js', 'utf8');
  // 只查**能被玩家看到的东西**:
  //   · 界面上不出现解释机制的文案
  //   · 不把内部状态挂到 window(控制台能读)
  // 源码里的中文注释是给以后维护的人看的复盘,玩家看不到,不构成泄露。
  ok('没有 status() 这种"告诉玩家为什么"的接口', !/\bstatus\s*\(\s*\)\s*\{/.test(src));
  ok('没有把内部状态挂到 window', !/window\.__director|window\.__pressure|window\.__spawnMode/.test(src));
  // 界面文案:全仓扫玩家可能读到的字符串
  //
  // ⚠️ 这块改过两次,两次都是因为「绿灯掩盖了未验证」:
  //
  // ①「全仓扫」以前是假的。列表硬编码成 4 个文件(js/main.js、xiuxian/ui.js、
  //    ui/hud.js、game/spawner.js),而 js/ 下有 40+ 个。
  //    写 ui/hud.js 的人没被扫到,新拆出来的 ui/*.js 也不会被扫到 ——
  //    注释写得再准,没覆盖到的地方就是没有断言。→ 改成真按目录遍历。
  //
  // ②改了①之后这条真的变红了,但**两个红都是工具的问题,不是泄露**:
  //    · js/game/pickups.js 里的「// V0.99:捡宝石 = 加生成压力」是**注释**。
  //      原来的剥离器 .replace(/^\s*\/\/.*$/gm,'') 在原始文本上跑,
  //      不认识字符串,于是一段多行字符串后面那行的注释被当成了"玩家看得到的文案"。
  //    · js/xiuxian/mount.js 的「它守了千年守不动了」是**坐骑 lore**,玩家可见但
  //      跟刷怪机制毫无关系 —— 被过松的 `不动了` 命中。
  //    → 字符串提取改用 lib-uimod 的 literals()(复用 codeMask 的正确切分);
  //      `不动了` 收窄成主语锚定的写法,保住原意(抓的是「妖不动了」)又不误伤 lore。
  const { readdirSync } = await import('fs');
  const { literals } = await import('./lib-uimod.mjs');
  const UI_SCAN = (() => {
    const out = [];
    (function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = d + '/' + e.name;
        if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p); }
        else if (e.name.endsWith('.js')) out.push(p);
      }
    })(ROOT + '/js');
    return out;
  })();
  ok('文案扫描真的覆盖了整个 js/ 目录', UI_SCAN.length >= 40, `实际扫了 ${UI_SCAN.length} 个文件`);
  const lits = UI_SCAN.flatMap(f => literals(readFileSync(f, 'utf8'))).join('\n');
  ok('确实扫到了中文界面文案(不是空扫)', /[\u4e00-\u9fa5]/.test(lits));
  // 收窄理由见 ②:坐骑 lore「它守了千年守不动了」是合法的玩家可见文字。
  const LEAK = /妖物正在散去|妖物散去|妖不动了|妖物不动了|怪不动了|生成压力|压力泄|不再刷怪|停止刷怪/;
  ok('界面文案里没有解释刷怪机制的句子',
     !LEAK.test(lits),
     lits.match(/[^\n]*(?:散去|压力泄|不再刷怪|停止刷怪)[^\n]*/g) || '');
}

console.log('\n[10] 拾取范围技能不会让场面失控(主人提的那个坑)');
{
  // 核心保证:无论玩家捡得多快,**目标怪量有上限**。
  // 靠的是控制器(负反馈),不是靠给技能加惩罚 —— 加惩罚会被玩家读出来。
  Director.reset();
  const g = mkG(); g.time = 0;
  Director.tick(0.016, g);
  Director.s.pressure = 1;
  g.pickups = [];
  const d = Director.desiredAlive(g, 0);
  ok('压力满时目标怪量不超上限', d <= P.MAX_ALIVE * 1.11, `desired=${d.toFixed(1)} MAX=${P.MAX_ALIVE}`);

  // 疯狂捡宝石 200 次,目标带也不能越界
  for (let i = 0; i < 200; i++) Director.onGemPickup(g, gem('gem_r'));
  Director.tick(0.016, g);
  const d2 = Director.desiredAlive(g, 1);
  ok('狂捡之后目标带仍然有界', d2 <= P.MAX_ALIVE * 1.11, `desired=${d2.toFixed(1)}`);
  ok('狂捡不会让压力越界', Director.s.pressure <= 1, `${Director.s.pressure}`);

  // 实际怪量被硬顶兜住
  g.enemies = Array.from({ length: 500 }, () => ({ type: 'slime' }));
  Director.tick(0.016, g);
  ok('实际怪量超过硬顶时不再生成', Director.rate(g, 1) === 0, `rate=${Director.rate(g,1)}`);
}

console.log('\n[11] 保底:站着不动仍有零星几只,但不叠加');
{
  Director.reset();
  const g = mkG(); g.time = 0;
  Director.tick(0.016, g);
  g.time += 200;                       // 200 秒一动没动
  for (let i = 0; i < 60; i++) Director.tick(1, g);
  const d = Director.desiredAlive(g, g.time);
  ok('目标带回落到保底附近', d <= P.MIN_ALIVE * 1.2 + 1, `desired=${d.toFixed(1)} MIN=${P.MIN_ALIVE}`);
  ok('保底不是 0(不会变成免费暂停)', d > 0, `desired=${d.toFixed(1)}`);

  // 实际收敛:一直不喂宝石,怪量应当稳定在保底附近,不无限涨
  let n = 0;
  for (let sec = 0; sec < 240; sec++) {
    g.time += 1;
    Director.tick(1, g);
    const r = Director.rate(g, g.time);
    n = Math.max(0, n - Math.floor(r));     // 粗略积分:生成 vs 自然消亡
    n += r * 0.35;                          // 假设每只平均 3 秒死一次
  }
  ok('长时间不喂食,怪量稳定在带内', n < P.MIN_ALIVE * 3, `稳定在 ~${n.toFixed(1)}`);
}

console.log('\n[12] 护栏 ↔ 拾取:一条可投入的成长线');
{
  // owner 原话:「促进玩家选了这个拾取技能后,可以选择是否升级投入更多源石增加篝火
  //   范围来匹配技能…不想自动拾取了,就砸进去源石,升级篝火,护栏范围大了,
  //   技能的拾取范围比护栏小,就可以安逸挂机了」
  //
  // 所以要验的是**两个方向都能达成**:
  // ⚠️ 这两个基准原来是 800 / 4000,那是**照着不存在的数字调的**。
  //    拾取半径(magnet)的真实构成:
  //      60 基础 (player.js:128 `magnet: 60 + charBonus + b.magnetFlat`)
  //    + 30 游侠角色 (player.js:31)
  //    + 125 磁石满级 25×5 (upgrades.js:35, maxLv 5)
  //    + 55 酒馆拾荒者 (tavern.js:35)
  //    = 270 满配;再叠坐骑拾取加成约 300。
  //    800 从来没到过 —— 照它调出来的 LV5 护栏 830 比整个视口还大(XX-PLAY-004)。
  //    现在按真实值取基准:LOW=典型(升 2 级磁石),BIG=满配(270)。
  const BIG_PICKUP = 270, LOW_PICKUP = 120;

  // 方向 A:拾取撑大、篝火没投 → 护栏跟不上 → 护栏外沿有可捡的(有代价)
  const poorCamp = computeWard({ campLv: 1, phase: 'day', pickup: BIG_PICKUP });
  ok('1 级篝火跟不上大拾取范围', poorCamp < BIG_PICKUP, `ward=${poorCamp} pickup=${BIG_PICKUP}`);
  ok('所以外沿有可捡的(有代价)', wardSlack(poorCamp, BIG_PICKUP) > 0,
     `slack=${wardSlack(poorCamp, BIG_PICKUP)}`);

  // 方向 B:砸源石升篝火 → 护栏追过拾取 → 安逸挂机
  const richCamp = computeWard({ campLv: 5, phase: 'day', pickup: BIG_PICKUP });
  ok('5 级篝火能追上大拾取范围', richCamp >= BIG_PICKUP, `ward=${richCamp} pickup=${BIG_PICKUP}`);
  ok('于是外沿没有可捡的(可以安逸挂机)', wardSlack(richCamp, BIG_PICKUP) === 0);

  // 护栏随投入单调递增 —— 这就是"值得投"
  let prev = 0;
  let mono = true;
  for (let lv = 1; lv <= 5; lv++) {
    const w = computeWard({ campLv: lv, phase: 'day', pickup: LOW_PICKUP });
    if (w <= prev) mono = false;
    prev = w;
  }
  ok('护栏随篝火等级单调递增', mono);
  ok('5 级比 1 级明显更大', prev > computeWard({ campLv:1, phase:'day', pickup:LOW_PICKUP }) * 1.5);

  // 护栏不能形同虚设(太小),也不能无限大(没取舍)
  // 用真实满配的 1.5 倍当「再离谱的大拾取」,验证下限生效、又没有 runaway。
  const OVER = 400;
  const tiny = computeWard({ campLv: 1, phase: 'day', pickup: OVER });
  ok('再大的拾取,护栏也不至于形同虚设', tiny >= OVER * 0.5, `ward=${tiny} pickup=${OVER}`);
  ok('但也没有无限大到没有取舍', tiny <= OVER * 2.7, `ward=${tiny}`);

  // XX-PLAY-004:护栏必须「看得见」—— 5 级白天的圆要能落在一屏之内,
  // 否则圈边永远在视口外,玩家看到的是一堵墙而不是火圈。
  const lv5day = computeWard({ campLv: 5, phase: 'day', pickup: 0 });
  ok('5 级白天护栏不超过 300(一屏看得见圆环)', lv5day <= 300, `ward=${lv5day}`);
  const lv1day = computeWard({ campLv: 1, phase: 'day', pickup: 0 });
  ok('护栏比旧值 830 明显收敛', lv5day < 400, `旧 LV5=830 → 现 ${lv5day}`);

  // 挂机判定要真的可用
  ok('1 级不算能挂机', canIdleCamp(1, LOW_PICKUP) === false);
  ok('5 级 + 小拾取范围 = 能挂机', canIdleCamp(5, LOW_PICKUP) === true);
}

console.log('\n[13] 篝火余烬:夜里缠身 + 将熄预告');
{
  // owner 原话:「篝火晚上的时候,人物要有类似二阶段,火焰缠身那种特效…
  //   起码肉眼判断目前是黑夜第几个阶段,然后快要白天了,就闪烁一下
  //   就等于结束了源石篝火,需要继续投入源石」
  resetEmber();
  const g = mkG();

  // 白天不亮
  let e = tickEmber(g, 1000, 'day');
  ok('白天没有余烬', e.on === false);

  // 入夜 → 亮起
  e = tickEmber(g, 2000, 'night');
  ok('入夜余烬亮起', e.on === true);
  ok('给出场内读数(进度/亮度)', typeof e.prog === 'number' && typeof e.alpha === 'number');

  // 亮度随夜色推进衰减 —— 玩家能看出"烧到什么时候了"
  resetEmber();
  const e0 = tickEmber(g, 0, 'night');
  const e1 = tickEmber(g, 120000, 'night');
  ok('越接近天亮余烬越弱', e1.alpha < e0.alpha, `${e0.alpha.toFixed(2)} → ${e1.alpha.toFixed(2)}`);
  ok('但不会完全消失(仍有可见度)', e1.alpha >= 0.1, `${e1.alpha.toFixed(2)}`);

  // 将熄预告:后段触发闪烁
  resetEmber();
  tickEmber(g, 0, 'night');
  const late = tickEmber(g, 260000, 'night');      // 进度 ~0.96
  ok('接近天亮时进入将熄态', late.dying === true, `prog=${late.prog.toFixed(2)}`);
  ok('将熄态会闪', late.flick > 0, `flick=${late.flick}`);
  const later = tickEmber(g, 260400, 'night');
  ok('闪烁在推进(不是卡住)', later.flick <= late.flick);

  // 天亮 → 余烬结束
  const dawn = tickEmber(g, 300000, 'day');
  ok('天亮余烬结束', dawn.on === false);

  // 粒子分布:稳定、数量固定
  const pts = emberPoints(7);
  ok('余烬粒子数量固定', pts.length === 7);
  const pts2 = emberPoints(7);
  ok('分布稳定(不每帧乱跳)', JSON.stringify(pts) === JSON.stringify(pts2));
  ok('粒子散开在身体周围', pts.filter(q => Math.hypot(q.dx, q.dy) > 8).length >= pts.length - 1);
  ok('粒子有大小差异(不是一坨)', new Set(pts.map(q => q.sz)).size > 1);
}

console.log(`\ntest-director: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);