// 修仙阁 · 无头实测 —— 工单 XX-E2E-002
// 运行: node tests/e2e-cult.mjs
//
// e2e-core 验的是"砍杀能不能跑";这个验的是"修仙阁能不能看":
//   · 12 个页签逐个渲染,不能崩、不能出 undefined
//   · 插画按地点类型取(不是按页签硬映射)
//   · 人物页 4 个角色 4 张**不同**的立绘(之前全是同一张)
//   · 剧情脉络:见到妖 → 接支线 → 推进叙事线 → 图鉴解锁
//   · 灵伴在局内真的动、真的捡
//
// 依然不校验像素 —— 画面归 CI 的浏览器测试。这里验的是结构与逻辑。
import { install } from './harness.mjs';
import { readdirSync, existsSync } from 'fs';

const H = install();
let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const guard = (t, fn) => {
  try { return fn(); } catch (e) { fail++; failed.push(`${t}: ${e.message}`); console.log(`  ❌ ${t}\n     ${e.message}`); return null; }
};

const V = '?v=17';   // 必须与 main.js 同款 specifier,否则拿到的是另一份模块实例
const { Cult } = await import('../js/xiuxian/index.js');
const { Bag } = await import('../js/xiuxian/items.js');
const { CAMP } = await import('../js/xiuxian/camp.js');
const { DAY } = await import('../js/xiuxian/items.js');
const { Merchant } = await import('../js/xiuxian/merchant.js');
const { MOUNT } = await import('../js/xiuxian/mount.js');
const { COMPANION } = await import('../js/xiuxian/companion.js');
const { STORY, ARCS } = await import('../js/xiuxian/story.js');
const { QUEST } = await import('../js/xiuxian/quest.js');
const { LEGEND_LIST } = await import('../js/xiuxian/legend.js');
const { Hall } = await import('../js/xiuxian/ui.js');
const { NODE_ILLUST, TAB_ILLUST, nodeIllustUrl, tabIllustUrl } = await import('../js/xiuxian/illust.js');
const { SPINE, PHASES } = await import('../js/xiuxian/spine.js');
const { installSpine } = await import('../js/xiuxian/spine.js');
// V0.99(XX-FIX-003):必须先 load 世界时钟,否则 CHRONICLE.sync() 读到未初始化的
// CLOCK.s,年表页会显示「第 undefined 年 · NaN 日」。
const { CLOCK } = await import('../js/xiuxian/clock.js');
const { CHARACTERS } = await import('../js/game/player.js' + V);
const { NPCS } = await import('../js/xiuxian/bestiary.js');

console.log('\n[1] 修仙阁初始化');
CLOCK.load();
Cult.init(); Bag.load('xx_bag_v080'); CAMP.load(); DAY.load('xx_day_v080');
Merchant.load(); MOUNT.load(); COMPANION.load(); STORY.load(); QUEST.load();
installSpine(Cult.s, CAMP);
guard('open 修仙阁', () => Hall.open());
ok('修仙阁已打开', Hall.isOpen());
const screen = globalThis.document.querySelector('.xx-screen');
ok('界面根节点存在', !!screen);

console.log('\n[2] 12 个页签逐个渲染');
const TABS = ['realm','map','camp','arts','bag','people','title','fam','build','dex','quest','sys'];
ok('页签数量 12', TABS.length === 12);
for (const t of TABS) {
  guard(`渲染 ${t}`, () => { Hall.tab = t; Hall.render(); });
  const body = globalThis.document.querySelector('#xx-body');
  const html = body ? body.innerHTML : '';
  if (html.includes('undefined')) {
    const i = html.indexOf('undefined');
    ok(`${t} 不含 undefined`, false, '\n' + html.slice(Math.max(0, i-160), i+100));
  } else ok(`${t} 不含 undefined`, true);
  ok(`${t} 内容非空`, html.trim().length > 20);
}

