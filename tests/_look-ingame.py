import time, os
from playwright.sync_api import sync_playwright
CHROME='/workspace/.home/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
CARD_HTML = (
  "<div class='xx-sc-n'>灯 尸</div>"
  "<div class='xx-sc-t'>纸人扎成的队伍,本是给死人引路的。后来引错了方向。</div>"
  "<div class='xx-sc-r'>夜里听见远处有铃,别应。那是灯尸在问路。</div>"
  "<div class='xx-sc-x'>记住了</div>"
)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':412,'height':915},device_scale_factor=3,is_mobile=True,has_touch=True)
    pg.goto('http://127.0.0.1:%s/'%os.environ.get('XX_TEST_PORT','8970'),wait_until='networkidle')
    pg.evaluate("()=>localStorage.clear()");pg.reload(wait_until='networkidle');time.sleep(2)
    pg.evaluate("()=>document.querySelectorAll('.xx-ritual,.xx-duel').forEach(e=>e.remove())")
    pg.click('#btn-play');time.sleep(0.8);pg.click('#char-list > *');time.sleep(3)
    for i in range(10): pg.keyboard.press('KeyD'); time.sleep(0.15)
    # 局内画面上直接放一张叙事卡
    pg.evaluate("""(html)=>{
      const e=document.createElement('div');
      e.className='xx-storycard legend'; e.innerHTML=html;
      document.body.appendChild(e);
    }""", CARD_HTML)
    time.sleep(1.0)
    pg.screenshot(path='/workspace/probe/v93_ingame.png')
    print('局内截图完成')
    b.close()