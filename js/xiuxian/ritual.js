// ===== 开局仪式 · 只做一件事:取名字(V0.98)=====
// 可爱卡通小灵(纯 CSS 绘制,无外部资源):眨眼、飘、发丝
//
// V0.98 改动(工单 XX-COMP-005):
//   旧版第 2 步是「你愿意亲我一下吗?」三选一 —— 路线 kiss/cold/ghost。
//   但 owner 的判断是对的:「每次都是几选一,这叫随机?这叫有感情的?」
//   选项只改数值、不改行为,是点击农场,不是选择。
//   所以整段删掉:开局只问名字,直接进游戏。
//   三条路线随之消失(灵伴三形也不再存在)。
import { COMPANION } from './companion.js';

const $ = (t, c, h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };

let root, tmpName = '';

export const Ritual = {
  // 需要时调用:未命名 → 播放
  async start(force) {
    if (!force && COMPANION.born()) return false;
    this.build();
    tmpName = '';
    root.classList.remove('hidden');
    root.style.display = '';
    this.render();
    // 兜底:仪式不困住玩家。90 秒不动 → 默认「宝宝」直接过
    clearTimeout(this._auto);
    this._auto = setTimeout(() => {
      if (!root || root.classList.contains('hidden')) return;
      if (!COMPANION.born()) COMPANION.init('宝宝');
      this.close();
    }, 90000);
    return true;
  },

  close() {
    clearTimeout(this._auto);
    if (!root) return;
    root.classList.add('hidden');
    root.style.display = 'none';
  },

  build() {
    // 仪式永远在最上层
    root = $('div', 'xx-ritual');
    root.innerHTML = `
      <div class="rt-sky"></div>
      <div class="rt-body">
        <div class="rt-char" id="rt-char">
          <div class="rt-hair"></div>
          <div class="rt-head">
            <div class="rt-ear l"></div><div class="rt-ear r"></div>
            <div class="rt-eye l"><i></i></div>
            <div class="rt-eye r"><i></i></div>
            <div class="rt-blush l"></div><div class="rt-blush r"></div>
            <div class="rt-mouth"></div>
          </div>
          <div class="rt-body-c"></div>
          <div class="rt-arm l"></div><div class="rt-arm r"></div>
        </div>
        <div class="rt-box">
          <div class="rt-who" id="rt-who"></div>
          <div class="rt-ask" id="rt-ask"></div>
          <div class="rt-input" id="rt-input">
            <input id="rt-name" maxlength="6" placeholder="输入名字" autocomplete="off">
          </div>
          <div class="rt-opts" id="rt-opts"></div>
          <div class="rt-foot" id="rt-foot"></div>
        </div>
      </div>`;
    document.getElementById('app').appendChild(root);

    root.querySelector('#rt-input').addEventListener('click', e => e.stopPropagation());
    root.querySelector('#rt-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.confirmName();
    });
  },

  render() {
    const q = id => root.querySelector('#' + id);
    q('rt-who').textContent = '宝宝';
    q('rt-ask').textContent = '「你醒啦。」\n你想叫我什么名字呀?';
    q('rt-input').style.display = '';
    q('rt-opts').innerHTML = '';
    q('rt-foot').innerHTML = `<button class="rt-go" id="rt-go">就 这 样 吧</button>
         <div class="rt-hint">留空的话……我就还是叫「宝宝」哦。</div>`;
    const go = q('rt-go');
    if (go) go.onclick = () => this.confirmName();
    setTimeout(()=>q('rt-name').focus(), 240);
  },

  /** 只有命名一步:确认即入局,没有任何选择项 */
  confirmName() {
    const v = (root.querySelector('#rt-name').value || '').trim();
    tmpName = v;
    COMPANION.init(tmpName);
    root.querySelector('#rt-who').textContent = COMPANION.s.name;
    root.querySelector('#rt-ask').textContent = '「……嗯。」';
    root.querySelector('#rt-input').style.display = 'none';
    root.querySelector('#rt-foot').innerHTML = `<button class="rt-go" id="rt-ok">好</button>`;
    const ok = root.querySelector('#rt-ok');
    if (ok) ok.onclick = () => this.close();
    // 点空白处也能关(仪式不困住玩家)
    root.onclick = e => {
      if (e.target === root || e.target.classList.contains('rt-body') ||
          e.target.classList.contains('rt-sky')) this.close();
    };
  },
};