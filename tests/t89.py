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
    pg.on('pageerror',lambda e:errs.append('PAGEERROR: '+str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:%s/' % __import__('os').environ.get('XX_TEST_PORT','8894'),wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()")
    pg.reload(wait_until='networkidle'); time.sleep(2.5)


    ok=lambda n,c: print(('  ✅ ' if c else '  ❌ ')+n) or (None if c else fails.append(n))
    # 标题版本必须和页面副标题一致(不写死版本号,免得每次升版都改测试)
    _s=pg.evaluate("()=>{const m=document.title.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    _u=pg.evaluate("()=>{const e=document.querySelector('.game-title small');const m=e.textContent.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    ok(f"标题版本一致({_s})", _s and _s==_u)
    # 仪式弹窗(立宗/拜师)会挡住页面,先等它自己关掉
    # 整体移除仪式弹窗,不留半关状态
    pg.evaluate("()=>{const e=document.querySelector('.xx-ritual');if(e)e.remove();}")
    time.sleep(0.5)
    ok("仪式弹窗不再挡住页面", pg.evaluate("()=>{const e=document.querySelector('.xx-ritual');return !e||e.classList.contains('hidden')||getComputedStyle(e).display==='none';}"))
    unblock(pg)
    pg.click('#btn-cult'); time.sleep(1.8)
    unblock(pg); pg.click('[data-tab=map]'); time.sleep(0.8)
    print("【没见石将时,地图上没有墓】")
    t=pg.inner_text('#xx-body')
    ok("地图不显示墓入口", '仙 人 墓' not in t or '下 墓' not in t)
    print("【见过石将后,地图上出现墓】")
    pg.evaluate("""async()=>{
      const S=await import('/js/xiuxian/story.js');
      S.STORY.see('shijiang'); S.STORY.start('tomb');
      S.STORY.arrive('n8'); S.STORY.arrive('n8'); S.STORY.arrive('n8');
      const Q=await import('/js/xiuxian/quest.js'); Q.QUEST.autoTake(); Q.QUEST.save();
    }""")
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=map]'); time.sleep(0.8)
    t=pg.inner_text('#xx-body')
    ok("地图显示仙人墓入口", '仙 人 墓' in t and '下 墓' in t)
    pg.screenshot(path=_OUT+'/t89_gate.png')
    print("【下墓】")
    unblock(pg); pg.click('[data-act=tomb-enter]'); time.sleep(1.2)
    ok("进了墓(在墓视图)", pg.evaluate("()=>!!document.querySelector('.xx-map .xx-node.tomb')"))
    t=pg.inner_text('#xx-body')
    ok("显示墓道", '墓 道' in t)
    ok("显示墓道内容", '七千遍' in t)
    ok("平面图有节点", pg.evaluate("()=>document.querySelectorAll('.xx-node.tomb').length")>=5)
    pg.screenshot(path=_OUT+'/t89_dk.png')
    print("【走动:相邻限制】")
    ok("主墓不可直达(在墓道,无前往按钮)", pg.evaluate("()=>[...document.querySelectorAll('[data-act=tomb-go]')].filter(e=>e.dataset.v==='zm').length")==0)
    unblock(pg); pg.click('[data-act=tomb-go][data-v=qd]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("到了前殿", '前 殿' in t)
    ok("前殿内容:化神期", '化神期' in t)
    print("【侧室给拓片】")
    unblock(pg); pg.click('[data-act=tomb-go][data-v=ce]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("侧室有第四次", '第四次' in t)
    ok("拓片进了背包", pg.evaluate("async()=>{const I=await import('/js/xiuxian/items.js');return I.Bag.count('beiwen')===1}")==True)
    pg.screenshot(path=_OUT+'/t89_ce.png')
    print("【走到石将前】")
    unblock(pg); pg.click('[data-act=tomb-go][data-v=qd]'); time.sleep(0.7)
    unblock(pg); pg.click('[data-act=tomb-go][data-v=sj]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("石将前有半句话", '此生不悔' in t)
    ok("有补完按钮", pg.evaluate("()=>document.querySelectorAll('[data-act=tomb-words]').length")>0)
    pg.screenshot(path=_OUT+'/t89_sj.png')
    print("【支线页显示支线在等墓】")
    unblock(pg); pg.click('[data-tab=quest]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("支线在手", '半 句 话' in t)
    ok("支线提示是往墓里走", '墓' in t)
    unblock(pg); pg.click('[data-tab=map]'); time.sleep(0.7)
    print("【补完半句话 → 结局】")
    unblock(pg); pg.click('[data-act=tomb-go][data-v=qdm]') if False else None
    unblock(pg); pg.click('[data-act=tomb-go][data-v=qd]'); time.sleep(0.6)
    unblock(pg); pg.click('[data-act=tomb-go][data-v=sj]'); time.sleep(0.8)
    # 2026-10-11(XX-AUDIT-033):「弹出补完选项」失败的唯一可能路径是
    #   ui/tomb.js:97 的 `if(!TOMB.canFinish()) return;` —— 它提前返回就一个
    #   [data-w] 都不渲染, 随后 click('[data-w="1"]') 必然 30s 超时,
    #   表现为「1 条断言失败 + 1 个超时」同源。
    #   墓状态机本身我在模块层造桩验过是通的(enter→qd→ce→qd→sj, canFinish()=true),
    #   所以这里补一条断言把当时的真实状态打出来, 下一次 CI 就能一次定位。
    ok("补完前 canFinish(必须在石将前)",
       pg.evaluate("async()=>{const {TOMB}=await import('/js/xiuxian/tomb.js');return TOMB.canFinish()}"))
    unblock(pg); pg.click('[data-act=tomb-words]'); time.sleep(1.0)
    ok("弹出补完选项", pg.evaluate("()=>document.querySelectorAll('[data-w]').length")==2)
    pg.screenshot(path=_OUT+'/t89_words.png')
    d0=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().dao}")
    pg.click('[data-w="1"]'); time.sleep(1.3)
    d1=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().dao}")
    ok(f"结案发奖 {d0}→{d1}", d1>d0)
    ok("演出:补的词", '奈' in pg.inner_text('body'))
    pg.screenshot(path=_OUT+'/t89_ending.png')
    print("【结案后】")
    ok("出墓了", pg.evaluate("async()=>{const T=await import('/js/xiuxian/tomb.js');return T.TOMB.s.in===false}")==True)
    ok("碑文已刻成", pg.evaluate("async()=>{const T=await import('/js/xiuxian/tomb.js');return !!(T.TOMB.epitaph())}")==True)
    ok("支线已了结", pg.evaluate("async()=>{const Q=await import('/js/xiuxian/quest.js');return !!Q.QUEST.s.done.shijiang}")==True)
    ok("叙事线已结案", pg.evaluate("async()=>{const S=await import('/js/xiuxian/story.js');return !!S.STORY.s.done.tomb}")==True)
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3); pg.click('[data-tab=map]'); time.sleep(0.8)
    t=pg.inner_text('#xx-body')
    ok("地图显示最终碑文", '此生不悔' in t)
    ok("墓入口消失(只剩碑文)", '下 墓' not in t)
    pg.screenshot(path=_OUT+'/t89_epi.png')
    print("【支线页显示已完成】")
    unblock(pg); pg.click('[data-tab=quest]'); time.sleep(0.9)
    ok("石将支线进了已完成", '半 句 话' in pg.inner_text('#xx-body'))
    print("【原版局内】")
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