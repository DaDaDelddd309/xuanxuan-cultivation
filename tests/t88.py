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
    ok("标题 V0.88", 'V0.88' in pg.title())
    if pg.evaluate("()=>!!document.getElementById('rt-name')"):
        pg.fill('#rt-name','小桃'); pg.click('#rt-go'); time.sleep(0.5)
        pg.click('.rt-opt'); time.sleep(0.5)
        if pg.evaluate("()=>!!document.getElementById('rt-ok')"): pg.click('#rt-ok'); time.sleep(0.5)
    pg.click('#btn-cult'); time.sleep(1.2)
    pg.click('[data-tab=quest]'); time.sleep(0.8)
    print("【支线页里的叙事线】")
    # 开一条叙事线并走完
    r=pg.evaluate("""async()=>{
      const {STORY}=await import('/js/xiuxian/story.js');
      STORY.start('hongyi');
      const M=await import('/js/xiuxian/story.js'); const beats=M.ARCS.hongyi.beats;
      for(const b of beats) STORY.arrive(b.node);
      return {beat:STORY.s.beat.hongyi, ready:STORY.readyFinish('hongyi'),
              done:!!STORY.s.done.hongyi, readyN:STORY.readyList().length};
    }""")
    ok(f"走完4环 beat={r['beat']} 待结案={r['ready']}", r['ready'] is True and r['done'] is False)
    pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=quest]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("支线页显示待了结区块", '看 完 了' in t)
    ok("显示叙事线名", '红 嫁 衣' in t or '红嫁衣' in t)
    ok("有「了结」按钮", pg.evaluate("()=>document.querySelectorAll('[data-act=sfinal]').length")>0)
    pg.screenshot(path='/workspace/probe/shot_sfinal.png')
    print("【选结局发奖】")
    d0=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().dao}")
    pg.click('[data-act=sfinal]'); time.sleep(1.0)
    ok("弹出结局选择", pg.evaluate("()=>!!document.querySelector('.xx-storycard')"))
    ok("两个结局选项", pg.evaluate("()=>document.querySelectorAll('.xx-sc-go[data-p]').length")==2)
    pg.screenshot(path='/workspace/probe/shot_epchoice.png')
    pg.click('.xx-sc-go[data-p="1"]'); time.sleep(1.2)
    d1=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().dao}")
    ok(f"结案发奖 {d0}→{d1}", d1>d0)
    ok("弹出奖励结算", pg.evaluate("()=>document.querySelectorAll('.xx-storycard').length")>0)
    pg.screenshot(path='/workspace/probe/shot_epdone.png')
    pg.evaluate("()=>document.querySelectorAll('.xx-storycard').forEach(e=>e.remove())")
    pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=quest]'); time.sleep(0.8)
    t=pg.inner_text('#xx-body')
    ok("结案后不再待选", pg.evaluate("()=>document.querySelectorAll('[data-act=sfinal]').length")==0)
    ok("结案按钮消失", '看 完 了' not in t)
    print("【支线仍正常】")
    pg.evaluate("""async()=>{
      const {STORY}=await import('/js/xiuxian/story.js');
      const {QUEST}=await import('/js/xiuxian/quest.js');
      const {Cult}=await import('/js/xiuxian/index.js');
      QUEST.s.active=[]; QUEST.s.done={};
      STORY.see('dengshi'); QUEST.autoTake();
      Cult.get().visited.n10=true; Cult.get().visited.n3=true; Cult.commit(); QUEST.save();
    }""")
    pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=quest]'); time.sleep(0.9)
    ok("传说妖支线可结", pg.evaluate("()=>document.querySelectorAll('[data-act=qdone]').length")>0)
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