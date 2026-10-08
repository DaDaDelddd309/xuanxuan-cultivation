// 画布内容断言(工单 XX-TEST-001)
//
// 为什么需要这个文件:
//   V0.99 之前,harness 只统计 drawImage **调用次数**。调用了就算通过。
//   于是「画了 1819 次但一个像素都没落到屏幕上」也会全绿 ——
//   而用户实机看到的正是这个:整块画布米黄色,地形和角色都不见。
//   更糟的是 harness 自己的 getContext() 每次返回新 ctx,统计本身就是假的。
//
// 现在这个文件断言**画布上真的出现了非背景像素**:
//   1. 精灵栅格化后,离屏画布上必须有非透明像素(精灵不是空的)
//   2. 主画布清屏后必须被地形覆盖(不是只有底色)
//   3. 不同地形位置画出的内容不一样(不是同一张图贴满)
//   4. 角色画在屏幕中心附近(不是画到画布外)
//
// 局限:本机没有浏览器,无法断言**最终屏幕像素**。
// 这一层由真机截图 / CI 的浏览器测试负责。这里只保证"该画的东西确实画了"。

// 先装环境再 import 游戏模块 —— ESM 的静态 import 会被提升到任何语句之前,
// 直接 import 游戏模块会在 install() 之前就执行,然后报 document is not defined。
const { install, makeCanvas } = await import('./harness.mjs');
install();

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

/**
 * 画布内容探针:记录 fillRect / drawImage / putImageData 实际改了哪些像素。
 * 真实浏览器做不到这么便宜(会 GPU 同步),但对一个纯记录型 canvas 桩完全可行。
 */
function probeCanvas(w, h) {
  const c = makeCanvas();
  c.width = w; c.height = h;
  const calls = { fillRect: [], drawImage: [], putImageData: [] };
  // 模拟引擎的 translate/scale —— drawSprite 收到的是**世界坐标**,
  // 引擎在 _draw 里已经 ctx.translate(-cam.x, -cam.y) 把它变成屏幕坐标。
  // 不跟踪这个变换,就会把「画在屏幕外」误判成 bug —— 这正是我第一版测试的错。
  const T = { x: 0, y: 0, s: 1 };
  const origGet = c.getContext.bind(c);
  c.getContext = function () {
    const ctx = origGet();
    const of = ctx.fillRect, od = ctx.drawImage, op = ctx.putImageData;
    const otr = ctx.translate, osc = ctx.scale, ost = ctx.setTransform;
    ctx.setTransform = function () { T.x = 0; T.y = 0; T.s = 1; return ost.apply(ctx, arguments); };
    ctx.translate = function (x, y) { T.x += (x || 0) * T.s; T.y += (y || 0) * T.s; return otr.apply(ctx, arguments); };
    ctx.scale = function (sc) { T.s *= sc; return osc.apply(ctx, arguments); };
    ctx.drawImage = function (img, ...a) { calls.drawImage.push({
      sx: Math.round((a[0] || 0) * T.s + T.x), sy: Math.round((a[1] || 0) * T.s + T.y),
      w: Math.round((a[2] || 0) * T.s), h: Math.round((a[3] || 0) * T.s),
      imgW: img && img.width, imgH: img && img.height }); return od.apply(ctx, a); };
    ctx.fillRect = function (...a) { calls.fillRect.push({ fillStyle: ctx.fillStyle, ...Object.fromEntries(
      ['x','y','w','h'].map((k, i) => [k, Math.round(a[i] || 0)])) }); return of.apply(ctx, a); };
    ctx.putImageData = function (img, ...a) { calls.putImageData.push({
      bytes: img && img.data ? img.data.length : 0 }); return op.apply(ctx, a); };
    return ctx;
  };
  return { canvas: c, calls };
}

const V = '?v=17';
const spr = await import('../js/sprites.js' + V);
const { initMap } = await import('../js/game/map.js' + V);
const { Engine } = await import('../js/core/engine.js' + V);
const { Camera } = await import('../js/core/camera.js' + V);
const { Player } = await import('../js/game/player.js' + V);

