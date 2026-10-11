// XX-QA-062 · 打扰预算 · 「必须决策」卡片必须真的插进 DOM
//
// 为什么有这个东西:
//
// tests/t88.py 的「弹出结局选择」和 t89.py 的「弹出补完选项」两条红,
// 根因不是测试写错,是 js/xiuxian/nag.js 里一个从 4ba7e2f(V0.96 一体)就埋着的 bug:
//
//     const lv = levelOf(el);                                  // :188  const
//     if (el.dataset.nag === 'must') lv = NAG.MUST;             // :194  给 const 赋值 → TypeError
//
// 凡是带 data-nag="must" 的卡片,append 到 #app 时包装器当场抛异常,
// **元素永远不会被插入 DOM**,异常一路冒回点击处理器。
// 玩家点「了结」弹不出结局选择、点石将前的「补完」弹不出半句话 —— 两个 P0 决策点卡死。
//
// 为什么单独立一个门禁:nag.js 依赖 document,历史上**没有任何 node 测试导入过它**,
// 所以 lint 全绿、103 个门禁全绿,这两条红一直只出现在浏览器套件里,
// 而且是以「测试失败」的面貌出现 —— 很容易被误判成测试的问题。
//
// 本门禁用最小 DOM shim 跑**真实的 installNagger()**,不 mock 它的逻辑。

let fails = 0;
const ok = (n, c, extra = '') => {
  if (!c) fails++;
  console.log(`  ${c ? '✅' : '❌'} ${n}${extra ? ` — ${extra}` : ''}`);
};

