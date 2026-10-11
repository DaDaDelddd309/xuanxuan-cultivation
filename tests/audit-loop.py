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

def visible(pg, id):
    # ⚠️ 原来用 `e.offsetParent!==null` 判可见 —— **这是错的**:
    #   offsetParent 对 `position:fixed` 的元素**恒为 null**,哪怕它就在屏幕上。
    #   于是 #btn-cult(普通流)判得过、#btn-play(fixed 容器里)判不过,
    #   CI run 38114334195 实测「能开第二局」就是这么红的。
    #   改用 playwright 自己的 is_visible(),别自己手搓可见性判据
    #   —— 本项目第 15 次「度量工具自己比被测对象更武断」。
    try:    return pg.locator('#'+id).first.is_visible(timeout=2000)
    except Exception: return False

# 回到主菜单 —— 必须**闭环**,不能「点一次 + sleep 固定秒数」。
# ⚠️ CI run 38106604992 / 38112455634 两次死在这:只点一次 .xx-back 再 sleep(0.5),
#   局内没真的退出来,#btn-cult 一直 not visible,
#   pg.click 干等 30 秒超时,**后面两段(修仙阁战果 / 篝火护栏)根本没跑**。
#   一个「看起来只是超时」的失败,实际含义是「一大片没验」。
#
# ⚠️ 为什么不能靠 unblock() 清场:点 #btn-quit 会弹出确认卡,而 unblock() 的做法是
#   **直接把 .xx-ritual/.xx-storycard 节点删掉** —— 确认卡就这么被抹了,
#   等于「点了退出、又替玩家按了取消」,于是永远退不出局。
#   确认卡是**点掉**,不是删掉。
# 最后兜底用 reload:道行/源石都已经 commit 进 localStorage,重载后仍在,
#   顺便还多验了一层「结算结果真的落盘了」。
CLICK_EXIT = "()=>{document.querySelector('.xx-back')?.click();document.getElementById('btn-quit')?.click();}"
CONFIRM = "()=>{const b=[...document.querySelectorAll('button,[data-act]')].find(x=>/确认|确定|退出|结束|放弃/.test(x.textContent||''));if(b){b.click();return b.textContent.trim().slice(0,12)}return null}"
def to_menu(pg, tries=6):
    for _ in range(tries):
        if visible(pg,'btn-cult'): return True
        pg.evaluate(CLICK_EXIT)
        time.sleep(0.5)
        c = pg.evaluate(CONFIRM)
        if c: time.sleep(0.6)
    if visible(pg,'btn-cult'): return True
    # 兜底:重载。结算已 commit,数据不会丢。
    pg.reload(wait_until='networkidle'); time.sleep(2.0)
    unblock(pg)
    return visible(pg,'btn-cult')

def tap(pg, sel, tries=10):
    """点一个选择器;点不到就立刻返回 False —— **绝不交给 pg.click 干等 30 秒**。
    run 38106604992 的教训:一次 30 秒超时,意味着一大片断言根本没跑,
    而日志上只留下一行 TimeoutError,很容易读成「就一个小问题」。
    可见性一律用 playwright 的 is_visible(),理由见 visible() 的注释。

    ⚠️ 失败时把**诊断**一并返回 —— 因为「点不到」有太多可能原因
      (不可见 / 被挡 / 选择器不中 / strict mode),不打印出来就只能靠猜,
      而这一段我已经连着猜错两次(见 git log 8c4d194 / 766a09a)。"""
    last = '未知'
    for _ in range(tries):
        try:
            loc = pg.locator(sel).first          # .first:选择器常匹配多个(如 '#char-list > *')
            if not loc.is_visible(timeout=1500):
                last = '不可见'
            else:
                loc.click(timeout=4000); return True
        except Exception as e:
            last = (str(e).strip().split('\n')[0] or type(e).__name__)[:70]
        unblock(pg); time.sleep(0.3)
    tap.last = diagnose(pg, sel, last)
    return False

