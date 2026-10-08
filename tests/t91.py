import os as _os;_OUT=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),'_shots');_os.makedirs(_OUT,exist_ok=True)
import os, time
from playwright.sync_api import sync_playwright
CHROME=os.environ.get('XX_CHROME') or ''   # 留空 = 用 playwright 自带的 chromium
errs=[];fails=[]
def unblock(pg,tries=6):
    for _ in range(tries):
        if not pg.evaluate("()=>!!document.querySelector('.xx-ritual,.xx-storycard')"): return
        pg.evaluate("()=>document.querySelectorAll('.xx-ritual,.xx-storycard').forEach(e=>e.remove())")
        time.sleep(0.35)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME or None,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=3,is_mobile=True,has_touch=True)
    pg.on('pageerror',lambda e:errs.append('PAGEERROR: '+str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:%s/'%__import__('os').environ.get('XX_TEST_PORT','8894'),wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()"); pg.reload(wait_until='networkidle'); time.sleep(2)
    unblock(pg)
    ok=lambda n,c: print(('  ✅ ' if c else '  ❌ ')+n) or (None if c else fails.append(n))
    _s=pg.evaluate("()=>{const m=document.title.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    _u=pg.evaluate("()=>{const e=document.querySelector('.game-title small');const m=e.textContent.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    ok(f"标题版本一致({_s})", _s and _s==_u)
    unblock(pg); pg.click('#btn-cult'); time.sleep(1.5)
    unblock(pg); pg.click('[data-tab=people]'); time.sleep(0.8)
    print("【还没坐骑时】")
    t=pg.inner_text('#xx-body')
    ok("显示坐骑与随行", '坐 骑 与 随 行' in t)
    ok("没有属性面板(还没坐骑)", '在 身 之 物' not in t)
    ok("告诉你怎么获得", '古战场' in t and '仙人墓' in t)
    pg.screenshot(path=_OUT+'/m91_empty.png')
    print("【通过剧情解锁】")
    pg.evaluate("""async()=>{
      const S=await import('/js/xiuxian/story.js');
      const T=await import('/js/xiuxian/tomb.js');
      const M=await import('/js/xiuxian/mount.js');
      const Q=await import('/js/xiuxian/quest.js');
      S.STORY.see('qingqiong'); S.STORY.see('baize');
      T.TOMB.s.done=true; T.TOMB.save();
      Q.QUEST.s.done={dengshi:{path:1}}; Q.QUEST.save();
      const got=M.MOUNT.checkUnlocks(); M.MOUNT.save();
      window.__got=got.map(g=>g.id);
    }""")
    got=pg.evaluate("()=>window.__got")
    ok(f"剧情解锁了坐骑 {got}", len(got)>=3)
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3)
    unblock(pg); pg.click('[data-tab=people]'); time.sleep(0.9)
    t=pg.inner_text('#xx-body')
    ok("显示在身之物(属性面板)", '在 身 之 物' in t)
    ok("显示护栏加成", '篝火护栏' in t and '+' in t)
    ok("显示随行攻击", '随行攻击' in t)
    ok("坐骑卡片在", '青 穹' in t)
    ok("随行卡片在", '石 俑 犬' in t)
    pg.screenshot(path=_OUT+'/m91_list.png')
    print("【护栏真的变大】")
    w0=pg.evaluate("async()=>{const B=await import('/js/xiuxian/build.js');return B.BUILD.ward()}")
    # 卸下坐骑
    pg.evaluate("async()=>{const M=await import('/js/xiuxian/mount.js');M.MOUNT.setRide(null);M.MOUNT.setPet(null);}")
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3)
    unblock(pg); pg.click('[data-tab=people]'); time.sleep(0.8)
    w1=pg.evaluate("async()=>{const B=await import('/js/xiuxian/build.js');return B.BUILD.ward()}")
    ok(f"卸下后护栏变小 {w0}→{w1}", w1<w0)
    t=pg.inner_text('#xx-body')
    ok("卸下后属性归零显示", '未骑乘' in t)
    print("【换坐骑】")
    pg.evaluate("async()=>{const M=await import('/js/xiuxian/mount.js');M.MOUNT.get('guibiao');M.MOUNT.setRide('guibiao');}")
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3)
    unblock(pg); pg.click('[data-tab=people]'); time.sleep(0.9)
    ok("骑归鹤表(按钮变卸下)", pg.evaluate("()=>{const b=[...document.querySelectorAll('[data-act=mset]')].find(x=>x.textContent.includes('卸'));return !!b}")==True)
    w2=pg.evaluate("async()=>{const B=await import('/js/xiuxian/build.js');return B.BUILD.ward()}")
    ok(f"护栏又变大 {w1}→{w2}", w2>w1)
    pg.screenshot(path=_OUT+'/m91_ride.png')
    print("【局内真的生效】")
    pg.evaluate("()=>document.querySelector('.xx-back')?.click()"); time.sleep(0.5)
    pg.click('#btn-play'); time.sleep(0.8)
    pg.click('#char-list > *'); time.sleep(2.5)
    stat=pg.evaluate("()=>window.__xxMount||null")
    ok(f"坐骑加成已落局内 {stat}", stat is not None)
    ok("拾取半径被放大(>60)", stat and stat['magnet']>60)
    ok("移速被放大", stat and stat['speed']>163)
    ok("归鹤表数值正确", stat and stat['eff']['pickup']>1.2)
    for i in range(8): pg.keyboard.press('KeyD'); time.sleep(0.2)
    st=pg.evaluate("()=>document.getElementById('hud-timer').textContent")
    ok(f"局内正常 {st}", st!='00:00')
    print("【存档持久化】")
    pg.reload(wait_until='networkidle'); time.sleep(2.5)
    unblock(pg)
    r=pg.evaluate("async()=>{const M=await import('/js/xiuxian/mount.js');M.MOUNT.load();return {ride:M.MOUNT.s.ride,n:M.MOUNT.s.have.length}}")
    ok(f"刷新后坐骑还在 {r}", r['ride']=='guibiao' and r['n']>=4)
    print("\nJS错误:",errs if errs else "无")
    b.close()
print(f"\n失败 {len(fails)} 项"+(f": {fails}" if fails else " · 全部通过"))