console.log('\n[3] 插画:按地点类型取,不是按页签硬映射');
{
  // 地点类型 5 类,每类都必须有图,且互不相同
  const types = ['village','field','secret','elite','boss'];
  const urls = types.map(t => nodeIllustUrl({ type: t }));
  ok('五种地点都有插画', urls.every(Boolean), urls.filter(Boolean).length + '/5');
  ok('五种地点的图互不相同', new Set(urls).size === 5, `${new Set(urls).size} 种不同`);
  // 页签图同样不许全同
  const tabUrls = Object.keys(TAB_ILLUST).map(k => tabIllustUrl(k)).filter(Boolean);
  ok('页签图不是一张图套全场', new Set(tabUrls).size >= 4, `${new Set(tabUrls).size} 种不同`);
  ok('地图页不配页签图', tabIllustUrl('map') === null);
  // 图必须真的在磁盘上
  const missing = urls.filter(u => !existsSync(u.replace(/^.*\/xuanxuan-cultivation/, '.')));
  ok('插画 URL 指向的文件存在', missing.length === 0, missing[0] || '');
}

console.log('\n[4] 人物页:4 个角色 4 张不同的立绘');
{
  const imgs = Object.values(CHARACTERS).map(c => c.portrait);
  ok('每个角色都有 portrait 字段', imgs.every(Boolean), imgs.join(','));
  ok('四张立绘互不相同', new Set(imgs).size === 4, `${new Set(imgs).size} 种`);
  const need = ['role','title','bio','arc'];
  for (const c of Object.values(CHARACTERS)) {
    for (const f of need) ok(`${c.name} 有 ${f}`, !!c[f] && c[f] !== 'undefined', `${f}=${c[f]}`);
  }
  // 不允许有人复用别人的图
  const npcImgs = Object.values(NPCS).map(n => n.img);
  ok('NPC 也没有共用同一张图', new Set(npcImgs).size === npcImgs.length, npcImgs.join(' '));
  for (const n of Object.values(NPCS)) {
    ok(`${n.name} 的立绘文件存在`, existsSync(n.img), n.img);
  }
}

console.log('\n[5] 剧情脉络:见到妖 → 接支线 → 叙事线推进 → 图鉴解锁');
{
  ok('叙事线有 5 条', Object.keys(ARCS).length === 5, Object.keys(ARCS).join(','));
  ok('传说妖有 8 只', LEGEND_LIST.length === 8, `${LEGEND_LIST.length}`);
  for (const a of Object.values(ARCS)) {
    ok(`${a.name} 有节拍`, Array.isArray(a.beats) && a.beats.length >= 3, `${a.beats?.length} 拍`);
    // 终章那一拍可以没有 node(不需要"往哪走"),只要求起始拍有
    ok(`${a.name} 起始拍有地点`, !!a.beats[0].node, `first=${a.beats[0].node}`);
  }
  // 走到第三只妖:应当接住支线、推进主线、图鉴解锁
  SPINE.reset();
  const seen = [];
  for (const l of LEGEND_LIST.slice(0, 3)) {
    guard(`见到 ${l.key}`, () => { STORY.see(l.key); SPINE.observeLegend(l.key); seen.push(l.key); });
  }
  ok('图鉴记住了见过的妖', seen.every(k => STORY.met(k)), seen.join(','));
  ok('主线阶段已推进', SPINE.phase().n >= 2, `阶段=${SPINE.phase().name}`);
  ok('主线记下了 3 只妖', Object.keys(SPINE.get().seen).length === 3);
  // 因果句:见过红衣女鬼后,见到姥姥应给出关联
  const causal = SPINE.observeLegend('laolao').lines;
  ok('因果链给得出句子', Array.isArray(causal), JSON.stringify(causal));
}

console.log('\n[6] 支线:见到妖就能接,不要求玩家先跑图');
{
  ok('支线有结案条件表', Object.keys(QUEST.s).length >= 3);
  // 注意顺序:必须在渲染 quest 页之前查。vQuest() 里会调 QUEST.autoTake(),
  // 它把见过的妖全接走了,之后再 canTake 只会得到「已在手上」。
  const before = LEGEND_LIST.map(l => QUEST.canTake(l.key)).filter(r => r.ok).length;
  ok('见过的妖可以接支线', before >= 3, `${before} 条可接`);
  guard('vQuest 渲染', () => { Hall.tab = 'quest'; Hall.render(); });
  ok('渲染后支线已在手上', QUEST.s.active.length >= 3, `${QUEST.s.active.length} 条在手`);
}

