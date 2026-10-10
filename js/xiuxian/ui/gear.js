// ===== 修仙阁 · 装备页(XX-EQUIP-005)=====
//
// 契约:纯渲染 + 事件绑定,**不改状态结构**。所有写入走 core/save.js 的
//       Save.equip / unequip —— 规则(单槽互斥、必须先拥有)只在那儿定一次。
//
// 为什么装备页要单独一页而不是塞进行囊:
//   行囊是「消耗品」语义(源石、传承书,用掉就没了),装备是「持有物」语义
//   (拿到就是拿到了,能换能脱)。两者的操作模型不同,混在一起会让
//   「使 用」和「穿 戴」两个按钮的差别变得含糊。
//
// ⚠️ 本文件被 ui.js import,故**不能反向 import Hall** —— ui.js import 本文件,
//    本文件再 import ui.js 就成环。
// ⚠️ 每个 export function 必须在 Hall 上有**同名转发壳**(test-ui-split 强制),
//    所以下面叫 doGearOn/doGearOff 就得壳也叫这两个,不能一个叫 doEquip 一个叫 On。
import { Save } from '../../core/save.js';
import { GEAR, GEAR_IDS, gearBonus, AFFIXES } from '../../game/gear.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

const SLOT_NAME = { head:'首', body:'衣', hand:'手', foot:'履' };
const RARITY_NAME = ['', '常', '良', '珍', '绝'];
const RARITY_COL  = ['', '#8a8a7a', '#6f8f6a', '#4a90c2', '#c86a4a'];

/** 一件装备的词条明细,写成人话 */
function affixText(id) {
  const g = GEAR[id];
  if (!g) return '';
  const b = gearBonus(id);
  return Object.entries(g.affixes || {}).map(([k, lv]) => {
    const a = AFFIXES[k];
    if (!a) return '';
    return `${a.name} ${lv}`;
  }).filter(Boolean).join(' · ');
}

export function vGear(hall) {
  void hall;
  const owned = Save.data.gearOwned || [];
  const worn = Save.data.gear || {};

  let h = `<div class="xx-card">
    <div class="xx-label">装 备</div>
    <div class="xx-dim" style="margin-top:5px">
      装备只从<b>支线结案</b>掉落,不会在砍杀局里刷出来 —— 拿到就是拿到了。
      ${owned.length ? `已得 <b style="color:var(--xx-gold)">${owned.length}/${GEAR_IDS.length}</b> 件。` : ''}
    </div>
  </div>`;

  if (!owned.length) {
    return h + `<div class="xx-card">
      <div class="xx-dim">背包里还没有任何装备。</div>
      <div class="xx-dim" style="margin-top:6px;font-size:11px">
        去「修仙阁 → 支线」把一条支线了结。红嫁衣、姥姥的簪、白泽之爪……都在那儿等你。
      </div>
    </div>`;
  }

  // —— 已穿戴的四个槽 ——
  h += `<div class="xx-label" style="margin:14px 0 6px">已 穿 戴</div>`;
  for (const slot of ['head','body','hand','foot']) {
    const id = worn[slot];
    const g = id ? GEAR[id] : null;
    h += `<div class="xx-card" style="padding:10px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1">
          <div class="xx-label" style="color:${g ? RARITY_COL[g.rarity] : 'var(--xx-paper-dim)'}">
            ${SLOT_NAME[slot]} · ${g ? esc(g.name) : '空'}
          </div>
          ${g ? `<div class="xx-dim" style="margin-top:4px;font-size:11px">${esc(affixText(id))}</div>` : ''}
        </div>
        ${g ? `<button class="xx-btn" style="width:auto;margin:0;padding:7px 13px;font-size:12px"
          data-act="gear-off" data-v="${slot}">脱 下</button>` : ''}
      </div></div>`;
  }

  // —— 背包 ——
  h += `<div class="xx-label" style="margin:14px 0 6px">背 包</div>`;
  for (const id of owned) {
    const g = GEAR[id];
    if (!g) continue;
    const on = worn[g.slot] === id;
    h += `<div class="xx-card" style="padding:10px 12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="flex:1">
          <div class="xx-label" style="color:${RARITY_COL[g.rarity]}">
            ${RARITY_NAME[g.rarity]} · ${esc(g.name)}
          </div>
          <div class="xx-dim" style="margin-top:4px;font-size:11px">${esc(g.desc)}</div>
          <div class="xx-val" style="font-size:12px;margin-top:4px">${esc(affixText(id))}</div>
        </div>
        <button class="xx-btn" style="width:auto;margin:0;padding:7px 13px;font-size:12px;${on ? 'opacity:.5' : ''}"
          data-act="gear-on" data-v="${id}">${on ? '穿 着' : '穿 戴'}</button>
      </div></div>`;
  }

  return h;
}

export function doGearOn(hall, id) {
  const r = Save.equip(id);
  if (!r.ok) return r;
  hall._gearMsg = r.replaced
    ? `换上了。${GEAR[id].name} 替下了 ${GEAR[r.replaced] ? GEAR[r.replaced].name : r.replaced}`
    : `穿上了 ${GEAR[id].name}`;
  return { ok:true, msg:hall._gearMsg };
}

export function doGearOff(hall, slot) {
  const r = Save.unequip(slot);
  if (r.ok) hall._gearMsg = '已脱下';
  return r;
}