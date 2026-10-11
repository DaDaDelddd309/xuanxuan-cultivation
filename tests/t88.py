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
    unblock(pg); pg.click('[data-tab=quest]'); time.sleep(0.8)
    print("【支线页里的叙事线】")
    # 开一条叙事线并走完
    # 2026-10-11(XX-AUDIT-033):原来 `for(const b of beats) STORY.arrive(b.node)`
    #   只按 beat 里**写死的 id** 走。但 worldgen.js:234 按 (y,x) 排序逐个发 id,
    #   布局随种子变 → 同一 id 的类型每张图都不同(实测 200 种子:n4 是 secret
    #   仅 44/200、n5 是 elite 仅 18/200、n8 是 boss 仅 5/200)。
    #   于是 beat[2] 之后推不动,实测恒 beat=2 / readyFinish=false。
    #   产品侧第二分支(_typeMatches,story.js:273)本来就允许**任意同类节点**推进
    #   ——实测同一 STORY 实例:按写死 id 走 beat=3/4,按类型走 4/4。
    #   所以这里也按 nodeType 找目标,和真实玩家的走法一致。
    r=pg.evaluate("""async()=>{
      const {STORY,ARCS}=await import('/js/xiuxian/story.js');
      const {WORLD}=await import('/js/xiuxian/world.js');
      STORY.start('hongyi');
      const beats=ARCS.hongyi.beats;
      for(const b of beats){
        let target=b.node;
        if(b.nodeType){
          const hit=(WORLD.nodes||[]).find(n=>n.type===b.nodeType);
          if(hit) target=hit.id;        // 找不到就退回写死的 id,别静默跳过
        }
        if(target) STORY.arrive(target);
      }
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
      // ⚠️ 这里原来只标了 n10 和 n3。但 n3 实测是 **secret** 不是 field,
      //   而 dengshi 支线是 {type:'visit', types:['field'], need:2} ——
      #   凑不够 2 个 field 就永远结不了案。
      //   默认种子下 field 节点实测:n1 n2 n4 n5 n7 n8 n9 n10 n11。
      //   t87 标了 n10+n1+n3(两个 field)所以是绿的,这里漏了 n1。
      Cult.get().visited.n10=true; Cult.get().visited.n1=true; Cult.get().visited.n3=true;
      Cult.commit(); QUEST.save();
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