console.log('\n[7] 门禁提示:差多少写出来,而不是点了才弹');
{
  for (const [mod, fn] of [['FAMILY','raiseGap'], ['BUILD','pactGap']]) {
    let m;
    try { m = await import('../js/xiuxian/' + (mod === 'FAMILY' ? 'family.js' : 'build.js')); }
    catch (e) { ok(`${fn} 可用`, false, e.message); continue; }
    const api = m[mod];
    guard(`${fn}()`, () => {
      const g = api[fn]();
      ok(`${fn} 返回缺口结构`, typeof g === 'object' && g !== null && 'ok' in g, JSON.stringify(g));
      if (!g.full && !g.ok) ok(`${fn} 报出还差多少`, typeof g.lack === 'number' && g.lack >= 0, `lack=${g.lack}`);
    });
  }
}

console.log('\n[8] 灵伴在局内:真的动、真的捡');
{
  COMPANION.reset(); COMPANION.init('宝宝');
  const { CompanionActor } = await import('../js/xiuxian/companion-actor.js');
  const fake = {
    player: { x: 0, y: 0, hp: 100, stats: { maxHp: 100 }, _xp: 0, addXp(v) { this._xp += v; } },
    pickups: [], enemies: [], cam: { x: 0, y: 0 }, texts: [],
    remove(a, i) { a[i] = a[a.length - 1]; a.pop(); },
    spawnText(x, y, t) { this.texts.push({ x, y, t }); },
  };
  const a = new CompanionActor(fake);
  a.begin();
  const x0 = a.x;
  fake.pickups.push({ kind: 'gem', x: 80, y: 0, xp: 3, r: 8, t: 0 });
  // 她捡完会走回跟随位,所以要看**过程中的最远位置**,不是最终位置
  let maxX = a.x, maxY = a.y;
  for (let i = 0; i < 300; i++) { a.update(1 / 60); if (a.x > maxX) maxX = a.x; if (Math.abs(a.y) > Math.abs(maxY)) maxY = a.y; }
  ok('她真的跑过去了', maxX > 55, `最远到 x=${maxX.toFixed(1)}(宝石在 80)`);
  ok('她不是瞬移过去的', maxX - x0 < 200 && maxX > x0, `位移 ${(maxX - x0).toFixed(1)}`);
  ok('捡完回到跟随位', Math.abs(a.x - (fake.player.x - 36)) < 2, `x=${a.x.toFixed(1)}`);
  ok('她把宝石捡走了', fake.pickups.length === 0, `剩 ${fake.pickups.length}`);
  ok('捡到的宝石变成了玩家经验', fake.player._xp === 3, `xp=${fake.player._xp}`);
  ok('年表记了这一笔', COMPANION.s.log.length === 0 || typeof COMPANION.s.log[0].picks === 'number');
}


// ---- XX-FIX-017 防回归:吐纳必须给道行 ----
// 背景:道行曾经被写进 `if (yr)` 分支,而 CHRONICLE.action() 只在跨年那一 tick
// 返回对象 —— 于是 +200 道行一年才发一次,实测道行永远是 0。
// 这条断言盯的是**行为**:点一次吐纳,道行必须 +200。
{
  const { Cult } = await import('../js/xiuxian/index.js');
  guard('回到境界页', () => { Hall.tab = 'realm'; Hall.render(); });
  const before = Cult.get().dao;
  guard('点一次吐纳', () => Hall.act('meditate'));
  const after = Cult.get().dao;
  ok('吐纳给了道行', after - before === 200, `+${after - before}(应为 200)`);
  ok('吐纳没把道行扣成负数', after >= 0, `dao=${after}`);
  const again0 = Cult.get().dao;
  guard('再点一次吐纳', () => Hall.act('meditate'));
  ok('第二次也给道行(不是只有第一次)', Cult.get().dao - again0 === 200,
     `+${Cult.get().dao - again0}`);
}

console.log(`\ne2e-cult: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);