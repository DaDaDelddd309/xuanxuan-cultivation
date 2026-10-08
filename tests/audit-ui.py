"""全面 UI 审计:每个页面截一张图,外加局内。
只看不改,目的是把「不一致」找出来。
"""
import os as _os;_OUT=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),'_shots');_os.makedirs(_OUT,exist_ok=True)
import time, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from _unblock import unblock
CHROME=os.environ.get('XX_CHROME') or ''   # 留空 = 用 playwright 自带的 chromium
OUT=_OUT
os.makedirs(OUT, exist_ok=True)

TABS=['realm','map','camp','arts','bag','people','title','fam','build','dex','quest','sys']

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME or None,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=2,is_mobile=True,has_touch=True)
    errs=[]
    pg.on('pageerror',lambda e:errs.append('PAGEERR: '+str(e)))
    pg.on('console',lambda m:errs.append('CONSOLE: '+m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:%s/'%os.environ.get('XX_TEST_PORT','8894'),wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()"); pg.reload(wait_until='networkidle'); time.sleep(2)
    unblock(pg)
    print('== 修仙阁能否打开 ==')
    pg.click('#btn-cult'); time.sleep(1.8)
    tabs=pg.evaluate("()=>[...document.querySelectorAll('[data-tab]')].map(e=>e.dataset.tab)")
    print('实际标签:', tabs)

    print('\n== 逐页截图 ==')
    for t in TABS:
        unblock(pg)
        try:
            pg.click(f'[data-tab={t}]'); time.sleep(0.9)
        except Exception as ex:
            print(f'  {t}: 点击失败 {ex}'); continue
        body = pg.inner_text('#xx-body') if pg.evaluate("()=>!!document.getElementById('xx-body')") else ''
        h = pg.evaluate("()=>document.getElementById('xx-body').scrollHeight")
        print(f'  {t}: {len(body)} 字, {h}px 高')
        pg.screenshot(path=f'{OUT}/{t}.png')

    print('\n== 空态检查:每页第一屏有没有东西 ==')
    for t in TABS:
        unblock(pg); pg.click(f'[data-tab={t}]'); time.sleep(0.6)
        vis=pg.evaluate("""()=>{
          const b=document.getElementById('xx-body');
          if(!b) return 'no-body';
          const cards=b.querySelectorAll('.xx-card,.xx-val,.xx-title-i,.xx-dxx,.xx-ch');
          return cards.length;
        }""")
        print(f'  {t}: {vis} 个内容块')

    print('\n== 样式一致性:逐页统计边框/圆角/背景 ==')
    unblock(pg); pg.click('[data-tab=realm]'); time.sleep(0.6)
    stats=pg.evaluate("""()=>{
      const out={};
      for(const sel of ['.xx-card','.xx-btn','.xx-title-i','.xx-art','.xx-val']){
        const els=[...document.querySelectorAll(sel)].slice(0,6);
        if(!els.length) continue;
        out[sel]=els.map(e=>{
          const s=getComputedStyle(e);
          return {b:s.borderTopWidth+'/'+s.borderTopColor, r:s.borderRadius, bg:s.backgroundColor.slice(0,28)};
        });
      }
      return out;
    }""")
    for k,v in stats.items():
        print(f'  {k}:')
        for x in v[:3]: print('     ',x)

    print('\nJS错误:', errs if errs else '无')
    b.close()
print('\n截图目录:', OUT)