// ——— 最小 DOM shim:只实现 nag.js 真正用到的那几个 API ———
function mkEl(tag = 'div') {
  const el = {
    tagName: tag, className: '', id: '', isConnected: true,
    dataset: {}, children: [], parent: null,
    style: { cssText: '', pointerEvents: '' },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    _l: {},
    appendChild(c) {
      c.parent = this; c.isConnected = this.isConnected !== false;
      this.children.push(c); return c;
    },
    remove() {
      this.isConnected = false;
      if (this.parent) { this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
    },
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    // interactive() 靠 querySelector 判「卡里有没有可点动作」,用 _interactive 控制
    querySelector() { return this._interactive ? { tagName: 'div' } : null; },
    querySelectorAll() { return []; },
  };
  return el;
}

const app = mkEl('div');
app.id = 'app';
globalThis.document = {
  getElementById: id => (id === 'app' ? app : null),
  createElement: t => mkEl(t),
};
globalThis.window = { addEventListener() {} };

const { installNagger, NAGER, NAG } = await import('../js/xiuxian/nag.js');
installNagger();
ok('installNagger 已装上拦截', app.__nagged === true);

// 每次用例前清场:nag 的 _host 是模块级的,全程共用同一个 app,不要重建
function fresh() { NAGER.newRun(); }

console.log('\n【回归本体】data-nag="must" 的卡片必须被插入(不是被 const 赋值异常吃掉)');
{
  fresh();
  const card = mkEl('div');
  card.className = 'xx-storycard legend';
  card.dataset.nag = 'must';
  card._interactive = true;
  let threw = null;
  try { app.appendChild(card); } catch (e) { threw = e; }
  ok('append 不抛 TypeError', threw === null, threw ? `${threw.name}: ${threw.message}` : '');
  ok('卡片真的进了 DOM', card.isConnected === true && card.parent !== null,
     `isConnected=${card.isConnected}, parent=${card.parent ? (card.parent.id || card.parent.className) : null}`);
  ok('卡片落在浮层宿主里(不是裸挂在 #app)', card.parent && card.parent.id === 'xx-nag-host',
     `parent=${card.parent && card.parent.id}`);
}

console.log('\n【同族】ui/tomb.js:100 的 askTombWords 走的是同一条 data-nag="must"');
{
  fresh();
  const card = mkEl('div');
  card.className = 'xx-storycard legend';
  card.dataset.nag = 'must';
  card._interactive = true;
  let threw = null;
  try { app.appendChild(card); } catch (e) { threw = e; }
  ok('补完半句话的卡也能插进去', threw === null && card.isConnected === true);
}

console.log('\n【不变式】MUST 卡必须绕过预算,并且拿回 pointer-events');
{
  fresh();
  NAGER.used = 99; NAGER.budget = 4;                 // 预算早就爆了
  const card = mkEl('div');
  card.className = 'xx-storycard legend';
  card.dataset.nag = 'must';
  card._interactive = true;
  app.appendChild(card);
  ok('预算用完也照样放行「必须决策」的卡', card.isConnected === true);
  ok('有可点动作 → pointerEvents 拿回 auto', card.style.pointerEvents === 'auto',
     `= ${JSON.stringify(card.style.pointerEvents)}`);
}

console.log('\n【不变式】纯信息横幅不该吃点击');
{
  fresh();
  const card = mkEl('div');
  card.className = 'xx-banner';
  card._interactive = false;                        // 横幅里没有可点动作
  app.appendChild(card);
  ok('无动作的横幅保持不吃点击', card.style.pointerEvents !== 'auto',
     `= ${JSON.stringify(card.style.pointerEvents)}`);
  ok('横幅仍然要显示', card.isConnected === true);
}

console.log('\n【不变式】非浮层的普通容器照旧直接 append,不被拦进宿主');
{
  fresh();
  const box = mkEl('div');
  box.className = 'xx-card';                        // 不匹配任何浮层类名
  app.appendChild(box);
  ok('普通容器直挂 #app', box.parent === app, `parent=${box.parent && (box.parent.id || box.parent.className)}`);
}

console.log('\n【不变式】占位浮层被外部摘掉后,下一张卡必须能显示(XX-QA-001(2))');
{
  fresh();
  const first = mkEl('div');
  first.className = 'xx-storycard legend';
  first.dataset.nag = 'must';
  first._interactive = true;
  app.appendChild(first);
  ok('第一张卡占位', NAGER._busy === true && NAGER._el === first);
  first.remove();                                   // 模拟被 setTimeout / 外部清掉
  const second = mkEl('div');
  second.className = 'xx-storycard legend';
  second.dataset.nag = 'must';
  second._interactive = true;
  app.appendChild(second);
  ok('staleBusy 之后第二张卡能顶上来', second.isConnected === true,
     `isConnected=${second.isConnected}, _busy=${NAGER._busy}`);
}

console.log('\n【已知缺陷 XX-QA-063 · 本条锁的是现状,不是「正确行为」】');
// :195 写的是 `this.used >= this.budget`,而包装器里 `this === app`(DOM 元素),
// 没有 used/budget 属性 → `undefined >= undefined` 恒 false →
// 「预算用完 → 静默丢弃」这条守卫**从来没生效过**。
// 旁边 :196 用的是 `NAGER.used++`,证明作者本意就是 NAGER。
//
// ⚠️ 这里刻意**不**直接改:一旦接上,行为就变了(预算爆了之后结局卡会静默不弹),
//   那正是 P0 决策点卡死的另一种形态,而本机跑不了浏览器套件,炸了只能靠 CI 现形。
//   故登记为 XX-QA-063 等 owner 裁定。**修的时候记得把这条断言改成反过来。**
{
  fresh();
  NAGER.used = 99; NAGER.budget = 4;
  const card = mkEl('div');
  card.className = 'xx-storycard legend';           // 非 MUST
  card._interactive = true;
  app.appendChild(card);
  ok('【现状】预算爆了非 MUST 卡照样弹 —— 守卫是死代码,见 XX-QA-063', card.isConnected === true);
}

console.log(`\n失败 ${fails} 项` + (fails ? '' : ' · 全部通过'));
process.exit(fails ? 1 : 0);
