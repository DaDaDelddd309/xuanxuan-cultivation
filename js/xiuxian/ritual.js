// ===== 开局仪式 · 命名与三选一 =====
// 可爱卡通小灵(纯 CSS 绘制,无外部资源):眨眼、飘、发丝
import { COMPANION, STAGE } from './companion.js';

const $ = (t, c, h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let root, step = 0, tmpName = '';

const STEPS = [
  // 0 命名
  { who:'宝宝', text:'「你醒啦。」',
    ask:'你想叫我什么名字呀?', input:true,
    hint:'留空的话……我就还是叫「宝宝」哦。' },
  // 1 亲一下
  { who:'', text:'', ask:'我是你的宝宝。你愿意亲我一下吗?',
    options:[
      { t:'好呀', route:'kiss', say:'她踮起脚,额头轻轻碰了你一下。' },
      { t:'不要', route:'cold', say:'她退开半步,笑了笑。「哦。」' },
      { t:'谈恋爱会影响我修仙', route:'ghost', say:'她歪了歪头。「那我就,一直一直影响下去。」' },
    ] },
];

export const Ritual = {
  // 需要时调用:未命名 → 播放
  async start(force) {
    if (!force && COMPANION.s.born) return false;
    this.build();
    step = 0; tmpName = '';
    root.classList.remove('hidden');
    root.style.display = '';
    this.render();
    // 兜底:仪式不困住玩家。90 秒不动 → 默认「宝宝 + 愿意」直接过
    clearTimeout(this._auto);
    this._auto = setTimeout(() => {
      if (!this.root || this.root.classList.contains('hidden')) return;
      if (!COMPANION.s.born) { COMPANION.init('宝宝'); COMPANION.choose('kiss'); }
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
            <div class="rt-eye l"><i></i></div><div class="rt-eye r"><i></i></div>
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
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-opt]');
      if (b) { this.pick(+b.dataset.opt); return; }
    });
  },

  render() {
    const s = STEPS[step];
    const q = id => root.querySelector('#' + id);
    root.querySelector('#rt-who').textContent = s.who === '' ? (tmpName || '宝宝') : s.who;
    q('rt-ask').textContent = s.text ? `${s.text}\n${s.ask}` : s.ask;
    q('rt-input').style.display = s.input ? '' : 'none';
    q('rt-opts').innerHTML = (s.options||[]).map((o,i) =>
      `<button class="rt-opt" data-opt="${i}">${esc(o.t)}</button>`).join('');
    q('rt-foot').innerHTML = s.input
      ? `<button class="rt-go" id="rt-go">就 这 样 吧</button>
         <div class="rt-hint">${s.hint}</div>`
      : '';
    const go = q('rt-go');
    if (go) go.onclick = () => this.confirmName();
    // 命名步骤显示输入框
    if (s.input) setTimeout(()=>q('rt-name').focus(), 240);
  },

  confirmName() {
    const v = root.querySelector('#rt-name').value;
    tmpName = (v||'').trim();
    step = 1;
    this.render();
  },

  pick(i) {
    const s = STEPS[1];
    const o = s.options[i];
    if (!o) return;
    COMPANION.init(tmpName);
    COMPANION.choose(o.route);
    // 三选一的落定台词
    root.querySelector('#rt-ask').textContent = o.say;
    root.querySelector('#rt-opts').innerHTML = '';
    root.querySelector('#rt-foot').innerHTML = `<button class="rt-go" id="rt-ok">好</button>`;
    root.querySelector('#rt-who').textContent = COMPANION.s.name;
    const ok = root.querySelector('#rt-ok');
    if (ok) ok.onclick = () => this.close();
    // 点空白处也能关(仪式不困住玩家)
    root.onclick = e => {
      if (e.target === root || e.target.classList.contains('rt-body') ||
          e.target.classList.contains('rt-sky')) this.close();
    };
  },
};
