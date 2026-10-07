import time
from playwright.sync_api import sync_playwright
CHROME='/workspace/.home/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
errs=[];fails=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=3,is_mobile=True,has_touch=True)
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:8894/',wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()")
    pg.reload(wait_until='networkidle'); time.sleep(2.5)
    ok=lambda n,c: print(('  ✅ ' if c else '  ❌ ')+n) or (None if c else fails.append(n))
    ok("标题 V0.86", 'V0.86' in pg.title())
    if pg.evaluate("()=>!!document.getElementById('rt-name')"):
        pg.fill('#rt-name','小桃'); pg.click('#rt-go'); time.sleep(0.5)
        pg.click('.rt-opt'); time.sleep(0.5)
        if pg.evaluate("()=>!!document.getElementById('rt-ok')"): pg.click('#rt-ok'); time.sleep(0.5)
    pg.click('#btn-cult'); time.sleep(1.2)
    print("【地图迷雾 + 叙事标记】")
    pg.click('[data-tab=map]'); time.sleep(0.8)
    ok("未去过是迷雾", pg.evaluate("()=>document.querySelectorAll('.xx-node.fog').length")>0)
    ok("迷雾显示 ?", pg.evaluate("()=>document.querySelectorAll('.xx-fogq').length")>0)
    pg.screenshot(path='/workspace/probe/shot_fog.png')
    # 开一条线,验证叙事标记
    pg.evaluate("""async()=>{const {STORY}=await import('/js/xiuxian/story.js');STORY.start('hongyi');}""")
    pg.click('[data-tab=realm]');time.sleep(0.2);pg.click('[data-tab=map]');time.sleep(0.7)
    ok("有叙事标记 !", pg.evaluate("()=>document.querySelectorAll('.xx-node-st').length")>0)
    ok("显示'眼下之事'", '眼 下 之 事' in pg.inner_text('#xx-body'))
    pg.screenshot(path='/workspace/probe/shot_story.png')
    print("【抵达触发叙事】")
    pg.evaluate("""async()=>{const {STORY}=await import('/js/xiuxian/story.js');
      const {Hall}=await import('/js/xiuxian/ui.js');Hall.arrive('n0');}""")
    time.sleep(1.2)
    ok("弹出叙事卡", pg.evaluate("()=>!!document.querySelector('.xx-storycard')"))
    ok("卡片有名字", '红 嫁 衣' in pg.inner_text('.xx-storycard') if pg.evaluate("()=>!!document.querySelector('.xx-storycard')") else False)
    pg.screenshot(path='/workspace/probe/shot_beat.png')
    pg.evaluate("()=>{const e=document.querySelector('.xx-storycard'); if(e)e.remove();}")
    print("【传说妖谱】")
    pg.click('[data-tab=dex]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("有传说妖谱标题", '传 说 妖 谱' in t)
    for n in ['红衣女鬼','黑山姥姥','白泽','当康','青穹','剑骨','墓前石将','灯尸']:
        if n not in t: print(f'     缺 {n}')
    ok("8种传说妖都在", all(n in t for n in ['红衣女鬼','黑山姥姥','白泽','当康','青穹','剑骨','墓前石将','灯尸']))
    ok("未见的打码", pg.evaluate("()=>document.querySelectorAll('.xx-dxx.unseen').length")>0)
    ok("传说妖立绘加载", pg.evaluate("()=>[...document.querySelectorAll('.xx-dxx img')].filter(i=>i.naturalWidth>0).length")>=8)
    pg.screenshot(path='/workspace/probe/shot_legend.png')
    print("【昼夜】")
    r=pg.evaluate("""async()=>{const {Ambience:A}=await import('/js/xiuxian/ambience.js');
      const {DAY}=await import('/js/xiuxian/items.js');
      const out={};
      for(const h of [6,12,18,22]){ DAY.s.actions=Math.round(h/24*12);
        const ph=A.phase(); out[ph.key]={fog:ph.fog,bright:ph.bright,mul:ph.mul}; }
      return out;}""")
    ok(f"4个时段渲染 {list(r.keys())}", len(r)>=3)
    ok("夜雾最浓", r.get('night',{}).get('fog',0)>r.get('day',{}).get('fog',9))
    ok("夜怪最强", r.get('night',{}).get('mul',0)>r.get('day',{}).get('mul',9))
    ok("晨怪最弱", r.get('dawn',{}).get('mul',9)<r.get('day',{}).get('mul',9))
    print("【局内】")
    pg.evaluate("()=>document.querySelector('.xx-back')?.click()"); time.sleep(0.5)
    pg.click('#btn-play'); time.sleep(0.8)
    pg.click('#char-list > *'); time.sleep(2.5)
    for i in range(8): pg.keyboard.press('KeyD'); time.sleep(0.2)
    st=pg.evaluate("()=>document.getElementById('hud-timer').textContent")
    ok(f"局内正常 {st}", st!='00:00')
    print("\nJS错误:",errs if errs else "无")
    b.close()
print(f"\n失败 {len(fails)} 项"+(f": {fails}" if fails else " · 全部通过"))