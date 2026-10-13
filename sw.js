// Service Worker V0.99
// 修复两个技术债:
//  1. 预缓存清单长期停在 V0.76,新文件(修仙层/美术/音频)从未进缓存,离线即失效。
//  2. index.html 走 cache-first → 一旦缓存就永远不更新,用户被钉死在旧版本。
// 策略:导航请求 network-first(离线回退缓存);静态资源 stale-while-revalidate。
//
// v099an(2026-10-13)· 预缓存失败不再静默吞掉;预缓存不完整时**保留旧缓存**。
//   同时把 `?v=` 戳的职责写死在 ignoreSearch 那段注释里(见下),防止有人
//   因为「它不参与缓存键」而去删那 80 多处戳 —— 那是模块身份,不是装饰品。
// v099am(2026-10-13)· 灵伴动态/激光炮/五阶段立绘。
// v099r(2026-10-11)· 合并方统一升版。
// 本次并入 Z8 侧 5 个提交(XX-LINK-001 / XX-LINK-003 / XX-MATH-001b 等,
// 其中「局外节点倾向接入局内刷怪与掉落」是玩家可见改动,却一直挂在 v099q 上),
// 加上桌面侧 XX-AUDIT-025 与 P1-2 基线增量。
// 按 VERSION-CONVENTION §2,本行是版本号唯一真源,其余三处由 lint-version 校验。
// v099t(2026-10-11)· 合并方统一升版(第二次合)。
//
// 本次并入桌面侧 XX-AUDIT-014:修一个**已经上线**的 P0 ——
//   js/xiuxian/world/{network,types}.js 不在预缓存清单里,离线时取不到
//   → import 链断 → 白屏。实测线上 sw.js 里这两个文件计数为 0。
//
// 加上 Z8 侧 XX-PLAY-015:upgrades.js 种类子集内的加权抽取(权重此前是死代码,
//   神通权重从 5 拉到 100000 卡位构成都不变),并新增 18 项门禁。
//
// ⚠️ 这次是**两边都升到 v099s 之后的撞车**(VERSION-CONVENTION §2 警告过的情况):
//   合并方按规则再升一格 → v099t。已缓存 v099s 的客户端必须靠这个版本号差才能更新 sw.js。
// ⚠️ 这次是**两边撞到同一个版本号**: Z8 的 c60973c 与我(桌面侧)的 3b4af19
//   各自都把 v099ae 升到了 v099af。VERSION-CONVENTION 规则 3 说过「不要各自升」,
//   真撞上了按规则 2 由**后合的一方**再升一格, 否则两个不同代码对外声称同一个版本,
//   已缓存 v099af 的客户端分不出谁新。
const V = 'xuanxuan-v099an';
const BUILD = '20261013-1302';