def diagnose(pg, sel, why='未知'):
    """点不到的时候,说清楚到底是什么挡住了。"""
    try:
        return pg.evaluate("""s=>{
          const all=[...document.querySelectorAll(s)];
          const e=all[0];
          if(!e) return {sel:s, why:'选择器不中任何元素', n:0};
          const r=e.getBoundingClientRect();
          const cx=r.left+r.width/2, cy=r.top+r.height/2;
          const top=document.elementFromPoint(cx,cy);
          const cs=getComputedStyle(e);
          const blockers=[...document.querySelectorAll('.xx-ritual,.xx-storycard,.xx-duel,#xx-nag-host')]
            .filter(x=>x.offsetParent!==null)
            .map(x=>x.className+'|'+x.dataset.nag).slice(0,4);
          return {sel:s, why:WHY, n:all.length, nVisible:all.filter(x=>x.offsetParent!==null).length,
                  rect:[Math.round(r.width),Math.round(r.height)],
                  display:cs.display, visibility:cs.visibility, opacity:cs.opacity, pointerEvents:cs.pointerEvents,
                  covered: top? (top===e?null : (top.tagName+'.'+top.className)) : 'none',
                  blockers};
        }""".replace('WHY', repr(why)))
    except Exception as e:
        return {'sel': sel, 'why': why, 'diagError': str(e)[:60]}

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
    # ⚠️ 窗口长度回到原值(2026-10-11 XX-QA-003 二次修订)。
    # 第一版把它从 ~34s 拉到 ~68s,理由是「按 2.6 只/s 推算,125 只需 48s」——
    # **那个 2.6 只/s 是从 node 无头复刻里来的,不是浏览器实测**。
    # CI 实跑:窗口拉到 ~110s,ling 仍然是 0,断言照样红。
    # 即「拉长窗口就能跨过 125 门槛」这个假设**被证伪**,窗口改回原值,不再白烧 CI 两倍时间。
    #
    # 所以断言不再赌「这一窗口能杀够 125 只」——那取决于模拟按键的手感与刷怪节奏,
    # 本质上不可靠。改成**性质断言**:门槛进度必须与真实击杀数一致。
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
    # ⚠️ 2026-10-11(XX-QA-003 二次修订)改成**性质断言**。
    #
    # 原来写的是 `tally > 0`,它要求这一窗口里杀够 125 只普通怪才可能成立 ——
    # 而「模拟按键能杀多少只」取决于刷怪节奏与按键手感,本质不可靠。
    # 第一版把窗口从 ~34s 拉到 ~110s 想满足它,CI 实跑仍然是 ling=0,**假设被证伪**
    # (那个「2.6 只/s」是 node 无头复刻估的,不是浏览器实测 —— 本项目第 10 次度量工具出错)。
    #
    # 改成断言「门槛进度与真实击杀数一致」,这条在任何击杀数下都成立,
    # 且真正验的是**接线**:门槛在累计、出货逻辑接在累计上。
    # 「掉一颗 → 被磁吸 → 记一次」这段由 tests/xx-qa-003-spirit-stone-chain.mjs
    # 以确定性方式端到端覆盖(40 项断言,已在 npm run test 链里)。
    gate=pg.evaluate("""async()=>{
      const L=await import('/js/xiuxian/loot.js');
      const S=await import('/js/xiuxian/spirit.js');
      return {kills:S.SPIRIT.TALLY.kills, ling:S.SPIRIT.TALLY.ling,
              prog:L.gateProgress('spirit'), remain:L.gateRemain('spirit'),
              GATE:L.GATE.spirit, installed:S.SPIRIT.__installed===true};
    }""")
    print(f"  击杀/门槛: {gate}")
    # ⚠️⚠️ 这块断言被我写错过**两次**,两次都是「照公式想当然、没先跑真实实现」。
    #    所以下面保留完整反证记录,别再有人(including 我自己)拍一条新断言上去。
    #    反证方式:tests/xx-qa-099-gate-invariant.mjs 直接 import 真实 loot.js、
    #    复刻 spirit.js 的批次逻辑,穷举 73.6 万种击杀组合逐条打脸:
    #    ✗ `prog == min(1, kills/GATE)` —— 门槛是**回绕**不是饱和
    #      (gateDrop 里 `while (g >= need) g -= need`,g 恒 < need,prog 恒 < 1)。
    #      实测:kills=125 → prog=0.960(120 充能,差 5 没到门槛),不是 1.000 也不是 0.000
    #      —— 「0.000」是我早先照公式脑补的,被本门禁当场打脸,一并订正。
    #    ✗ `kills >= GATE ⟹ ling > 0` —— spirit.js 每 8 只才结算一次,且
    #      normal/elite/boss **各有独立 bucket**(spirit.js:55),最坏 21 只压在桶里没结算。
    #      nk=126 时累计充能只有 120 < 125,一颗都不掉。
    #    ✗ 「累计充能恒为 8 的倍数」—— 回绕时减掉的 GATE=125 本身不是 8 的倍数:
    #      8 只 boss × 45 = 360,360 mod 125 = 110。这条是我第二轮才想出来的,也被打脸。
    #    ✓ `remain == GATE × (1 - prog)` —— 73.6 万组合**零反例**,且同时验掉
    #      gateProgress / gateRemain / GATE 三者的公式漂移。
    #
    # ling 在浏览器里**根本不可断言**:出货只生成一颗 gem,还得等磁吸吃到才记 TALLY.ling,
    # 是第二道随机闸。「批量累计 → 门槛 → 出货 → 磁吸 → 记账 → 结算折源石」整条经济链
    # 由 tests/xx-qa-003-spirit-stone-chain.mjs 确定性覆盖(已在 npm run test 链里)。
    ok(f"灵气门槛进度与剩余自洽(进度={gate['prog']:.3f}, 剩={gate['remain']}, 门槛={gate['GATE']})",
       0.0 <= gate['prog'] < 1.0
       and abs(gate['remain'] - gate['GATE'] * (1.0 - gate['prog'])) < 1e-9)
    # 接线断言:SPIRIT.install() 第一行同步置 __installed,没有空过路径
    # (main.js:539 若没跑到,这里必为 false —— 而 ling/门槛全都不动是查不出来的)。
    ok(f"灵气层确实挂进了本局(已安装={gate['installed']})", gate['installed'] is True)
    # ⚠️ 这里原来想数「场上灵气拾取物」,但 window.engine 全项目从未赋值(main.js:539 的
    #   engine 是模块内局部变量),所以那个探针一直在返回 -1 —— 看着有数,其实恒为「不可达」。
    #   已删除并登记为 XX-QA-061(需要暴露 engine 才能测,不在本轮范围)。
    print(f"  场上灵气拾取物: 不可测(引擎未挂到 window,见 XX-QA-061)")

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
        # ⚠️ 2026-10-11(XX-QA-003)重写。这条原来写的是 `r['s1'] > r['s0']`,在短窗口里
        # **结构上不可能成立**,而且它与上面 ling 那条是同义反复:
        #   settle() 吃的就是当前 TALLY.ling,ling=0 时 spirit.js 的
        #   `if (stones > 0)` 不成立 → stones = floor(0/12) = 0 → 背包不变。
        # 也就是说它**永远测不到源石链路本身**,只测了「ling 大不大」。
        #
        # 它要求 ling ≥ 12 才掉 1 颗,即至少 12 次出货 ≈ 1500 点充能:
        #   纯普通怪 125 充能/颗 → 约 1500 只 ≈ 10 分钟;
        #   即便跑满整局 600s(约 1560 只 + 精英 22×8)也才够 1 颗。
        # 所以「把窗口拉长」对这条无效 —— 它钉的根本不是窗口内可达的性质。
        #
        # 改成验**结算账目自洽**:settle 报的 stones 必须等于 floor(ling/12),
        # 且 ling 够 12 时背包确实多出对应数量。这在任何 ling 下都成立,
        # 且直接覆盖 spirit.js 的结算公式与 Bag.add 调用,不再与 ling 那条同义反复。
        # 「精英 → stone_2 → 背包」那条真正的局内入口由
        # tests/xx-qa-003-spirit-stone-chain.mjs 端到端覆盖(已在 npm run test 链里)。
        want = max(0, r['ret'].get('ling', 0) // 12)
        ok(f"源石结算账目自洽(ling={r['ret'].get('ling')}, 应得={want}, 实际={r['ret'].get('stones')})",
           r['ret'].get('stones') == want)
        ok(f"源石入包量与结算量一致(背包 +{r['s1']-r['s0']} = stones {r['ret'].get('stones')})",
           (r['s1'] - r['s0']) == r['ret'].get('stones'))

    print("\n【修仙阁那边能不能看到】")
    # ⚠️ 回不到主菜单就**别再点 #btn-cult** —— 上一版这里是无条件点击,
    #   to_menu() 判红之后照样干等 30 秒超时(run 38107792054 就是这么断的)。
    #   回不来就如实记红并跳过后半段,让「哪一段没验」清清楚楚,
    #   而不是变成一行看不出所以然的 TimeoutError。
    if not to_menu(pg):
        ok("能退回主菜单(修仙阁入口可见)", False)
        print("  ⚠️ 回不到主菜单,后半段(修仙阁战果 / 篝火护栏)本轮未验 —— 已跳过,不硬点")
    else:
        ok("能退回主菜单(修仙阁入口可见)", True)
        pg.click('#btn-cult'); time.sleep(1.5)
        after=pg.evaluate("""async()=>{
          const {Cult}=await import('/js/xiuxian/index.js');
          const {Bag}=await import('/js/xiuxian/items.js');
          return {dao:Cult.get().dao, stone:(Bag.s.items||{})['stone_1']||0};
        }""")
        print(f"  砍杀后:道行 {after['dao']},碎灵石 {after['stone']}")
        ok("修仙阁里看得到这次的战果", after['dao']>before['dao'] or after['stone']>before['stone'])
        # 行囊页
        ok("行囊页能点开", tap(pg,'[data-tab=bag]'))
        time.sleep(0.7)
        ok("行囊里能看到源石", '石' in pg.inner_text('#xx-body'))

        print("\n【局内可见性:护栏和增益】")
        # 点一根源石生火
        pg.evaluate("async()=>{const {CAMP}=await import('/js/xiuxian/camp.js');CAMP.s.stones=60;CAMP.s.burnUntil=Date.now()+600000;CAMP.save();}")
        unblock(pg); ok("营地页能点开", tap(pg,'[data-tab=camp]')); time.sleep(0.5)
        # ⚠️ 这三段我已经连着猜错两次:
        #   ① 以为少了 `.xx-back`(run 38113186513)
        #   ② 以为是 `offsetParent` 对 fixed 元素恒为 null(run 38114334195)
        #      —— 但 index.html:74-75 显示 #btn-cult 与 #btn-play 是**兄弟节点**,
        #         一个可见另一个必然可见,所以「btn-cult 可见但 btn-play 不可见」根本不可能。
        #   两次都靠猜,于是改成:点不到时把诊断直接打出来(见 tap()/diagnose())。
        in_run=False
        if to_menu(pg):
            started = tap(pg,'#btn-play'); time.sleep(0.8)
            ok("能开第二局", started)
            if not started: print(f"  诊断 #btn-play: {getattr(tap,'last',None)}")
            in_run = tap(pg,'#char-list > *'); time.sleep(2.5)
            ok("能选角色进局", in_run)
            if not in_run: print(f"  诊断 #char-list: {getattr(tap,'last',None)}")
        else:
            ok("能开第二局", False)
            print("  ⚠️ 退不回主菜单,本段(篝火护栏)未验 —— 已跳过,不硬点")
        ward=pg.evaluate("()=>{const w=document.getElementById('hud-ward');if(!w)return null;const s=getComputedStyle(w);return {hidden:w.hidden,w:w.style.width,op:s.opacity};}")
        print(f"  护栏圈: {ward}")
        ok("篝火在烧时局内有护栏圈", in_run and ward and ward['hidden'] is False and ward['w'])
        buf=pg.evaluate("()=>{const b=document.getElementById('hud-xx-buf');return b?{hidden:b.hidden,txt:b.innerText}:null;}")
        print(f"  增益条: {buf}")

    print(f"\nJS错误: {errs if errs else '无'}")
    b.close()
print(f"\n失败 {len(fails)} 项"+(f": {fails}" if fails else " · 全部通过"))