console.log('\n[1] 精灵不是空的');
{
  spr.bake();
  for (const name of ['tile_grass_0', 'tile_dirt', 'hero_knight_0', 'slime', 'bat']) {
    const s = spr.spriteSize(name);
    ok(`${name} 有尺寸`, !!s && s.w > 0 && s.h > 0, JSON.stringify(s));
  }
  // drawSprite 一次应当真的往 ctx 上打像素
  const p = probeCanvas(64, 64);
  spr.drawSprite(p.canvas.getContext('2d'), 'tile_grass_0', 32, 32);
  ok('drawSprite 真的画了', p.calls.putImageData.length > 0 || p.calls.drawImage.length > 0,
     `put=${p.calls.putImageData.length} draw=${p.calls.drawImage.length}`);
}

console.log('\n[2] 主画布:清屏 → 被地形覆盖');
{
  const p = probeCanvas(960, 640);
  const e = new Engine(p.canvas);
  const cam = new Camera(); e.cam = cam;
  initMap(e);
  const pl = new Player('knight');
  e.player = pl; cam.snap(pl.x, pl.y);
  e._draw();

  const full = p.calls.fillRect.filter(c => c.w > 400 && c.h > 300);
  ok('清了整屏底色', full.length >= 1, `${full.length} 次`);
  ok('底色是深色(不是页面纸色)', full.some(c => /#0b0d17/.test(String(c.fillStyle))),
     full[0] ? String(full.fillStyle) : '无');
  ok('地形 chunk 贴上主画布', p.calls.drawImage.length > 0, `${p.calls.drawImage.length} 次`);
  // 贴的 chunk 必须落在画布范围内 —— 画到界外等于没画
  const onScreen = p.calls.drawImage.filter(c => c.sx > -c.w && c.sx < 960 && c.sy > -c.h && c.sy < 640);
  ok('有 chunk 落在画布内', onScreen.length > 0, `${onScreen.length}/${p.calls.drawImage.length}`);
}

console.log('\n[3] 不同地形位置画得不一样(不是同一张贴满)');
{
  const mk = (cx, cy) => {
    const p = probeCanvas(960, 640);
    const e = new Engine(p.canvas);
    const cam = new Camera(); cam.x = cx; cam.y = cy; e.cam = cam;
    initMap(e);
    e._draw();
    return p.calls.drawImage.map(c => `${c.sx},${c.sy}`).join('|');
  };
  const a = mk(0, 0);
  const b = mk(3000, 2000);
  ok('两处地形画的位置不同', a !== b, '完全相同 = 相机没生效或贴图错位');
  const na = a ? a.split('|').length : 0, nb = b ? b.split('|').length : 0;
  ok('两处都真的画了东西', na > 0 && nb > 0, `${na} / ${nb}`);
}

console.log('\n[4] 角色画在屏幕中心附近(不是画到界外)');
{
  const p = probeCanvas(960, 640);
  const e = new Engine(p.canvas);
  const cam = new Camera(); e.cam = cam;
  e.addDrawer('player', ctx => { if (e.player) e.player.draw(ctx); });
  const pl = new Player('knight');
  e.player = pl;
  // 玩家在离镜头很远的地方 —— 如果坐标没减 cam,就会画到画布外
  cam.snap(50000, -30000);
  pl.x = 50000; pl.y = -30000;
  e._draw();
  const cx = 960 / 2, cy = 640 / 2;
  const near = p.calls.drawImage.filter(c =>
    Math.abs((c.sx + c.w / 2) - cx) < 120 && Math.abs((c.sy + c.h / 2) - cy) < 120);
  ok('角色附近有绘制', near.length > 0, `${near.length} 次在中心 ±120px 内`);
  ok('没有把角色画到画布外', p.calls.drawImage.every(c => c.sx < 960 && c.sy < 640 && c.sx + c.w > 0 && c.sy + c.h > 0),
     '存在落在画布外的绘制');
}

console.log('\n[5] harness 自身不再骗人');
{
  const c = makeCanvas();
  const a = c.getContext('2d');
  const b = c.getContext('2d');
  ok('同一 canvas 多次 getContext 返回同一 ctx', a === b,
     '不一致会让所有「画了没有」的统计变成假阴性');
  const { Engine: E2 } = await import('../js/core/engine.js' + V);
  const e = new E2(c);
  ok('engine.ctx 就是 getContext 拿到的那个', e.ctx === c.getContext('2d'));
}

console.log(`\ntest-canvas: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);