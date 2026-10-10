// 装备整链测试 —— 工单 XX-EQUIP-005
// 运行: node tests/gear-chain-regression.mjs
//
// 背景:到本工单之前,装备系统是**完整但闭合**的 ——
//   数据层有 gear.js、存档有 gear 字段、战斗已接(XX-EQUIP-004),
//   但**玩家没有任何途径拿到第一件装备,也没有任何界面能穿它**。
//   `grep GEAR js/` 除 gear.js 自身与一条死导入外,零命中。
//   这与 `_sFeedable` / `gearBonus` 是同一族病:东西齐了,链是断的。
//
// 本工单断言的是**整条链**,不是各接口存在:
//   结案 → 掉落进背包 → 穿戴(单槽互斥)→ 局内生效
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

// ---- 环境 shim ----
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.document = { addEventListener(){}, removeEventListener(){},
  createElement: () => ({ style:{}, classList:{add(){},remove(){}}, appendChild(){}, remove(){} }),
  body:{appendChild(){}}, getElementById:()=>null };
globalThis.window = {};

const { Save } = await import('../js/core/save.js');
const { GEAR, GEAR_IDS, gearFromSource, loadoutBonus, emptyLoadout } = await import('../js/game/gear.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d='') => { if (c) pass++; else { fail++; failed.push(n + (d?' :: '+d:'')); console.log(`  ❌ ${n} ${d}`); } };

// ————— 0. 前提:新档必须全空(送了新手装备,整条链就变成装饰) —————
{
  Save.reset();
  ok('新档没有任何装备', (Save.data.gearOwned||[]).length === 0);
  ok('新档四个槽全空', ['head','body','hand','foot'].every(s => Save.data.gear[s] === null));
  ok('新档不穿戴', Object.values(Save.data.gear).every(v => v === null));
}

// ————— 1. 反查:结案对象 → 装备 —————
{
  const byQuest = GEAR_IDS.map(id => GEAR[id].from);
  ok('每件装备都有 from', byQuest.every(Boolean));
  ok('from 互不重复(一件装备只对应一个结案对象)', new Set(byQuest).size === byQuest.length,
     JSON.stringify(byQuest));
  for (const id of GEAR_IDS) {
    const found = gearFromSource(GEAR[id].from);
    ok(`反查 ${GEAR[id].from} → ${GEAR[id].name}`, found === id, `得到 ${found}`);
  }
  ok('不存在的来源返回 null', gearFromSource('__nope__') === null);
  ok('空来源返回 null', gearFromSource('') === null && gearFromSource(null) === null);
}

// ————— 2. 掉落:只拿一次,重复结案不产第二件 —————
{
  Save.reset();
  const gid = gearFromSource('hongyi');
  ok('第一次拿到', Save.ownGear(gid) === true);
  ok('已进背包', Save.ownsGear(gid));
  ok('重复拿到返回 false', Save.ownGear(gid) === false);
  ok('背包里仍只有一件', Save.data.gearOwned.filter(x => x === gid).length === 1);
  ok('不认识的 id 拿不到', Save.ownGear('__nope__') === false);
  ok('非字符串拿不到', Save.ownGear(null) === false && Save.ownGear(123) === false);
}

// ————— 3. 穿戴:必须先拥有 —————
{
  Save.reset();
  const gid = gearFromSource('hongyi');
  ok('没拿到就穿不上', Save.equip(gid).ok === false);
  Save.ownGear(gid);
  ok('拿到就能穿', Save.equip(gid).ok === true);
  ok('已穿上', Save.data.gear[GEAR[gid].slot] === gid);
  ok('loadout 只含穿着的', Object.keys(Save.loadout()).length === 1);
}

// ————— 4. 单槽互斥:换装不丢东西 —————
{
  Save.reset();
  const a = gearFromSource('hongyi');   // body
  const b = gearFromSource('jiangu');   // hand
  ok('两件不同槽', GEAR[a].slot !== GEAR[b].slot, `${GEAR[a].slot} vs ${GEAR[b].slot}`);
  Save.ownGear(a); Save.ownGear(b);
  Save.equip(a); Save.equip(b);
  ok('两件同时穿着', Save.data.gear[GEAR[a].slot] === a && Save.data.gear[GEAR[b].slot] === b);
  ok('背包仍两件', Save.data.gearOwned.length === 2);

  // 找一件同槽的第二件,验互斥。
  // ⚠️ 必须挑一个**至少两件**的槽位:body 槽只有红嫁衣一件,
  // 拿它验互斥必然失败 —— 那是夹具选错,不是产品问题。
  const slotCount = {};
  for (const id of GEAR_IDS) slotCount[GEAR[id].slot] = (slotCount[GEAR[id].slot]||0)+1;
  const richSlot = Object.keys(slotCount).find(s => slotCount[s] >= 2);
  ok('存在至少两件的槽位(供验互斥)', !!richSlot, JSON.stringify(slotCount));
  const sameSlot = GEAR_IDS.find(id => GEAR[id].slot === richSlot);
  if (sameSlot) {
    // 先穿上 richSlot 里的另一件,再拿 sameSlot 去顶它。
    // ⚠️ 换上去的那件**必须先 own** —— equip() 会拒绝没拥有的,
    //    这正是「没拿到就穿不上」那条规则,不是夹具的错。
    const first = GEAR_IDS.find(id => GEAR[id].slot === richSlot && id !== sameSlot);
    Save.ownGear(first); Save.equip(first);
    const prev = Save.data.gear[richSlot];
    ok('richSlot 已穿着第一件', prev === first, `prev=${prev}`);
    Save.ownGear(sameSlot);
    ok('两件都在背包里', Save.ownsGear(first) && Save.ownsGear(sameSlot));
    const r = Save.equip(sameSlot);
    ok('同槽换装成功', r.ok === true);
    ok('同槽换装:旧的那件被顶下来', r.replaced === prev, `replaced=${r.replaced}`);
    ok('旧件仍在背包(不会凭空消失)', Save.ownsGear(prev));
    ok('新件占据该槽', Save.data.gear[richSlot] === sameSlot);
    ok('该槽只有一件', Object.values(Save.data.gear).filter(x => x === sameSlot).length === 1);
    ok('别的槽不受影响', Save.data.gear[GEAR[a].slot] === a && Save.data.gear[GEAR[b].slot] === b);
  } else ok('找到同槽第二件用于验互斥', false);
}

// ————— 5. 脱下 —————
{
  Save.reset();
  const gid = gearFromSource('hongyi');
  Save.ownGear(gid); Save.equip(gid);
  const slot = GEAR[gid].slot;
  ok('脱下成功', Save.unequip(slot).ok === true);
  ok('槽位空了', Save.data.gear[slot] === null);
  ok('东西还在背包', Save.ownsGear(gid));
  ok('空槽位不能脱', Save.unequip(slot).ok === false);
  ok('不存在的槽位不能脱', Save.unequip('nose').ok === false);
}

// ————— 6. 局内生效:穿上后 loadoutBonus 才有值 —————
{
  Save.reset();
  const gid = gearFromSource('hongyi');
  ok('没穿时无加成', Object.keys(loadoutBonus(Save.loadout())).length === 0);
  Save.ownGear(gid); Save.equip(gid);
  const b = loadoutBonus(Save.loadout());
  ok('穿上后有加成', Object.keys(b).length > 0, JSON.stringify(b));
  ok('红嫁衣给吸血', (b.lifestealPct || 0) > 0, 'lifestealPct=' + b.lifestealPct);
  Save.unequip(GEAR[gid].slot);
  ok('脱下后加成消失', Object.keys(loadoutBonus(Save.loadout())).length === 0);
}

// ————— 7. 存档往返 + 脏档清洗 —————
{
  Save.reset();
  const a = gearFromSource('hongyi'), b = gearFromSource('jiangu');
  Save.ownGear(a); Save.ownGear(b); Save.equip(a);
  const before = JSON.stringify(Save.data.gear);
  Save.commit(); Save.load();
  ok('往返后仍穿着', JSON.stringify(Save.data.gear) === before);
  ok('往返后背包不变', Save.data.gearOwned.length === 2);

  // 脏档:不存在的 id / 重复 / 没拿到就穿着
  localStorage.setItem('pxs_save', JSON.stringify({
    v:1, gear:{ head:'__nope__', body:a, hand:null, foot:null },
    gearOwned: [a, a, '__nope__', 123, b],
  }));
  Save.load();
  ok('不存在的装备 id 被清掉', Save.data.gear.head === null);
  ok('背包里的重复项被去重', Save.data.gearOwned.filter(x => x === a).length === 1);
  ok('非字符串/非法 id 被丢掉', !Save.data.gearOwned.includes('__nope__') && !Save.data.gearOwned.includes(123));
  ok('合法件保留', Save.ownsGear(a) && Save.ownsGear(b));
  ok('「没拿到就穿着」被否掉 —— body 的 a 确实在背包里,保留',
     Save.data.gear.body === a);

  // 穿着一件不在背包里的
  localStorage.setItem('pxs_save', JSON.stringify({
    v:1, gear:{ head:'hongyi_garment', body:null, hand:null, foot:null },
    gearOwned: [],
  }));
  Save.load();
  ok('白嫖(未拥有却穿着)被否掉', Save.data.gear.head === null);
}

// ————— 8. 接线契约:四段都要在 —————
{
  const q = readFileSync(ROOT + '/js/xiuxian/quest.js', 'utf8');
  ok('quest.finish 把 key 传给 grant', /grant\(l\.quest\.reward,\s*path,\s*key\)/.test(q));
  ok('quest.grant 用 gearFromSource 反查', /gearFromSource\(questKey\)/.test(q));
  ok('quest.grant 调 Save.ownGear', /Save\.ownGear\(gid\)/.test(q));
  ok('重复获得会给玩家提示', /已有/.test(q));

  const ui = readFileSync(ROOT + '/js/xiuxian/ui.js', 'utf8');
  ok('修仙阁有「装备」页签', /\['gear','装备'\]/.test(ui));
  ok('装备页有渲染分派', /tab === 'gear'\s*\?\s*this\.vGear\(\)/.test(ui));
  ok('有穿戴 / 脱下两个 act 分支', /case 'gear-on'/.test(ui) && /case 'gear-off'/.test(ui));
  ok('ui.js import 了 ui/gear.js', /from '\.\/ui\/gear\.js'/.test(ui));

  const m = readFileSync(ROOT + '/js/main.js', 'utf8');
  ok('局内 loadout 走 Save.loadout()', /loadoutBonus\(Save\.loadout\(\)\)/.test(m));
  ok('main.js 不再死导入 GEAR', !/import\s*\{[^}]*\bGEAR\b[^}]*\}\s*from/.test(m));
}

console.log(`\n装备整链: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项:\n  - ' + failed.join('\n  - ')); process.exit(1); }