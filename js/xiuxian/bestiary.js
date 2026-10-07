// ===== 怪物图谱 + 固定 NPC 图鉴 =====
// 立绘来源:assets/mob/*.jpg、assets/portrait/*.jpg(AI 生成,水墨风)

// ————— 怪物图谱 —————
// realm: 建议出现的境界阶段(玩家境界越高刷到的越强)
export const BESTIARY = {
  wanderer: {
    name:'游荡散修', realm:'炼气', img:'assets/mob/ghostfire.jpg',
    hp:60, dmg:9, xp:3, weight:34,
    desc:'无门无派,只为活着。见人就抢,见宝就夺。',
    lore:'他们本来也是散修,直到饿到开始抢别人。',
    drops:[{ id:'stone_1', p:0.10 }, { id:'scroll_1', p:0.03 }],
  },
  guard: {
    name:'山门执事', realm:'炼气', img:'assets/mob/golem.jpg',
    hp:110, dmg:13, xp:5, weight:26,
    desc:'大宗门的看门人。规矩在他眼里比命重。',
    lore:'他守了三十年山门,没见过一个走出去的。',
    drops:[{ id:'stone_1', p:0.14 }, { id:'scroll_1', p:0.05 }, { id:'bld_well', p:0.012 }],
  },
  yao: {
    name:'青岚妖王', realm:'筑基', img:'assets/mob/ninehead.jpg',
    hp:340, dmg:24, xp:14, weight:16,
    desc:'盘踞秘境千年的九头妖。斩一头,它还有八头。',
    lore:'据说它曾是某位大能的坐骑,后来自己吞了主人。',
    drops:[{ id:'stone_2', p:0.22 }, { id:'scroll_2', p:0.07 },
           { id:'bld_furnace', p:0.03 }, { id:'bld_field', p:0.035 }],
  },
  elder: {
    name:'青云长老', realm:'筑基', img:'assets/mob/revenant.jpg',
    hp:420, dmg:28, xp:18, weight:14,
    desc:'灭门宗派的最后一人。他已经不是人了。',
    lore:'他把弟子的名字刻满了后山。每一块碑。',
    drops:[{ id:'stone_2', p:0.24 }, { id:'scroll_2', p:0.09 },
           { id:'bld_tower', p:0.022 }, { id:'bld_hall', p:0.015 }],
  },
  devil: {
    name:'黑风魔修', realm:'金丹', img:'assets/mob/bloodriver.jpg',
    hp:1100, dmg:46, xp:42, weight:9,
    desc:'魔道巨擘。他杀人不是为了修炼,是为了记住。',
    lore:'他记得每一个被他杀过的人的名字。这是他的罪,也是他的执。',
    drops:[{ id:'stone_3', p:0.34 }, { id:'scroll_3', p:0.12 },
           { id:'bld_tower', p:0.04 }, { id:'bld_barracks', p:0.035 }],
  },
  golem: {
    name:'炼骨傀', realm:'金丹', img:'assets/mob/golem.jpg',
    hp:1800, dmg:52, xp:55, weight:6,
    desc:'某位大能的守陵傀儡。不知疲倦,不知疼痛。',
    lore:'它守着一座空坟,已经守了一千二百年。',
    drops:[{ id:'stone_3', p:0.38 }, { id:'stone_4', p:0.06 },
           { id:'bld_barracks', p:0.05 }, { id:'bld_hall', p:0.03 }],
  },
  revenant: {
    name:'血河老祖', realm:'元婴', img:'assets/mob/revenant.jpg',
    hp:3600, dmg:78, xp:110, weight:3,
    desc:'以血养道的活尸。他不杀第二个同名的人——他怕想起来。',
    lore:'他每天都要杀一个和自己同名的人,好让自己忘记。',
    drops:[{ id:'stone_4', p:0.46 }, { id:'scroll_4', p:0.16 },
           { id:'bld_hall', p:0.06 }, { id:'bld_market', p:0.028 }],
  },
  ninehead: {
    name:'九幽妖尊', realm:'化神', img:'assets/mob/ninehead.jpg',
    hp:9000, dmg:130, xp:320, weight:1.2,
    desc:'九头同体,一怒则山崩。它记得每一世杀过的人。',
    lore:'传说斩它要同时斩九头。顺序错了,它会重生。',
    drops:[{ id:'stone_5', p:0.55 }, { id:'scroll_5', p:0.24 },
           { id:'bld_market', p:0.07 }, { id:'bld_tower', p:0.06 }],
  },
};
export const BOSS_KEYS = ['devil','revenant','ninehead'];

// ————— 建筑掉落物(怪掉的,拿去营地造)—————
// 灵米:灵田产物,可吃/卖/送人
export const RICE = {
  id:'lingmi', name:'灵 米', col:'#c9d8a0',
  eat: { exp: 220, dao: 60, desc:'生吞一把。抵得两刻苦修。' },
  feed: { exp: 1400, desc:'喂给修士,顶他半日功夫。' },
  price: 45,
  d:'灵田所出。粗粝,但有灵气。',
};

