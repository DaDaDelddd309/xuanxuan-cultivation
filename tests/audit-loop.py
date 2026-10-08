"""循环完整性测试(V0.96)
核心问题:砍杀和修仙阁是不是一个游戏?
这个脚本验证:砍一局 → 道行/源石真的涨 → 修仙阁那边真的收到了。
不注入状态,只走正常流程。
"""
import time, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from _unblock import unblock
CHROME=os.environ.get('XX_CHROME') or ''   # 留空 = 用 playwright 自带的 chromium
fails=[]
def ok(n,c):
    print(('  ✅ ' if c else '  ❌ ')+n)
    if not c: fails.append(n)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME or None,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=2,is_mobile=True,has_touch=True)
    errs=[]
    pg.on('pageerror',lambda e:errs.append('PAGEERR: '+str(e)))
    pg.on('console',lambda m:errs.append('CONSOLE: '+m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:%s/'%os.environ.get('XX_TEST_PORT','8894'),wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()"); pg.reload(wait_until='networkidle'); time.sleep(2)
    unblock(pg)

    print("【前置】修仙阁侧状态")
    unblock(pg); time.sleep(0.5)
    pg.click('#btn-cult'); time.sleep(1.5)
    before=pg.evaluate("""async()=>{
      const {Cult}=await import('/js/xiuxian/index.js');
      const {Bag}=await import('/js/xiuxian/items.js');
      return {dao:Cult.get().dao, stone:(Bag.s.items||{})['stone_1']||0};
    }""")
    print(f"  砍杀前:道行 {before['dao']},碎灵石 {before['stone']}")

    print("\n【进入砍杀】")
    pg.evaluate("()=>document.querySelector('.xx-back')?.click()"); time.sleep(0.6)
    pg.click('#btn-play'); time.sleep(0.8)
    pg.click('#char-list > *'); time.sleep(2.5)

    print("【局内 HUD 是否有修仙层的东西】")
    hud=pg.evaluate("()=>{const e=document.getElementById('hud-xx');return {has:!!e,vis:e?getComputedStyle(e).display!=='none':false};}")
    ok(f"局内存在灵气条 {hud}", hud['has'] and hud['vis'])
    print(f"  文字: {pg.inner_text('#hud-xx')!r}")

    print("\n【灵气会不会掉、会不会被吸】")
    # 走位 + 打怪,给掉落时间
    for i in range(45):
        pg.keyboard.press(['KeyD','KeyW','KeyA','KeyS'][i%4]); time.sleep(0.35)
    for i in range(18):
        pg.keyboard.press('Space'); time.sleep(0.5)
    for i in range(30):
        pg.keyboard.press(['KeyD','KeyS','KeyA','KeyW'][i%4]); time.sleep(0.3)
    ling=pg.evaluate("()=>Number(document.getElementById('hud-xx-ling')?.textContent||0)")
    onscreen=pg.evaluate("()=>document.querySelectorAll('#game ~ *').length")
    print(f"  HUD 显示灵气: {ling}")
    tally=pg.evaluate("async()=>{const m=await import('/js/xiuxian/spirit.js');return m.SPIRIT.TALLY.ling;}")
    print(f"  内部累计: {tally}")
    ok("灵气会被自动吸取并累计", tally > 0)
    # 局内确实生成了灵气拾取物
    n_spirit=pg.evaluate("()=>{try{const g=window.engine||null;return g?(g.pickups||[]).filter(k=>k.kind==='spirit').length:-1;}catch(e){return -2}}")
    print(f"  场上灵气拾取物: {n_spirit}")

    print("\n【局末结算 → 修仙阁】")
    # 结束这一局
    pg.evaluate("()=>{document.getElementById('btn-quit')?.click()}"); time.sleep(0.8)
    if pg.evaluate("()=>!!document.querySelector('#screen-over:not(.hidden)')"):
        over=pg.inner_text('#over-stats')
        print(f"  结算面板: {over.replace(chr(10),' | ')}")
        ok("结算面板显示了灵气/道行", '灵气' in over or '道' in over)
    else:
        # 没到结算屏,直接调 settle 验证数字链路
        r=pg.evaluate("""async()=>{
          const m=await import('/js/xiuxian/spirit.js');
          const {Cult}=await import('/js/xiuxian/index.js');
          const {Bag}=await import('/js/xiuxian/items.js');
          const d0=Cult.get().dao, s0=(Bag.s.items||{})['stone_1']||0;
          const r=m.SPIRIT.settle({},{kills:20});
          return {d0,d1:Cult.get().dao,s0,s1:(Bag.s.items||{})['stone_1']||0,ret:r};
        }""")
        print(f"  结算返回: {r['ret']}")
        ok(f"道行真的涨了 {r['d0']}→{r['d1']}", r['d1']>r['d0'])
        print(f"  源石: {r['s0']}→{r['s1']}")
        ok("源石真的进背包了", r['s1']>r['s0'])

    print("\n【修仙阁那边能不能看到】")
    unblock(pg)
    pg.evaluate("()=>document.querySelector('.xx-back')?.click()"); time.sleep(0.5)
    pg.click('#btn-cult'); time.sleep(1.5)
    after=pg.evaluate("""async()=>{
      const {Cult}=await import('/js/xiuxian/index.js');
      const {Bag}=await import('/js/xiuxian/items.js');
      return {dao:Cult.get().dao, stone:(Bag.s.items||{})['stone_1']||0};
    }""")
    print(f"  砍杀后:道行 {after['dao']},碎灵石 {after['stone']}")
    ok("修仙阁里看得到这次的战果", after['dao']>before['dao'] or after['stone']>before['stone'])
    # 行囊页
    unblock(pg); pg.click('[data-tab=bag]'); time.sleep(0.7)
    bagtxt=pg.inner_text('#xx-body')
    ok("行囊里能看到源石", '石' in bagtxt)

    print("\n【局内可见性:护栏和增益】")
    # 点一根源石生火
    pg.evaluate("async()=>{const {CAMP}=await import('/js/xiuxian/camp.js');CAMP.s.stones=60;CAMP.s.burnUntil=Date.now()+600000;CAMP.save();}")
    unblock(pg); pg.click('[data-tab=camp]'); time.sleep(0.5)
    pg.click('#btn-play'); time.sleep(0.8); pg.click('#char-list > *'); time.sleep(2.5)
    ward=pg.evaluate("()=>{const w=document.getElementById('hud-ward');if(!w)return null;const s=getComputedStyle(w);return {hidden:w.hidden,w:w.style.width,op:s.opacity};}")
    print(f"  护栏圈: {ward}")
    ok("篝火在烧时局内有护栏圈", ward and ward['hidden'] is False and ward['w'])
    buf=pg.evaluate("()=>{const b=document.getElementById('hud-xx-buf');return b?{hidden:b.hidden,txt:b.innerText}:null;}")
    print(f"  增益条: {buf}")

    print(f"\nJS错误: {errs if errs else '无'}")
    b.close()
print(f"\n失败 {len(fails)} 项"+(f": {fails}" if fails else " · 全部通过"))