const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/style.css', 'css/xiuxian.css', 'css/palette.css', 'js/core/palette.js',
  'css/illust.css', 'css/wash.css',
  // 装备页改版:新样式表由 index.html 引用,离线取不到就是无样式裸奔。
  'css/gear.css',
  'js/main.js', 'js/sprites.js',
  'js/pix/palette.js', 'js/pix/brush.js', 'js/pix/ground.js',
  'js/pix/hero-knight.js', 'js/pix/hero-mage.js', 'js/pix/hero-ranger.js', 'js/pix/hero-white.js',
  'js/pix/enemies-a.js', 'js/pix/enemies-b.js', 'js/pix/bosses.js', 'js/pix/projectiles.js',
  'js/pix/items.js', 'js/pix/fx.js',
  'js/core/engine.js', 'js/core/camera.js', 'js/core/input.js', 'js/core/save.js', 'js/core/audio.js',
  'js/game/player.js', 'js/game/map.js', 'js/game/particles.js', 'js/game/enemies.js',
  'js/game/weapons.js', 'js/game/director.js', 'js/game/spawner.js', 'js/game/boss.js', 'js/game/upgrades.js', 'js/game/pickups.js',
  // XX-MATH-001:spawner.js 静态 import 它(局内 Collatz 难度曲线),
  // 原生 ESM 全有或全无 —— 不在清单里,离线开局就会因取不到模块而白屏。
  'js/game/collatz.js',
  'js/game/gear.js',   // 装备数据层(XX-EQUIP-002/003) —— main.js 已 import,必须进预缓存
  'js/game/gearIcons.js',   // 装备图标路径层 —— ui/gear.js 静态 import 它;
                             // 原生 ESM 全有或全无,不在清单里离线点开装备页就白屏
                             // (XX-EQUIP-006 预缓存双向核对,见 lint-precache-reverse)
  'assets/portrait/villain-shexie.jpg', 'assets/portrait/villain-nvxia.jpg', 'assets/portrait/villain-yaohou.jpg', 'assets/portrait/villain-youfang.jpg', 'assets/portrait/villain-heifeng.jpg', 'assets/portrait/villain-shougu.jpg',
  'js/ui/hud.js', 'js/ui/codex.js', 'js/ui/bestiary.js', 'js/ui/screens.js', 'js/ui/joystick.js',
];
const XX = [
  'js/xiuxian/index.js', 'js/xiuxian/realms.js', 'js/xiuxian/arts.js', 'js/xiuxian/battle.js',
  'js/xiuxian/world.js', 'js/xiuxian/lore.js', 'js/xiuxian/relations.js', 'js/xiuxian/assets.js',
  'js/xiuxian/ui.js', 'js/xiuxian/duel.js', 'js/xiuxian/items.js', 'js/xiuxian/camp.js',
  'js/xiuxian/merchant.js', 'js/xiuxian/companion.js', 'js/xiuxian/bond.js',
  'js/xiuxian/ritual.js', 'js/xiuxian/loot.js', 'js/xiuxian/family.js', 'js/xiuxian/chronicle.js',
  // XX-WORLD-004:ui.js 现在**运行时**import 这两个。阶段 0 时它们零消费者,
  // 不在预缓存里没关系;阶段 1 接上线后就必须有 —— 否则离线时 SW 取不到,
  // ui.js 整个模块加载失败,修仙阁直接白屏。
  // 2026-10-11(XX-AUDIT-014):network.js / types.js 一并补进来。
  //   它们当时确实还没接线(world/ 四个文件里只有这两个运行时消费者为 0,
  //   planRoute / verifyNetwork 只被 tests/ 调用),所以「不会被 fetch、不会白屏」。
  //   但 CI 的预缓存双向核对是按「js/ 下所有 .js」一刀切的,已经因此红了三个提交。
  //   而 XX-WORLD-005 马上就要把 planRoute 接进 ui.js travel 分支 ——
  //   **那正是它们被 fetch 的那一刻**。阶段 0 落地的意义就是「代码库始终完整可运行」,
  //
  // ⚠️ 2026-10-12 更正:上面这段论证**对 network.js 仍成立、对 types.js 已不成立**。
  //   network.js:ui.js 确实 import 了 planRoute(见 ui.js routePlan()),链条是真的。
  //   types.js:**全仓零 import**。它是 types-only 模块,类型经 JSDoc 传递、
  //   运行时没有对应物 —— 预缓存它是因为它「迟早会用到」,而不是因为「现在取不到就白屏」。
  //   「预缓存双向核对」只保证「磁盘有的清单里有」,**不保证「清单里的东西真有人用」** ——
  //   这两条不是一回事,别拿前者给后者背书。types.js 若将来仍无人 import,
  //   可以从这里摘掉;先摘会掉一个将来可能要用的文件,权衡见 TICKETS.md。
  //   提前进预缓存比等接完线再补要安全:漏补的后果是离线白屏(P0)。
  'js/xiuxian/world/nodes.js', 'js/xiuxian/world/regions.js',
  'js/xiuxian/world/network.js', 'js/xiuxian/world/types.js',
  'js/xiuxian/tomb.js', 'js/xiuxian/nag.js', 'js/xiuxian/spirit.js', 'js/xiuxian/mount.js',
  // V0.98 补齐:这批文件在 V0.86~V0.90 重写清单时被漏掉,
  // 但它们都在 main.js / ui.js 的**静态 import 图**上 ——
  // 原生 ES Module 静态 import 是全有或全无,离线拉不到任意一个就是整页白屏。
  // (在线不受影响:SW 的 stale-while-revalidate 会走网络补上,所以这个缺陷能带着"测试全绿"发布。)
  'js/xiuxian/ambience.js', 'js/xiuxian/bestiary.js', 'js/xiuxian/build.js',
  'js/xiuxian/legend.js', 'js/xiuxian/profile.js', 'js/xiuxian/quest.js',
  'js/xiuxian/codex.js',
  'js/xiuxian/story.js', 'js/xiuxian/spine.js',
  'js/xiuxian/companion-actor.js', 'js/xiuxian/illust.js', 'js/xiuxian/clock.js', 'js/xiuxian/market.js', 'js/xiuxian/tavern.js', 'js/xiuxian/artstar.js', 'js/xiuxian/craft.js',
  // XX-COMPANION-004:灵伴的独立拾取系统。companion-actor.js 静态 import 它,
  // 离线拉不到 → actor 整条 import 图失败 → 局内白屏。
  // 由 tests/lint-precache-reverse.mjs 兜住(它正是为"磁盘有、清单没有"这类漏项存在的)。
  'js/xiuxian/companion-gather.js',
  // 程序化生成 + 分层种子 + 局内配置链(V0.97~V0.98)。
  // world.js 已经 import 了 worldgen/seed,vendor/rot-rng 是它们的底座,
  // ui.js 又 import 了 runcfg —— 4 个文件全在静态 import 图上,一个都不能少。
  'js/xiuxian/seed.js', 'js/xiuxian/worldgen.js', 'js/xiuxian/runcfg.js',
  'js/xiuxian/vendor/rot-rng.js',
  // XX-PLAY-012:换世重置。ui.js 的「换一世」调它,它在 ui.js 的静态 import 图上
  // —— 不进清单的话,离线状态下换一世会因取不到模块而白屏。
  'js/xiuxian/newlife.js',
  // 修仙阁 UI 拆分(XX-AUDIT-005)。ui.js 拆出去之后,ui.js import 这些文件,
  // 它们就在 ui.js 的**静态 import 图**上 —— 原生 ESM 全有或全无,
  // 离线拉不到任意一个就是整页白屏。dom.js 是共享 DOM 辅助(esc/toast),
  // 视图模块和 ui.js 都依赖它,漏掉等于整页转义失效。
  'js/xiuxian/ui/arts.js', 'js/xiuxian/ui/bag.js', 'js/xiuxian/ui/build.js', 'js/xiuxian/ui/dexsys.js', 'js/xiuxian/ui/dom.js', 'js/xiuxian/ui/fam.js', 'js/xiuxian/ui/gear.js',
  // 修仙阁顶部「正在发生」动态区(XX-LIVE-001)。ui.js 静态 import 它,
  // 原生 ESM 全有或全无 —— 不在清单里,离线点开修仙阁就是整页白屏。
  'js/xiuxian/ui/livebar.js',
  'js/xiuxian/ui/map.js', 'js/xiuxian/ui/meta.js', 'js/xiuxian/ui/portrait.js', 'js/xiuxian/ui/realm.js', 'js/xiuxian/ui/story.js', 'js/xiuxian/ui/title.js', 'js/xiuxian/ui/tomb.js',
  // 存档键集中注册表(XX-AUDIT-006 批 1)。
  // 它在 15 个模块的静态 import 图上 —— 原生 ESM 是全有或全无,
  // 离线拉不到就是整页白屏。
  'js/xiuxian/save-keys.js',
  // V0.99 补齐:双结局文案唯一真源(XX-AUDIT-018)。
  // spine.js 与 tomb.js 都静态 import 它,离线拉不到就是整页白屏。
  'js/xiuxian/outcomes.js',
  // V0.99 补齐:局内广播条(XX-COMPANION-003)。bond.js 静态 import 它。
  'js/xiuxian/companion-broadcast.js',
  // V0.99 补齐:灵伴变异体系数据层(XX-MUTATION-002)。companion.js 静态 import 它,
  // 离线拉不到 → companion.js 整条 import 图失败 → 整页白屏。
  'js/xiuxian/mutation.js',
];
const ART = [
  // 装备图标(XX-EQUIP-006):4 槽位 + 8 件装备。SVG 单色描边,currentColor 继承。
  'assets/gear/slot-head.svg', 'assets/gear/slot-body.svg',
  'assets/gear/slot-hand.svg', 'assets/gear/slot-foot.svg',
  'assets/gear/hongyi_garment.svg', 'assets/gear/laolao_hairpin.svg',
  'assets/gear/baize_claw.svg', 'assets/gear/dangkang_ring.svg',
  'assets/gear/qingqiong_robe.svg', 'assets/gear/jiangu_blade.svg',
  'assets/gear/shijiang_seal.svg', 'assets/gear/dengshi_lamp.svg',
  'assets/portrait/hero.jpg', 'assets/portrait/villain-moying.jpg', 'assets/portrait/aunt.jpg',
  'assets/bg/duel.jpg', 'assets/bg/cave.jpg', 'assets/bg/sect.jpg',
  'assets/bgm/nemesis.mp3', 'assets/bgm/overlord.mp3',
  'assets/mob/ghostfire.jpg','assets/mob/revenant.jpg','assets/mob/golem.jpg',
  'assets/mob/ninehead.jpg',
  'assets/illust/pages_webp/page-01-realm.webp',
  'assets/illust/pages_webp/page-02-cave.webp',
  'assets/illust/pages_webp/page-03-sword.webp',
  'assets/illust/pages_webp/page-04-pill.webp',
  'assets/illust/pages_webp/page-05-array.webp',
  'assets/illust/pages_webp/page-06-sect.webp',
  'assets/illust/pages_webp/page-07-battle.webp',
  'assets/illust/pages_webp/page-08-inn.webp',
  'assets/illust/pages_webp/page-09-map.webp',
  'assets/illust/pages_webp/page-10-tower.webp',
  'assets/illust/pages_webp/page-11-tomb.webp',
  'assets/illust/pages_webp/page-12-market.webp',
  'assets/legend/hongyi.jpg','assets/legend/laolao.jpg','assets/legend/baize.jpg','assets/legend/dangkang.jpg',
  'assets/legend/qingqiong.jpg','assets/legend/jiangu.jpg','assets/legend/shijiang.jpg','assets/legend/dengshi.jpg',
  'assets/portrait/knight.jpg',
  'assets/portrait/mage.jpg',
  'assets/portrait/ranger.jpg',
  'assets/portrait/white.jpg',
  'assets/portrait/companion.jpg',
  // XX-COMPANION-006:灵伴五阶段立绘。少缓存一张 = 该阶段在离线下退回通用图,
  // 而玩家看到的会是"我明明投喂了,脸却没变" —— 正是这条规格要解决的事。
  'assets/portrait/companion_sealed.jpg', 'assets/portrait/companion_awaken.jpg',
  'assets/portrait/companion_reveal.jpg', 'assets/portrait/companion_morph.jpg',
  'assets/portrait/companion_true.jpg',
  'assets/portrait/merchant.jpg','assets/mob/bloodriver.jpg','assets/portrait/momocha.jpg',
];
const ASSETS = [...CORE, ...XX, ...ART, 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

// 预缓存完整性标记的键。装在**缓存内部**(不是真实文件),
// 只给 activate 判断「这一版的缓存是不是完整的」。
const STAMP = './__precache_complete__';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(V);
    // ⚠️ 这里原来直接 allSettled 然后 skipWaiting,把 rejection 原样丢掉。
    //   两个后果:
    //   ① **零可观测性** —— 就算漏了 30 张立绘,控制台一个字都没有,
    //      没人知道漏了什么,只能等玩家报「我明明投喂了,脸却没变」。
    //   ② **activate 照样删旧缓存** —— 移动端安装时网络抖动是常态,
    //      漏存几项就会得到「新 SW + 不完整缓存 + 旧缓存已被删」,
    //      一断网就是白屏。
    //   (lint-precache 保证清单里的项都真实存在,所以「永久 404」不是主要风险;
    //    主要风险是**瞬时**网络失败。)
    //
    // 为什么**不**改成失败就 throw:一个永久失效的资源(比如将来某张图下线了)
    // 会让 install 永久失败,用户从此再也收不到任何更新 —— 比漏存几项更糟。
    // 所以这里选第三条路:失败**留痕** + activate **按完整性决定要不要清旧缓存**。
    const results = await Promise.allSettled(ASSETS.map(a => cache.add(new Request(a, { cache: 'reload' }))));
    const failed = results.map((r, i) => (r.status === 'rejected' ? ASSETS[i] : null)).filter(Boolean);
    if (failed.length) {
      console.warn(`[sw] ${V} 预缓存失败 ${failed.length}/${ASSETS.length} 项,这些资源离线时将回退到网络:`, failed);
    } else {
      await cache.put(STAMP, new Response('ok'));
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // **只有预缓存完整才清旧缓存。**
    // 缓存查找是 `caches.match(req, {ignoreSearch:true})`,它搜**所有**缓存 ——
    // 留着旧缓存 = 漏掉的资源仍然能命中上一版,退化成"这几次更新没生效"
    // 而不是"一断网就白屏"。取舍很明确:宁可让更新晚一拍,也不能拿可用性去换。
    const fresh = await caches.open(V);
    const complete = !!(await fresh.match(STAMP));
    if (complete) await Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)));
    else console.warn(`[sw] ${V} 预缓存不完整,保留旧缓存 ${keys.filter(k => k !== V).join(', ')}`);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data && e.data.type === 'build') {
    e.source && e.source.postMessage({ type: 'build', build: BUILD });
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // —— 导航请求:永远优先网络,离线才回缓存(根治「旧标题钉死用户」)——
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(V);
        cache.put('index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('index.html')) || (await caches.match('./')) ||
               new Response('离线且无缓存', { status: 503 });
      }
    })());
    return;
  }

  // —— 静态资源:stale-while-revalidate ——
  e.respondWith((async () => {
    // ⚠️ `ignoreSearch: true` 让这一行**忽略 query string**。
    //   也就是说 `js/game/spawner.js?v=19` 与 `?v=18` 命中的是**同一条**缓存,
    //   真正决定缓存新鲜度的是上面的 `V`,不是这些戳。
    //
    //   ⇒ 所以 `?v=` **不是**刷缓存用的装饰品,别按「它不参与缓存所以没用」去删。
    //   它真正的职责是另一件事:**浏览器里的 ESM 模块身份**。
    //   `import './spawner.js?v=19'` 与 `?v=18` 是**两个不同的模块实例**,
    //   各存各的模块级状态。本仓踩过这个坑:collatz 局内难度曲线写进
    //   一份 spawner、hud.js 从另一份读,渲染出来的时间后缀整个消失
    //   (tests/collatz-difficulty-regression.mjs 里有完整记录)。
    //
    //   这个约束由 tests/lint-module-identity.mjs 守住(产品侧要求「每个模块
    //   只有一个实例」)。**删戳之前先看那条门禁,别只数一下有多少个戳。**
    //
    //   附:戳是**按模块**递增的,不是全项目一个号 —— main.js?v=18、
    //   pickups.js?v=18、spawner.js?v=19、其余 ?v=17,各自一致即合规。
    //   拿不同模块的戳互相比大小,得出的「版本号混用」是伪命题。
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then(async resp => {
      if (resp && resp.ok) {
        const cache = await caches.open(V);
        cache.put(req, resp.clone());
      }
      return resp;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});