// 修仙阁 · title页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vTitle() { return vTitleImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { TITLES } from '../lore.js';
import { Cult } from '../index.js';
import { esc } from './dom.js';

// ---------- 称号 ----------
export function vTitle(hall) {
    const got = Cult.titles.list();
    return TITLES.map(t => {
      const on = got.includes(t.id);
      return `<div class="xx-title-i ${on ? 'on' : 'off'}">
        <div class="xx-seal">${on ? '印' : '？'}</div>
        <div style="flex:1">
          <div style="color:${on ? 'var(--xx-gold)' : 'var(--xx-paper)'};letter-spacing:2px">${esc(t.name)}</div>
          <div class="xx-dim">${on ? esc(t.desc) : esc(t.cond)}</div>
        </div>
      </div>`;
    }).join('');
}