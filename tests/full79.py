from playwright.sync_api import sync_playwright
import time, json
CHROME='/workspace/.home/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
errs=[]; fails=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=3,is_mobile=True,has_touch=True)
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:%s/' % __import__('os').environ.get('XX_TEST_PORT','8894'),wait_until='networkidle'); time.sleep(1.5)
    def unblock(pg, tries=6):
        """清掉挡住页面的全屏层(仪式/结算卡)。测试里任何点击前都该先调。"""
        for _ in range(tries):
            if not pg.evaluate("()=>!!document.querySelector('.xx-ritual,.xx-storycard')"): return
            pg.evaluate("()=>document.querySelectorAll('.xx-ritual,.xx-storycard').forEach(e=>e.remove())")
            time.sleep(0.35)


    ok=lambda n,c: print(('  ✅ ' if c else '  ❌ ')+n) or (None if c else fails.append(n))
    pg.evaluate("()=>localStorage.clear()")
    pg.reload(wait_until='networkidle'); time.sleep(1.5)
    print("【原版回归】")
    _s=pg.evaluate("()=>{const m=document.title.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    _u=pg.evaluate("()=>{const e=document.querySelector('.game-title small');const m=e.textContent.match(/V(\\d+\\.\\d+)/);return m?m[1]:''}")
    ok(f"标题版本一致({_s})", _s and _s==_u)
    ok("修仙阁入口", pg.evaluate("()=>!!document.getElementById('btn-cult')"))
    unblock(pg)
    pg.click('#btn-play'); time.sleep(0.7)
    pg.click('#char-list > *'); time.sleep(2)
    for i in range(14):
        pg.keyboard.down('KeyD'); time.sleep(0.14); pg.keyboard.up('KeyD'); pg.keyboard.press('Space')
    st=pg.evaluate("()=>({hp:document.getElementById('hud-hp-text').textContent,t:document.getElementById('hud-timer').textContent})")
    ok(f"局内运行 {st['hp']} {st['t']}", st['t']!='00:00')
    px=pg.evaluate("""()=>{const c=document.getElementById('game'),x=c.getContext('2d');
      const d=x.getImageData(0,0,c.width,c.height).data;let n=0;
      for(let i=0;i<d.length;i+=400)if(Math.abs(d[i]-240)>14)n++;return (n/(d.length/400)*100)}""")
    ok(f"Canvas 渲染 {px:.1f}%", px>5)
    print("【修仙阁】")
    # 局内出来后会弹仪式(命名灵伴/立宗),先关掉再进修仙阁
    pg.evaluate("async()=>{const m=await import('/js/xiuxian/ritual.js');m.Ritual.close();}")
    time.sleep(0.6)
    pg.evaluate("()=>{document.getElementById('btn-quit')?.click()}"); time.sleep(0.6)
    pg.evaluate("()=>{document.getElementById('btn-pause')?.click()}"); time.sleep(0.5)
    pg.click('#btn-resume'); time.sleep(0.4)
    pg.reload(wait_until='networkidle'); time.sleep(1.6)
    pg.evaluate("async()=>{try{const m=await import('/js/xiuxian/ritual.js');m.Ritual.close();}catch(e){}}")
    time.sleep(0.5)
    unblock(pg)
    pg.click('#btn-cult'); time.sleep(1.5)
    ok("打开", pg.evaluate("()=>!document.querySelector('.xx-screen').classList.contains('hidden')"))
    ok("境界渲染", pg.evaluate("()=>document.querySelectorAll('#xx-body .xx-card').length")>0)
    for t in ['map','arts','people','title','realm']:
        pg.click(f'[data-tab={t}]'); time.sleep(0.4)
        n=pg.evaluate("()=>document.querySelectorAll('#xx-body *').length")
        ok(f"标签 {t} ({n}节点)", n>5)
    # 地图移动
    unblock(pg); pg.click('[data-tab=map]'); time.sleep(0.4)
    before=pg.evaluate("()=>document.querySelector('.xx-node.cur')?.dataset.v")
    pg.evaluate("()=>{const n=[...document.querySelectorAll('.xx-node:not(.locked)')].find(x=>x.dataset.v!==document.querySelector('.xx-node.cur').dataset.v); n?.click()}")
    time.sleep(0.7)
    after=pg.evaluate("()=>document.querySelector('.xx-node.cur')?.dataset.v")
    ok(f"地图移动 {before}→{after}", before!=after)
    ok("野地不打断(回合制未弹)", pg.evaluate("()=>!document.querySelector('.xx-duel')||document.querySelector('.xx-duel').classList.contains('hidden')"))
    ok("修仙阁仍在", pg.evaluate("()=>!document.querySelector('.xx-screen').classList.contains('hidden')"))
    # 吐纳 + 存档持久化
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.3)
    unblock(pg); pg.click('[data-act=meditate]'); time.sleep(0.5)
    # 吐纳加的是修为(exp),道行(dao)只在年表推进时才涨 —— 查 exp 才对
    dao=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().exp}")
    pg.reload(wait_until='networkidle'); time.sleep(1.5)
    pg.evaluate("async()=>{try{const m=await import('/js/xiuxian/ritual.js');m.Ritual.close();}catch(e){}}")
    time.sleep(0.5)
    unblock(pg)
    pg.click('#btn-cult'); time.sleep(1.5)
    dao2=pg.evaluate("async()=>{const {Cult}=await import('/js/xiuxian/index.js');return Cult.get().exp}")
    ok(f"存档持久化 exp {dao}→{dao2}", dao==dao2 and dao not in (None,'0'))
    print("【回合制】")
    r=pg.evaluate("""async()=>{
      const {Duel}=await import('/js/xiuxian/duel.js');
      const {Cult}=await import('/js/xiuxian/index.js');
      Cult.get().arts={jianqi:5,wulei:3}; Cult.commit();
      Duel.start({node:{id:'n5',type:'elite',name:'黑风岭'},hero:{img:'assets/portrait/hero.jpg',realmIdx:0},
        foe:{name:'黑风散修',title:'炼气中期',img:'assets/portrait/foe.jpg',realmIdx:0,stronger:false,isNemesis:false},
        onWin:()=>{},onLose:()=>{}});
      await new Promise(r=>setTimeout(r,600));
      Duel.busy=false; Duel.playerTurn();
      return {bg:document.querySelector('.xx-duel-bg').dataset.src,
              skills:[...document.querySelectorAll('.xx-sk')].length,
              rods:document.querySelectorAll('.xx-rod').length,
              imgs:[...document.querySelectorAll('.xx-face img')].filter(i=>i.naturalWidth>0).length};
    }""")
    ok(f"场景背景 {r['bg']}", r.get('bg') is not None)
    ok(f"技能栏 {r['skills']} 个", r['skills']==2)
    ok(f"立轴木杆 {r['rods']} 根", r['rods']==4)
    ok(f"立绘加载 {r['imgs']}/2", r['imgs']==2)
    time.sleep(0.6)
    hp0=pg.evaluate("()=>DuelHp=document.getElementById('xd-epb').style.width")
    pg.click('.xx-sk'); time.sleep(1.6)
    hp1=pg.evaluate("()=>document.getElementById('xd-epb').style.width")
    ok(f"出招扣血 {hp0}→{hp1}", hp0!=hp1)
    r2=pg.evaluate("""async()=>{const m=await import('/js/xiuxian/relations.js');return m.BGM.cur}""")
    ok(f"BGM 状态 {r2}", r2 is not None)
    print("\nJS错误:",errs if errs else "无")
    b.close()
print(f"\n{'='*36}\n失败 {len(fails)} 项" + (f": {fails}" if fails else " · 全部通过") + f"\n{'='*36}")