export const BUILDINGS = {
  bld_field:    { name:'灵田', icon:'🌾', cost:0, need:1, col:'#8a9a5a',
    desc:'委任族中农人开垦。约 10 分钟一熟,收灵米。',
    out:'lingmi', min:2, max:5 },
  bld_furnace:  { name:'丹炉', icon:'⚗️', cost:0, need:1, col:'#c86a4a',
    desc:'安置在篝火旁。安排人值守炼丹,人多出丹快。',
    out:'pill', min:1, max:2 },
  bld_tower:    { name:'哨塔', icon:'🗼', col:'#7a8a9a',
    eff:{ ward:+45, warn:true },
    desc:'瞭敌用。护栏 +45,并在围攻前预警(提前告知来犯方向)。' },
  bld_hall:     { name:'议事堂', icon:'🏛', col:'#b072d8',
    eff:{ popCap:+8 },
    desc:'族人议事定策。人口上限 +8。' },
  bld_barracks: { name:'演武场', icon:'⚔️', col:'#b5342a',
    eff:{ atk:+18 },
    desc:'操练族人。全族战力 +18(攻守都涨)。' },
  bld_well:     { name:'灵井', icon:'💧', col:'#4a9de0',
    eff:{ fieldMul:+0.5 },
    desc:'灵水滋养。灵田产量 +50%。' },
  bld_market:   { name:'集市', icon:'🏪', col:'#c9a227',
    eff:{ trade:true, lure:0.06 },
    desc:'贸易之地。每 10 分钟入账道行,且吸引散修投奔。' },
};

// 注册建材到背包系统(避免与 items.js 循环依赖)
import { registerBuildings, registerExtras } from './items.js';
registerBuildings(BUILDINGS);
registerExtras({ [RICE.id]: RICE });

// ————— 领地晋升阶梯 —————
// 参考《明日之后》聚落/《风起之地》营地:靠 建筑数 + 人口 + 篝火数 共同推进
export const TIERS = [
  { lv:1, name:'篝 火', slots:2, need:{ builds:1,  pop:1,  fires:1 },
    desc:'一堆火。风大了就灭,但妖怪不进。', col:'#c96a3c' },
  { lv:2, name:'村 落', slots:3, need:{ builds:2, pop:3,  fires:1 },
    desc:'有了围栏和几间屋。有人愿意留下了。', col:'#a88a5a' },
  { lv:3, name:'集 镇', slots:4, need:{ builds:3, pop:6,  fires:1 },
    desc:'有了议事堂和哨塔。散修开始打听这里。', col:'#8a9a5a' },
  { lv:4, name:'市 集', slots:5, need:{ builds:4, pop:10, fires:2 },
    desc:'有了灵井与集市。商队会绕路来这里。', col:'#6aa8e0' },
  { lv:5, name:'宗 门', slots:6, need:{ builds:5, pop:16, fires:3 },
    desc:'三处篝火连成一线。旗立了,匾挂了。', col:'#b072d8' },
];

// ————— 固定 NPC 图鉴 —————
// 三条灵伴路线对应三种形态,这是给玩家看的"她到底变成了什么"
export const NPCS = {
  baby: {
    name:'宝宝', form:'灵 伴', img:'assets/portrait/aunt.jpg', route:'kiss',
    desc:'你叫她宝宝,她便真的是你的宝宝了。',
    bio:'最早遇见的一个影子。她没有别的名字,所以你给了她一个。\n' +
        '她会贴着你的边走,会记住你每一句话。境界越高,她靠得越近。',
    ability:'自动拾取掉落物(一次一个,刻意不快) · 贴边时赠你拾取范围与速度',
    threat:'无',
  },
  ghostfire: {
    name:'鬼火', form:'鬼 火', img:'assets/mob/ghostfire.jpg', route:'cold',
    desc:'你没有叫她宝宝。她就自己变成了飘着的火。',
    bio:'不说话,不黏人。只在你背后远远跟着,偶尔丢下点东西。\n' +
        '你以为她走了。她只是走到你看不见的地方,继续给你。',
    ability:'定期赠予道行 / 修为 / 源石 · 自说自话,不给选项',
    threat:'低',
  },
  revenant: {
    name:'怨灵', form:'怨 灵', img:'assets/mob/revenant.jpg', route:'ghost',
    desc:'你说了"谈恋爱会影响我修仙"。她就真的开始影响。',
    bio:'从此她不再跟着你。她钻进别的怪物身体里,用它们的手碰你。\n' +
        '你杀不死她。她只会在两分钟后回到下一只怪身上,并且提前告诉你下一个是谁。',
    ability:'定期附身怪物并大幅强化其能力 · 篝火外在召唤强化妖物',
    threat:'高 —— 每 5 次附身触发一次闪屏警告',
  },
  merchant: {
    name:'流浪商人', form:'过 路', img:'assets/portrait/foe.jpg', route:'merchant',
    desc:'他不属于任何地方,所以哪儿都能碰上。',
    bio:'来了就摆货,卖完就走。下次可能是明天,也可能是明年。\n' +
        '他从不骗人,只骗贪心的人——源石在他那儿永远比兑换贵。',
    ability:'侧边闪卡交易 · 24 秒自动离开 · 不打断、不卡怪 · 可无视',
    threat:'无',
  },
  momocha: {
    name:'么么茶', form:'茶 摊', img:'assets/portrait/momocha.jpg', route:'fixed',
    passive:'被动:全局挂机收益 +25% · 可委灵田(产量 ×1.8)',
    recruit:'开服即在队,无需招募',
    desc:'落云镇那个茶摊的少年。三文钱一碗,粗茶。',
    bio:'你第一次喝到他家的茶,是在逃亡的路上。他没问你从哪来,只问你喝不喝。\n' +
        '后来他跟来了。他说:"跟着你,生意会更好。"',
    ability:'前期必然遭遇 · 可委任种植灵田(产量可观) · 可派去打听消息',
    threat:'无',
  },
  moying: {
    name:'墨影', form:'宿 敌', img:'assets/portrait/foe.jpg', route:'fixed',
    desc:'断剑冢主。古战场上那三百柄剑都是他的。',
    bio:'他没有输过,所以他不知道自己想要什么。\n' +
        '每一个被他杀掉的名字,他都刻在碑上。他记得住,因为他不敢忘。',
    ability:'仇怨越高越强 · 专属 BGM · 击败可入「赤水真人」称号',
    threat:'极高',
  },
};