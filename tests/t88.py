import os as _os;_OUT=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),'_shots');_os.makedirs(_OUT,exist_ok=True)
import os, time
from playwright.sync_api import sync_playwright
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
    def unblock(pg, tries=6):
        """清掉挡住页面的全屏层(仪式/结算卡)。测试里任何点击前都该先调。"""
        for _ in range(tries):
            if not pg.evaluate("()=>!!document.querySelector('.xx-ritual,.xx-storycard')"): return
            pg.evaluate("()=>document.querySelectorAll('.xx-ritual,.xx-storycard').forEach(e=>e.remove())")
            time.sleep(0.35)


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
    unblock(pg); pg.click('[data-tab=quest]'); time.sleep(0.8)
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
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=quest]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("支线页显示待了结区块", '看 完 了' in t)
    ok("显示叙事线名", '红 嫁 衣' in t or '红嫁衣' in t)
    ok("有「了结」按钮", pg.evaluate("()=>document.querySelectorAll('[data-act=sfinal]').length")>0)
    pg.screenshot(path=_OUT+'/shot_sfinal.png')
    print("【选结局发奖】")
    d0=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().dao}")
    unblock(pg); pg.click('[data-act=sfinal]'); time.sleep(1.0)
    ok("弹出结局选择", pg.evaluate("()=>!!document.querySelector('.xx-storycard')"))
    ok("两个结局选项", pg.evaluate("()=>document.querySelectorAll('.xx-sc-go[data-p]').length")==2)
    pg.screenshot(path=_OUT+'/shot_epchoice.png')
    pg.click('.xx-sc-go[data-p="1"]'); time.sleep(1.2)
    d1=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().dao}")
    ok(f"结案发奖 {d0}→{d1}", d1>d0)
    ok("弹出奖励结算", pg.evaluate("()=>document.querySelectorAll('.xx-storycard').length")>0)
    pg.screenshot(path=_OUT+'/shot_epdone.png')
    pg.evaluate("()=>document.querySelectorAll('.xx-storycard').forEach(e=>e.remove())")
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=quest]'); time.sleep(0.8)
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
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=quest]'); time.sleep(0.9)
    ok("传说妖支线可结", pg.evaluate("()=>document.querySelectorAll('[data-act=qdone]').length")>0)
    print("【局内】")
    pg.evaluate("()=>document.querySelector('.xx-back')?.click()"); time.sleep(0.5)
    unblock(pg)
    pg.click('#btn-play'); time.sleep(0.8)
    pg.click('#char-list > *'); time.sleep(2.5)
    for i in range(8): pg.keyboard.press('KeyD'); time.sleep(0.2)
    st=pg.evaluate("()=>document.getElementById('hud-timer').textContent")
    ok(f"局内正常 {st}", st!='00:00')
    print("\nJS错误:",errs if errs else "无")
    b.close()
print(f"\n失败 {len(fails)} 项"+(f": {fails}" if fails else " · 全部通过"))