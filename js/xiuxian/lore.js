// ===== 世界观 · 设定数据 =====
// 《轩轩修仙传》背景设定。纯数据,供剧情/奇遇/对话系统引用。

export const WORLD = {
  title: '轩轩修仙传',
  subtitle: '墨海孤舟,一剑问天',
  era: '大衍历 四百二十七年',
  setting: '九幽·苍梧界',
  intro:
    '大衍历四百二十七年,苍梧界灵气渐衰,大宗门、高门、散修三方角力。' +
    '你原是无名散修,一场机缘让你得了残卷,自此踏上修行路。' +
    '这世界不讲道理,只讲生死与机缘。',
  regions: [
    { id:'qingstone', name:'青石村', desc:'凡人聚居之地,唯一不杀人的地方。坊市在这里,消息也在这里。' },
    { id:'heifeng',   name:'黑风岭', desc:'强人出没,散修争夺灵矿,死伤无算的地方。' },
    { id:'qingshan',  name:'青岚秘境', desc:'千年前某位大能的洞府,丹房尚存,常年有散修觊觎。' },
    { id:'guchang',   name:'古战场遗迹', desc:'数百年前仙魔大战之地,断剑如林。传闻埋着一位魔修老祖。' },
    { id:'luoyun',    name:'落云镇', desc:'修士与凡人混居的镇子,消息最快,也是最乱的地方。' },
  ],
  rules: [
    '修士寿元有尽。凡人百年,金丹三百,元婴千载。',
    '境界之上还有境界,但每一步都是拿命换。',
    '资源永远不够,机缘永远在别人手里。',
    '弱者没有道理可讲,强者不需要道理。',
  ],
};

// ---- 人物故事(非打断式,解锁时在洞府/日志里读到)----
export const CHARACTERS = {
  xuanxuan: {
    name:'轩轩', role:'主角',
    title:'无根散修',
    portrait:'hero_xuanxuan',
    bio:
      '本是青石村一名樵夫,十六岁那年在山涧捡到半卷无名残书。' +
      '残书无名,却让他一夜之间开了灵根——也让他成了某些人眼里的钥匙。' +
      '他不知那残书是什么,只知上面的字,每一个都像是有人用指甲刻进他脑子里的。',
    arc:'从只想活下去,到想让某些人活不下去。',
  },
  moying: {
    name:'墨影', role:'宿敌',
    title:'断剑冢主',
    portrait:'narrator_foe',
    bio:
      '古战场是他挖的。他在那里埋了三百柄剑,每一柄都是败给他的对手。' +
      '有人说他是魔,有人说他比任何人都懂剑。' +
      '他记不住自己杀过多少人,但每一个人的名字他都记得——刻在碑上。',
    arc:'他没有输过,所以他也不知道自己想要的到底是什么。',
    nemesis:true,
    bgm:'nemesis',
  },
  shuangqing: {
    name:'霜清', role:'引路人',
    title:'落云散人',
    portrait:'narrator_aunt',
    bio:
      '她在落云镇开了间茶摊,三十年只卖三文钱一碗的粗茶。' +
      '来喝茶的人不知道,她曾是某个灭门宗派的最后一人。' +
      '她见过太多天才少年,所以她只给新人倒茶,不给天才倒茶。',
    arc:'她教你的第一件事不是修炼,是别死。',
  },
};

// ---- 奇遇事件(不打断,后台推进)----
// type: good(机缘) / bad(灾劫) / choice(抉择,仅在洞府可决)
export const ENCOUNTERS = [
  {
    id:'e_sword_grave', name:'剑冢余韵', type:'good', weight:12,
    text:'你在乱石缝里摸到一截断剑,剑身尚温,似有人刚刚离去。',
    effect:{ dao:120, insight:6 },
    log:'断剑认主,似有前人留下一缕剑意。',
  },
  {
    id:'e_spirit_herb', name:'野生成药', type:'good', weight:20,
    text:'背阴的石缝里长着一株七叶草,你认得——筑基丹主药之一。',
    effect:{ herb:1, dao:40 },
    log:'得七叶草一株,可入丹。',
  },
  {
    id:'e_ambush', name:'黑风伏杀', type:'bad', weight:14,
    text:'三名散修堵在路口。为首者笑了笑:"身上有货?"',
    effect:{ hpLoss:0.25, dao:-30 },
    log:'一场恶斗。你活下来了,但丢了些东西。',
  },
  {
    id:'e_old_man', name:'路边指路', type:'choice', weight:8,
    text:'一个疯癫老头拦住你,说青岚秘境里有一道门,门后是他毕生所学。' +
          '但他眼睛浑浊,呼吸里带着血腥味。',
    options:[
      { text:'跟他走', effect:{ insight:20, dao:-50 }, log:'他带你穿过一片没有鸟的林子,然后你就再也见不到他了。但你的剑,快了。' },
      { text:'拔剑', effect:{ dao:200, insight:-5 }, log:'他没躲。血溅在你袖口上时,你第一次知道什么叫"心魔"。' },
    ],
  },
  {
    id:'e_fallen_sword', name:'败者之剑', type:'good', weight:6,
    text:'一具尸首靠在树下,手里死死攥着剑,姿势像还在打一场早已结束的仗。',
    effect:{ insight:15, demonSeed:1 },
    log:'你取下他的剑。他的剑上有三百七十道刻痕,每一道都是一次败北。',
  },
  {
    id:'e_tea', name:'落云粗茶', type:'good', weight:18,
    text:'落云镇那间茶摊。老妪给你倒了碗三文钱的粗茶,没说话。',
    effect:{ hp:1, dao:20 },
    log:'茶很苦。但你走的时候,心里安静了些。',
  },
  {
    id:'e_heavenly_eye', name:'天机一瞬', type:'good', weight:4,
    text:'你在山顶打坐,忽然睁眼——看见了半息之后的事。',
    effect:{ insight:30, dao:100 },
    log:'一瞬即万年。你记住了那一瞬。',
  },
];

// ---- 称号系统 ----
export const TITLES = [
  { id:'chizi',    name:'赤子之心',  desc:'逢战必过,却常留对手一命。',   cond:'挑战 ≥30 次且放过 ≥20 人' },
  { id:'xiuliankuang', name:'修炼狂', desc:'只知闭关,不知停歇。',        cond:'连续修炼 30 天无休息' },
  { id:'jianfa',   name:'剑神',      desc:'一剑之下,再无剑。',          cond:'单次战斗以剑系神通斩杀越级对手' },
  { id:'jiansheng',name:'剑圣',      desc:'剑心通明,人剑合一。',        cond:'剑系神通全部满级并融合' },
  { id:'rumo',     name:'入魔',      desc:'你走的路,旁人不敢走。',      cond:'入魔值 ≥ 80' },
  { id:'chishui',  name:'赤水真人',  desc:'手上人命,自己心里有数。',     cond:'击败宿敌 ≥ 3 次' },
  { id:'buniao',   name:'不鸟',      desc:'不结仇,不结缘,独来独往。',   cond:'拒绝所有结盟邀请' },
  { id:'renxia',   name:'仁侠',      desc:'能救则救,能放则放。',         cond:'累计救助散修 ≥ 50 人' },
];
