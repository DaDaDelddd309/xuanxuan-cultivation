// ===== 开局仪式 · 只做一件事:取名字(V0.98)=====
// 可爱卡通小灵(纯 CSS 绘制,无外部资源):眨眼、飘、发丝
//
// V0.98 改动(工单 XX-COMP-005):
//   旧版第 2 步是「你愿意亲我一下吗?」三选一 —— 路线 kiss/cold/ghost。
//   但 owner 的判断是对的:「每次都是几选一,这叫随机?这叫有感情的?」
//   选项只改数值、不改行为,是点击农场,不是选择。
//   所以整段删掉:开局只问名字,直接进游戏。
//   三条路线随之消失(灵伴三形也不再存在)。
//
// ── V0.99q 改动(XX-RITUAL-001):补「导演」 ──────────────────
//   症状:玩家反馈「立绘没喜欢的欲望,文字生硬且不灵动,特效没有,
//         莫名其妙、很突兀、很迷茫」。
//
//   实测根因(**不是美术问题,是没人给动画排戏**):
//     · CSS 里 rtBlink / rtFloat / rtArm 三个动画都写好了 ——
//       但整个 ritual.js **只有 1 个 setTimeout(聚焦输入框)**,
//       没有任何代码决定「什么时候眨眼、什么时候说话」。
//     · `.rt-char.blink` 这个类**全仓从未被 JS 加过** —— 眨眼动画是死代码。
//     · `.rt-box` / `.rt-ask` 零动画、零 transition —— 文字硬邦邦出现。
//     · 弹窗直接 `classList.remove('hidden')` —— 无淡入、无位移,所以「突兀」。
//
//   所以缺的不是「动作指导」也不是「编剧」,是**导演**:
//     素材齐全,但没人喊「第一场,Action」。
//
//   本次只做**调度**,不碰美术、不改文案、不改任何玩法:
//     ① 眨眼:随机 2.4~5.5s 一次,偶尔连眨两下(活物感的关键)
//     ② 入场:面板淡入上浮 + 立绘弹入(消除「突兀」)
//     ③ 文字:逐行淡入(消除「生硬」)
//     ④ 说话:开口时口型微张(给对白配上动作)
//     ⑤ 视线:等玩家聚焦输入框时,眼睛跟着看向输入框
//   —— 五件事,零新增依赖,零玩法改动。
import { COMPANION } from './companion.js';

const $ = (t, c, h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };

let root, tmpName = '';
let blinkTimer = null;      // 眨眼循环
let talkTimer = null;       // 口型循环

export const Ritual = {
  // 需要时调用:未命名 → 播放
  async start(force) {
    if (!force && COMPANION.born()) return false;
    this.build();
    tmpName = '';
    root.classList.remove('hidden');
    root.style.display = '';
    this.render();
    this.direct();                      // 开机:入场 + 眨眼 + 口型
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
    clearTimeout(blinkTimer);
    clearTimeout(talkTimer);
    if (!root) return;
    root.classList.add('hidden');
    root.style.display = 'none';
  },

  // ═══════ 导演:调度动画(XX-RITUAL-001)═══════════════
  /** 开机:立绘弹入 + 开始眨眼/口型循环 */
  direct() {
    const q = id => root.querySelector('#' + id);
    // 入场 —— 消除「硬邦邦出现」
    requestAnimationFrame(() => root.classList.add('rt-in'));
    // 文字逐行淡入 —— 消除「生硬」
    const lines = ['rt-who', 'rt-ask'];
    lines.forEach((id, i) => {
      const el = q(id);
      if (el) { el.classList.add('rt-line'); el.style.animationDelay = (0.18 + i * 0.22) + 's'; }
    });
    this.blinkLoop();
    this.talkLoop();
  },

  /** 眨眼循环:随机 2.4~5.5s,四成概率连眨两下 */
  blinkLoop() {
    clearTimeout(blinkTimer);
    const char = root.querySelector('#rt-char');
    if (!char) return;
    const wait = 2400 + Math.random() * 3100;
    blinkTimer = setTimeout(() => {
      char.classList.add('blink');
      setTimeout(() => char.classList.remove('blink'), 360);
      // 连眨两下 = 「活物感」的关键细节
      if (Math.random() < 0.4) {
        setTimeout(() => {
          char.classList.add('blink');
          setTimeout(() => char.classList.remove('blink'), 360);
        }, 620);
      }
      this.blinkLoop();
    }, wait);
  },

  /** 口型微张:对白期间嘴有动作,不是一条死线 */
  talkLoop() {
    clearTimeout(talkTimer);
    const mouth = root.querySelector('.rt-mouth');
    if (!mouth) return;
    talkTimer = setTimeout(() => {
      mouth.classList.add('talk');
      setTimeout(() => mouth.classList.remove('talk'), 620 + Math.random() * 500);
      this.talkLoop();
    }, 1800 + Math.random() * 2600);
  },

  /** 视线跟随:玩家点输入框时,眼睛看向那边 */
  lookAt(on) {
    const char = root.querySelector('#rt-char');
    if (char) char.classList.toggle('rt-look', !!on);
  },

  /** 说一句话:先动嘴,再出字 */
  say(el, text) {
    const mouth = root.querySelector('.rt-mouth');
    if (mouth) {
      mouth.classList.add('talk');
      setTimeout(() => mouth.classList.remove('talk'), Math.min(1500, 260 + text.length * 95));
    }
    el.textContent = text;
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
    const inp = root.querySelector('#rt-name');
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.confirmName();
    });
    // 视线跟随:聚焦时看向输入框
    inp.addEventListener('focus', () => this.lookAt(true));
    inp.addEventListener('blur', () => this.lookAt(false));
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
    this.lookAt(false);
    // 确认瞬间:开心反应(轻轻一跳)+ 先动嘴再出字
    const char = root.querySelector('#rt-char');
    if (char) {
      char.classList.add('rt-happy');
      setTimeout(() => char.classList.remove('rt-happy'), 900);
    }
    this.say(root.querySelector('#rt-who'), COMPANION.s.name);
    this.say(root.querySelector('#rt-ask'), '「……嗯。」');
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