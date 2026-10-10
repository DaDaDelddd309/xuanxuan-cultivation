// Service Worker V0.99
// 修复两个技术债:
//  1. 预缓存清单长期停在 V0.76,新文件(修仙层/美术/音频)从未进缓存,离线即失效。
//  2. index.html 走 cache-first → 一旦缓存就永远不更新,用户被钉死在旧版本。
// 策略:导航请求 network-first(离线回退缓存);静态资源 stale-while-revalidate。
const V = 'xuanxuan-v099q';
const BUILD = '20261008-1710';

const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/style.css', 'css/xiuxian.css', 'css/palette.css', 'js/core/palette.js',
  'css/illust.css', 'css/wash.css',
  'js/main.js', 'js/sprites.js',
  'js/pix/palette.js', 'js/pix/brush.js', 'js/pix/ground.js',
  'js/pix/hero-knight.js', 'js/pix/hero-mage.js', 'js/pix/hero-ranger.js', 'js/pix/hero-white.js',
  'js/pix/enemies-a.js', 'js/pix/enemies-b.js', 'js/pix/bosses.js', 'js/pix/projectiles.js',
  'js/pix/items.js', 'js/pix/fx.js',
  'js/core/engine.js', 'js/core/camera.js', 'js/core/input.js', 'js/core/save.js', 'js/core/audio.js',
  'js/game/player.js', 'js/game/map.js', 'js/game/particles.js', 'js/game/enemies.js',
  'js/game/weapons.js', 'js/game/director.js', 'js/game/spawner.js', 'js/game/boss.js', 'js/game/upgrades.js', 'js/game/pickups.js',
  'js/game/gear.js',   // 装备数据层(XX-EQUIP-002/003) —— main.js 已 import,必须进预缓存
  'assets/portrait/villain-shexie.jpg', 'assets/portrait/villain-nvxia.jpg', 'assets/portrait/villain-yaohou.jpg', 'assets/portrait/villain-youfang.jpg', 'assets/portrait/villain-heifeng.jpg', 'assets/portrait/villain-shougu.jpg',
  'js/ui/hud.js', 'js/ui/codex.js', 'js/ui/bestiary.js', 'js/ui/screens.js', 'js/ui/joystick.js',
];
const XX = [
  'js/xiuxian/index.js', 'js/xiuxian/realms.js', 'js/xiuxian/arts.js', 'js/xiuxian/battle.js',
  'js/xiuxian/world.js', 'js/xiuxian/lore.js', 'js/xiuxian/relations.js', 'js/xiuxian/assets.js',
  'js/xiuxian/ui.js', 'js/xiuxian/duel.js', 'js/xiuxian/items.js', 'js/xiuxian/camp.js',
  'js/xiuxian/merchant.js', 'js/xiuxian/companion.js', 'js/xiuxian/bond.js',
  'js/xiuxian/ritual.js', 'js/xiuxian/loot.js', 'js/xiuxian/family.js', 'js/xiuxian/chronicle.js',
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
  // 程序化生成 + 分层种子 + 局内配置链(V0.97~V0.98)。
  // world.js 已经 import 了 worldgen/seed,vendor/rot-rng 是它们的底座,
  // ui.js 又 import 了 runcfg —— 4 个文件全在静态 import 图上,一个都不能少。
  'js/xiuxian/seed.js', 'js/xiuxian/worldgen.js', 'js/xiuxian/runcfg.js',
  'js/xiuxian/vendor/rot-rng.js',
  // 修仙阁 UI 拆分(XX-AUDIT-005)。ui.js 拆出去之后,ui.js import 这些文件,
  // 它们就在 ui.js 的**静态 import 图**上 —— 原生 ESM 全有或全无,
  // 离线拉不到任意一个就是整页白屏。dom.js 是共享 DOM 辅助(esc/toast),
  // 视图模块和 ui.js 都依赖它,漏掉等于整页转义失效。
  'js/xiuxian/ui/arts.js', 'js/xiuxian/ui/bag.js', 'js/xiuxian/ui/build.js', 'js/xiuxian/ui/dexsys.js', 'js/xiuxian/ui/dom.js', 'js/xiuxian/ui/fam.js', 'js/xiuxian/ui/meta.js', 'js/xiuxian/ui/portrait.js', 'js/xiuxian/ui/realm.js', 'js/xiuxian/ui/story.js', 'js/xiuxian/ui/title.js', 'js/xiuxian/ui/tomb.js',
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
  'assets/portrait/merchant.jpg','assets/mob/bloodriver.jpg','assets/portrait/momocha.jpg',
];
const ASSETS = [...CORE, ...XX, ...ART, 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(V);
    await Promise.allSettled(ASSETS.map(a => cache.add(new Request(a, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)));
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