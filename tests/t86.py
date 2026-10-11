import os as _os;_OUT=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),'_shots');_os.makedirs(_OUT,exist_ok=True)
import os, time
from playwright.sync_api import sync_playwright
# 2026-10-11(XX-AUDIT-033):本地 unblock 已删除,改用 tests/_unblock.py 的共享版。
#   原因:本地版只清 .xx-ritual / .xx-storycard,**完全看不见 .xx-duel**。
#   而 .xx-duel 是 `position:absolute;inset:0;z-index:80` 的全屏层(css/xiuxian.css:723),
#   一旦回合制战斗开着,它物理上挡住**所有**点击 → Page.click 30s 超时。
#   共享版会先点「逃/退/认输」走正规退出路径,再兜底移除。
#   这 5 个文件(t86/t87/t88/t89/full79)在 CI 上全部因 Page.click 超时红,
#   症状完全一致 —— 同一个根因,不是 5 个独立 bug。
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _unblock import unblock

CHROME=os.environ.get('XX_CHROME') or ''   # 留空 = 用 playwright 自带的 chromium
errs=[];fails=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME or None,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=3,is_mobile=True,has_touch=True)
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:%s/' % __import__('os').environ.get('XX_TEST_PORT','8894'),wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()")
    pg.reload(wait_until='networkidle'); time.sleep(2.5)


    ok=lambda n,c: print(('  ✅ ' if c else '  ❌ ')+n) or (None if c else fails.append(n))
    # 统一开场:清档 + 关掉仪式弹窗(命名灵伴/立宗),否则会挡住后续点击
    pg.evaluate("()=>localStorage.clear()")
    pg.reload(wait_until='networkidle'); time.sleep(1.5)
    # 仪式弹窗(命名灵伴)必须走完或整个关掉,不能关一半——半关状态会留下输入框却没有选项
    pg.evaluate("()=>{const e=document.querySelector('.xx-ritual');if(e)e.remove();}")
    time.sleep(0.4)
    # 标题版本必须和 index.html 源码一致(不写死版本号,免得每次升版都改测试)
    _src = pg.evaluate("()=>{const t=document.querySelector('title').textContent;const m=t.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    _ui  = pg.evaluate("()=>{const e=document.querySelector('.game-title small');const m=e.textContent.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    ok(f"标题版本一致({_src})", _src and _src==_ui)
    if pg.evaluate("()=>!!document.getElementById('rt-name')"):
        pg.fill('#rt-name','小桃'); pg.click('#rt-go'); time.sleep(0.5)
        pg.click('.rt-opt'); time.sleep(0.5)
        if pg.evaluate("()=>!!document.getElementById('rt-ok')"): pg.click('#rt-ok'); time.sleep(0.5)
    unblock(pg)
    pg.click('#btn-cult'); time.sleep(1.2)
    print("【地图迷雾 + 叙事标记】")
    unblock(pg); pg.click('[data-tab=map]'); time.sleep(0.8)
    ok("未去过是迷雾", pg.evaluate("()=>document.querySelectorAll('.xx-node.fog').length")>0)
    ok("迷雾显示 ?", pg.evaluate("()=>document.querySelectorAll('.xx-fogq').length")>0)
    pg.screenshot(path=_OUT+'/shot_fog.png')
    # 开一条线,验证叙事标记
    pg.evaluate("""async()=>{const {STORY}=await import('/js/xiuxian/story.js');STORY.start('hongyi');}""")
    unblock(pg); pg.click('[data-tab=realm]');time.sleep(0.2);pg.click('[data-tab=map]');time.sleep(0.7)
    ok("有叙事标记 !", pg.evaluate("()=>document.querySelectorAll('.xx-node-st').length")>0)
    ok("显示'眼下之事'", '眼 下 之 事' in pg.inner_text('#xx-body'))
    pg.screenshot(path=_OUT+'/shot_story.png')
    print("【抵达触发叙事】")
    pg.evaluate("""async()=>{const {STORY}=await import('/js/xiuxian/story.js');
      const {Hall}=await import('/js/xiuxian/ui.js');Hall.arrive('n0');}""")
    time.sleep(1.2)
    ok("弹出叙事卡", pg.evaluate("()=>!!document.querySelector('.xx-storycard')"))
    ok("卡片有名字", '红 嫁 衣' in pg.inner_text('.xx-storycard') if pg.evaluate("()=>!!document.querySelector('.xx-storycard')") else False)
    pg.screenshot(path=_OUT+'/shot_beat.png')
    pg.evaluate("()=>{const e=document.querySelector('.xx-storycard'); if(e)e.remove();}")
    print("【传说妖谱】")
    unblock(pg); pg.click('[data-tab=dex]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("有传说妖谱标题", '传 说 妖 谱' in t)
    for n in ['红衣女鬼','黑山姥姥','白泽','当康','青穹','剑骨','墓前石将','灯尸']:
        if n not in t: print(f'     缺 {n}')
    ok("8种传说妖都在", all(n in t for n in ['红衣女鬼','黑山姥姥','白泽','当康','青穹','剑骨','墓前石将','灯尸']))
    ok("未见的打码", pg.evaluate("()=>document.querySelectorAll('.xx-dxx.unseen').length")>0)
    ok("传说妖立绘加载", pg.evaluate("()=>[...document.querySelectorAll('.xx-dxx img')].filter(i=>i.naturalWidth>0).length")>=8)
    pg.screenshot(path=_OUT+'/shot_legend.png')
    print("【昼夜】")
    # 2026-10-11(XX-AUDIT-033):原来写 `DAY.s.actions`,但那是**镜像字段**——
    #   items.js:192 的 phase() 只是 `return CLOCK.phase()`,而 clock.js:116 的
    #   hour() = floor(dayProgress()*24),dayProgress() 读的是 CLOCK.s.ms。
    #   直接写 DAY.s.actions 对 phase() 毫无影响,4 次循环全拿到同一个 key。
    #   真源是 CLOCK.s.ms,换算基准用 CLOCK_CONST.DAY_MS,不再写死 12。
    r=pg.evaluate("""async()=>{const {Ambience:A}=await import('/js/xiuxian/ambience.js');
      const {CLOCK,CLOCK_CONST}=await import('/js/xiuxian/clock.js');
      const out={};
      for(const h of [6,12,18,22]){ CLOCK.s.ms=Math.round(h/24*CLOCK_CONST.DAY_MS);
        const ph=A.phase(); out[ph.key]={fog:ph.fog,bright:ph.bright,mul:ph.mul}; }
      return out;}""")
    ok(f"4个时段渲染 {list(r.keys())}", len(r)>=3)
    ok("夜雾最浓", r.get('night',{}).get('fog',0)>r.get('day',{}).get('fog',9))
    ok("夜怪最强", r.get('night',{}).get('mul',0)>r.get('day',{}).get('mul',9))
    ok("晨怪最弱", r.get('dawn',{}).get('mul',9)<r.get('day',{}).get('mul',9))
    print("【局内】")
    pg.evaluate("()=>document.querySelector('.xx-back')?.click()"); time.sleep(0.5)
    unblock(pg)
    pg.click('#btn-play'); time.sleep(0.8)
    pg.click('#char-list > *'); time.sleep(2.5)
    for i in range(6): pg.keyboard.down('KeyD'); time.sleep(0.35); pg.keyboard.up('KeyD')  # 按住不放:input.js 的 move() 读 keys,keyup 就删 → press 等于没动
    st=pg.evaluate("()=>document.getElementById('hud-timer').textContent")
    ok(f"局内正常 {st}", st!='00:00')
    print("\nJS错误:",errs if errs else "无")
    b.close()
print(f"\n失败 {len(fails)} 项"+(f": {fails}" if fails else " · 全部通过"))