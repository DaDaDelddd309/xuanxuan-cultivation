"""实机审计:玩家在正常流程里到底能不能拿到坐骑。
不注入任何状态,只点 UI,看真实可达性。
"""
import time, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from _unblock import unblock
CHROME=os.environ.get('XX_CHROME') or ''   # 留空 = 用 playwright 自带的 chromium
fails=[];warns=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME or None,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=2,is_mobile=True,has_touch=True)
    errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:%s/'%os.environ.get('XX_TEST_PORT','8894'),wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()"); pg.reload(wait_until='networkidle'); time.sleep(2)
    unblock(pg)
    ok=lambda n,c: print(('  ✅ ' if c else '  ❌ ')+n) or (None if c else fails.append(n))
    warn=lambda n,c: print(('  ⚠️ ' if not c else '  · ')+n) or (None if not c else warns.append(n))

    unblock(pg); pg.click('#btn-cult'); time.sleep(1.5)

    print("【审计 1:MOUNT.checkUnlocks 到底有没有接线】")
    r=pg.evaluate("""()=>{
      // 找出 mount.js 导出对象的所有方法,看哪个在主循环里被调
      return {hasFn: typeof window.MOUNT_dbg};
    }""")
    # 直接读源码判断
    src=pg.evaluate("async()=>{const t=await (await fetch('/js/xiuxian/ui.js')).text();return t;}")
    called = 'MOUNT.checkUnlocks()' in src
    ok("checkUnlocks 在抵达节点流程里被调用", called)
    # 全项目扫
    hits=pg.evaluate("""async()=>{
      const files=['/js/xiuxian/ui.js','/js/main.js','/js/xiuxian/quest.js','/js/xiuxian/story.js'];
      const out=[];
      for(const f of files){const t=await (await fetch(f)).text();
        if(t.includes('checkUnlocks')) out.push(f);}
      return out;
    }""")
    warn(f"checkUnlocks 的实际调用点: {hits if hits else '无 —— 玩家永远拿不到坐骑'}", False)

    print("【审计 2:MOUNT 模块本身有没有被加载】")
    loaded=pg.evaluate("async()=>{try{const m=await import('/js/xiuxian/mount.js');return !!m.MOUNT;}catch(e){return 'ERR:'+e.message}}")
    ok(f"mount.js 可加载 {loaded}", loaded is True)

    print("【审计 3:正常走图,能不能自然见到传说妖】")
    # 直接走 n8(妖巢,青穹在这) —— 用 UI 点
    unblock(pg); pg.click('[data-tab=map]'); time.sleep(0.8)
    # 传送到 n8 需要先访问过。直接点相邻节点逐步走
    visited_before=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Object.keys(Cult.get().visited)}")
    print(f"  初始已访问: {visited_before}")
    # 尝试逐个点可达节点
    for nid in ['n1','n2','n3','n10','n9','n6','n4','n5','n7','n8']:
        unblock(pg)
        n=pg.evaluate(f"()=>document.querySelectorAll('[data-act=travel][data-v=\"{nid}\"]').length")
        if n==0: 
            print(f"  {nid}: 当前不可达(相邻限制),跳过")
            continue
        pg.click(f'[data-act=travel][data-v={nid}]'); time.sleep(1.0)
        met=pg.evaluate("async()=>{const {STORY}=await import('/js/xiuxian/story.js');return STORY.metList()}")
        print(f"  {nid}: 已见={met}")
    final_met=pg.evaluate("async()=>{const {STORY}=await import('/js/xiuxian/story.js');return STORY.metList()}")
    print(f"\n  走完一圈见过的妖: {final_met if final_met else '一个都没有'}")

    print("【审计 4:见到妖之后,坐骑发了吗】")
    got=pg.evaluate("async()=>{const {MOUNT}=await import('/js/xiuxian/mount.js');return {have:MOUNT.s.have,ride:MOUNT.s.ride}}")
    print(f"  坐骑: {got}")
    ok("正常流程能拿到至少一个坐骑", len(got['have'])>0)

    print("【审计 5:UI 上能看到坐骑吗】")
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3)
    unblock(pg); pg.click('[data-tab=people]'); time.sleep(0.8)
    t=pg.inner_text('#xx-body')
    ok("人物页有坐骑区", '坐 骑 与 随 行' in t)
    if len(got['have'])==0:
        print("  ⚠️  玩家一个坐骑都没有,只能看到「还没有」的空态提示")

    print("【审计 6:全屏卡不重叠】")
    over=pg.evaluate("()=>document.querySelectorAll('.xx-storycard').length")
    ok(f"同一时刻只有一张全屏卡(现在 {over} 张)", over<=1)
    print(f"\nJS错误: {errs if errs else '无'}")
    b.close()
print(f"\n失败 {len(fails)} 项, 警告 {len(warns)} 项")
if warns: print("警告:", warns)
