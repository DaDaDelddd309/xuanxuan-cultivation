# t90 · 浏览器实测:「音乐」开关必须真的管住 mp3 BGM(XX-AUDIT-023)
#
# 为什么这条必须在**浏览器**里,而 tests/music-toggle-mp3-regression.mjs 不够:
#
#   那条 node 回归用的是**假 Audio 类** —— 它能验「逻辑对不对」
#   (pause 被调用、音量归 0、cur 被清掉),但验不了三件事:
#     ① 真实 <audio> 元素的 play()/pause()/volume 行为
#     ② 设置面板那个复选框 → applySetting → Bus 广播 → assets.js 的**整条接线**
#     ③ 自动播放策略下,关掉开关能不能让正在响的 BGM **立刻**停
#
# 而这三件恰恰是玩家唯一看得见的部分。
# 浏览器套件里此前**零覆盖** —— 全仓提到 setEnabled/music-setting/setMusic 的
# 只有 3 个文件(live-site-check / audio-level / music-toggle-mp3),没有一个是 .py。
# full79.py 里唯一碰 BGM 的一行是 `ok(..., BGM.cur is not None)`,跟开关无关。
#
# 修法:assets.js 的 setEnabled() + applySetting 的 Bus 广播,
# 改完必须在这条里被真的点出来,否则下一次「简化」又会悄悄退回原样。
#
# 用例结构照 t91.py(自起 server 由 run-browser.sh 提供,端口走 XX_TEST_PORT)。
import os as _os;_OUT=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),'_shots');_os.makedirs(_OUT,exist_ok=True)
import os, time
from playwright.sync_api import sync_playwright

CHROME = os.environ.get('XX_CHROME') or ''
PORT = _os.environ.get('XX_TEST_PORT', '8894')
errs = []; fails = []
ok = lambda n, c: print(('  ✅ ' if c else '  ❌ ') + n) or (None if c else fails.append(n))

# 音频状态读取:一次拿全,避免反复 evaluate
AUD = """()=>{const a=[...document.querySelectorAll('audio')];return {
  n:a.length, src:a[0]?a[0].getAttribute('src'):null, vol:a[0]?a[0].volume:null,
  paused:a[0]?a[0].paused:null, muted:a[0]?a[0].muted:null }}"""
# 切歌走真实的 Bus 事件(与 relations.BGM 实际发出的同一条路)
BGM = """async(t)=>{const {Bus}=await import('/js/core/engine.js');
  const R=await import('/js/xiuxian/relations.js');
  const B=(await import('/js/xiuxian/relations.js')).BGM;
  Bus.emit('bgm',{track:t}); return true}"""
# 点设置面板里那个「音乐」复选框(走 UI,不直接调 applySetting)
TOGGLE_MUSIC = """()=>{const L=[...document.querySelectorAll('#menu-toggles label.tg')]
  .find(l=>(l.querySelector('span')||{}).textContent==='音乐');
  if(!L) return null; const cb=L.querySelector('input');
  const before=cb.checked; cb.click(); return {before, after:cb.checked}}"""

