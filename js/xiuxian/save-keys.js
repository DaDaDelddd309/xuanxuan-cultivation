// ===== 存档键集中注册表(XX-AUDIT-006 批 1)=====
//
// 技术债 P1-1:存档键散在 21~22 个文件里,改一个键名要翻遍全仓库,
// 漏改一处就是「玩家进度静默丢失」。本文件把键名收到一处。
//
// 【为什么不直接把 localStorage 调用全搬进本文件】
//   那需要改动 22 个模块的读写路径,属批 3/批 4 的事(见 TICKETS)。
//   本批只做**收口**:每个模块从 SAVE_KEYS 取键名,不再各自硬编码字符串。
//   行为零变化 —— 键名字符串完全一致,老存档照常读得出。
//
// 【为什么键名里的版本后缀不动】
//   v077/v080/v087/v099 混杂是历史事实,每个后缀对应一次结构变更。
//   改名 = 旧档读不出 = 玩家进度归零。收敛键名要走「读旧写新」的双写迁移,
//   那是独立的工单,不在本批范围。
//
// 用法:
//   import { SAVE_KEYS } from './save-keys.js';
//   localStorage.setItem(SAVE_KEYS.quest, ...)
const SAVE_KEYS = {
  // —— 修仙主线 ——
  cultivation: 'xx_cultivation_v077',   // xiuxian/index.js
  nemesis:    'xx_nemesis_v077',        // xiuxian/relations.js
  titles:     'xx_titles_v077',         // xiuxian/relations.js
  bag:        'xx_bag_v080',            // 由 Profile 统一档托管,见下方说明
  // —— 时间与生态 ——
  clock:      'xx_clock_v099',          // xiuxian/clock.js
  day:        'xx_day_v080',            // 由 Profile 统一档托管
  camp:       'xx_camp_v080',           // 由 Profile 统一档托管
  // —— 角色与养成 ——
  companion:  'xx_companion_v081',
  family:     'xx_family_v081',
  mount:      'xx_mount_v091',
  chronicle:  'xx_chronicle_v081',
  build:      'xx_build_v083',
  craft:      'xx_craft_v099',
  artstar:    'xx_artstar_v099',
  // —— 玩法系统 ——
  quest:      'xx_quest_v087',
  story:      'xx_story_v086',
  tomb:       'xx_tomb_v089',
  spine:      'xx_spine_v099',
  codex:      'xx_codex_v099',
  // —— 经济与社交 ——
  market:     'xx_market_v099',
  merch:      'xx_merch_v080',
  tavern:     'xx_tavern_v099',
  // —— 统一档与设置 ——
  profile:    'xx_profile_v081',        // profile.js:真正的存档主体
  seed:       'xx_seed_v081',           // profile.js:PRNG 种子
  base:       'pxs_save',               // core/save.js:设置/金币/角色
};

// 【bag / day / camp 为什么不在这里被各模块直接读】
//   这三个键原本由 camp.js / clock.js 自己读,但 V0.9x 之后
//   数据主体已收进 Profile 统一档(xx_profile_v081),
//   老键只在 Profile.migrate() 里被一次性读取用于迁移。
//   保留在表里是因为 migrate() 仍要用它们读旧档。
//   ⚠️ 见 TICKETS XX-AUDIT-006 批 2:Profile.flush() 里对
//      LEGACY.base('pxs_save') 的往返写是死数据(读进来从不消费),
//      且会覆盖 core/save.js 的活跃存档,批 2 处理。

export { SAVE_KEYS };
export default SAVE_KEYS;