with sync_playwright() as p:
    # no-user-gesture-required:没有它,headless 里 audio.play() 会被自动播放策略拒掉,
    # 于是 paused 恒为 true —— 那样「关开关能不能停」这条断言就恒真,等于没测。
    b = p.chromium.launch(executable_path=CHROME or None,
                          args=['--no-sandbox', '--disable-dev-shm-usage',
                                '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':412,'height':915}, device_scale_factor=3,
                    is_mobile=True, has_touch=True)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f'http://127.0.0.1:{PORT}/', wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()"); pg.reload(wait_until='networkidle'); time.sleep(2)

    print('【设置面板里有没有「音乐」开关】')
    has = pg.evaluate(TOGGLE_MUSIC)
    ok('菜单里有「音乐」复选框', has is not None)
    if has is None:
        print('\nJS错误:', errs if errs else '无'); b.close()
        raise SystemExit(1)
    print(f'  初始状态 checked={has["before"]}')

    # 确保是「音乐开着」再往下走(初始值由 clear 后的默认值决定,这里显式对齐)
    if not has['before']:
        pg.evaluate(TOGGLE_MUSIC); time.sleep(0.4)

    print('【音乐开着时切歌 → mp3 应该真的响】')
    pg.evaluate(BGM, 'bgm_nemesis'); time.sleep(0.8)
    a = pg.evaluate(AUD)
    print(f'  audio 元素 {a["n"]} 个 · src={a["src"]} · volume={a["vol"]} · paused={a["paused"]}')
    ok('切歌后创建了 <audio> 元素', a['n'] >= 1, f'实测 {a["n"]} 个')
    ok('src 指向宿敌 BGM 的 mp3', (a['src'] or '').endswith('nemesis.mp3'), str(a['src']))
    ok('用的是 MP3_VOL=0.42(不是合成音的 master 0.2)', a['vol'] is not None and abs(a['vol'] - 0.42) < 1e-6, str(a['vol']))
    ok('元素不在暂停态(真的在播)', a['paused'] is False, f'paused={a["paused"]}')
    n_before = a['n']

    print('【用 UI 把音乐关掉 → 正在响的 BGM 必须立刻停】')
    pg.evaluate(TOGGLE_MUSIC); time.sleep(0.6)
    ok('复选框已切到关闭', pg.evaluate("()=>{const L=[...document.querySelectorAll('#menu-toggles label.tg')].find(l=>(l.querySelector('span')||{}).textContent==='音乐');return L.querySelector('input').checked}") is False)
    a2 = pg.evaluate(AUD)
    print(f'  关掉后 paused={a2["paused"]} · volume={a2["vol"]}')
    ok('关开关会暂停正在播的 mp3', a2['paused'] is True, f'paused={a2["paused"]}')
    ok('关开关会把音量归 0', a2['vol'] is not None and abs(a2['vol']) < 1e-9, f'volume={a2["vol"]}')

    print('【关着的时候再切歌,不许偷偷出声】')
    pg.evaluate(BGM, 'bgm_overlord'); time.sleep(0.6)
    a3 = pg.evaluate(AUD)
    ok('不再创建新的 audio 元素', a3['n'] == n_before, f'{n_before} → {a3["n"]}')
    ok('仍然处于暂停态', a3['paused'] is True, f'paused={a3["paused"]}')
    ok('音量仍是 0', a3['vol'] is not None and abs(a3['vol']) < 1e-9, f'volume={a3["vol"]}')

    print('【重新打开音乐,同一首要能再响(这条最容易悄悄退化)】')
    pg.evaluate(TOGGLE_MUSIC); time.sleep(0.6)
    a4 = pg.evaluate(AUD)
    ok('开回来后音量恢复 MP3_VOL', a4['vol'] is not None and abs(a4['vol'] - 0.42) < 1e-6, f'volume={a4["vol"]}')
    pg.evaluate(BGM, 'bgm_nemesis'); time.sleep(0.8)
    a5 = pg.evaluate(AUD)
    ok('同一首曲目能再次播放(cur 没被记死)', a5['paused'] is False, f'paused={a5["paused"]}')
    ok('src 仍是宿敌 BGM', (a5['src'] or '').endswith('nemesis.mp3'), str(a5['src']))

    print('【存档持久化:刷新后开关状态还在,且仍生效】')
    pg.reload(wait_until='networkidle'); time.sleep(2)
    st = pg.evaluate("()=>{const L=[...document.querySelectorAll('#menu-toggles label.tg')].find(l=>(l.querySelector('span')||{}).textContent==='音乐');return L?L.querySelector('input').checked:null}")
    ok('刷新后音乐开关仍为开', st is True, f'checked={st}')

    print('【反过来:存档里就是关的,冷启动不该出声】')
    pg.evaluate("()=>localStorage.setItem('pxs_save', JSON.stringify({v:1,gold:0,chars:['knight'],settings:{sfx:true,music:false,shake:true,lowgfx:false,fpsShow:false},best:{},gear:{},totalRuns:0,totalKills:0}))")
    pg.reload(wait_until='networkidle'); time.sleep(2)
    pg.evaluate(BGM, 'bgm_nemesis'); time.sleep(0.8)
    a6 = pg.evaluate(AUD)
    ok('音乐关着时冷启动后切歌不播', a6['paused'] is not False, f'paused={a6["paused"]}')
    ok('音乐关着时音量是 0', a6['vol'] is not None and abs(a6['vol']) < 1e-9, f'volume={a6["vol"]}')

    pg.screenshot(path=_OUT + '/m90_music_toggle.png')
    print('\nJS错误:', errs if errs else '无')
    b.close()

print(f"\n失败 {len(fails)} 项" + (f": {fails}" if fails else ' · 全部通过'))