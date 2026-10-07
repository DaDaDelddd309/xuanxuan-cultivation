// ===== 传说妖谱 · 有出处的妖 =====
// 设计原则:每种妖都有「来历」,不是凭空刷出来的怪物。
// 来历决定它为什么在这、为什么被追、玩家为什么该打它。
// rarity: 3=常见 4=稀有 5=传说(会引发世界事件)

export const LEGEND = {
  hongyi: {
    key:'hongyi', name:'红衣女鬼', img:'assets/legend/hongyi.jpg',
    rarity:4, kind:'ghost', where:'village',
    lore:'她原本是青石村某家的女儿,那年大旱,父亲把她卖给了黑山姥姥换粮。',
    story:'她死在第一年的冬天。尸首被抬出村时,身上还穿着嫁衣。后来每逢有人办喜事,'
        + '她的影子就会出现在窗外。她不害人,她只是记得自己没上过轿。',
    tell:'落云镇的老妪说:红衣女鬼从不动手,但凡见过她的人,三年内必有一桩婚事——'
        + '不论是人是鬼。',
    hp:260, dmg:26, xp:16,
    drops:[{ id:'scroll_2', p:0.30 }, { id:'stone_2', p:0.20 },
            { id:'yu_jian', p:0.12 }, { id:'bld_field', p:0.02 }],
    quest: { title:'红嫁衣', desc:'在青石村外的枯井找到她的嫁衣,替她走完那年的礼。',
            target:'hongyi', reward:{ dao:800, scroll:'scroll_2' } },
  },
  laolao: {
    key:'laolao', name:'黑山姥姥', img:'assets/legend/laolao.jpg',
    rarity:5, kind:'demon', where:'elite',
    lore:'她是六十年前那一任的「姥姥」。上一任死在她手里,她继承了那个位子。',
    story:'她在黑山开洞府,以「许愿」为名收活人:许一次,给一点甜;不给,就把人挂在风里。'
        + '镇上有人替她立了长生牌位 —— 她自己都不知道。',
    tell:'有散修说,黑山姥姥从不亲手杀人。她只让人许愿。',
    hp:900, dmg:52, xp:58,
    drops:[{ id:'stone_4', p:0.30 }, { id:'scroll_3', p:0.22 },
            { id:'xi_sui', p:0.14 }, { id:'bld_hall', p:0.05 }],
    quest: { title:'许 愿', desc:'替一个被许愿索命的孩子还愿,找到黑山姥姥的愿牌。',
            target:'laolao', reward:{ dao:2400, scroll:'scroll_3' } },
  },
  baize: {
    key:'baize', name:'白泽', img:'assets/legend/baize.jpg',
    rarity:5, kind:'auspice', where:'secret',
    lore:'它知天下万物之情。见白泽者,不必再问天。',
    story:'传说白泽只出现在有「大疑问」的地方。它不出手,它看着你。'
        + '有人因它一句话破了筑基的壁,也有人因它一句话疯了。',
    tell:'若你在秘境深处遇见白泽,记住:别问它「我是谁」。',
    hp:1200, dmg:0, xp:200,
    drops:[{ id:'scroll_5', p:0.55 }, { id:'stone_5', p:0.40 },
            { id:'zhan_bei', p:0.20 }, { id:'bld_market', p:0.10 }],
    // 白泽不攻击,见到即得机缘
    peaceful:true,
    quest: { title:'知 者', desc:'白泽知道一个你一直想问的答案。代价是它也要问你一个。',
            target:'baize', reward:{ dao:0, scroll:'scroll_5', special:'ask' } },
  },
  dangkang: {
    key:'dangkang', name:'当康', img:'assets/legend/dangkang.jpg',
    rarity:5, kind:'auspice', where:'field',
    lore:'独角之豕,名曰当康。见到它,天下大穰。',
    story:'当康一年只出现一次,出现在哪里,那里就丰收。'
        + '但它同时也是最好的诱饵 —— 所有人都在追它,追到最后忘了它在逃什么。',
    tell:'老农说:别追当康。你追它,它就带你进山。',
    hp:1600, dmg:0, xp:150,
    drops:[{ id:'scroll_4', p:0.35 }, { id:'stone_4', p:0.45 },
            { id:'bld_well', p:0.15 }, { id:'bld_field', p:0.10 }],
    peaceful:true,
    quest: { title:'追 豕', desc:'当康往山里去。你若追得上,就知道它在躲什么。',
            target:'dangkang', reward:{ dao:1600, scroll:'scroll_4', special:'chase' } },
  },
  qingqiong: {
    key:'qingqiong', name:'青穹', img:'assets/legend/qingqiong.jpg',
    rarity:5, kind:'auspice', where:'boss',
    lore:'虎啸则风生,风从则云起。古人以为云生风处,风起云涌,是为青穹 —— 一头能行风的老虎。',
    story:'它是百兽之长。跟着它走的人能避百兽,但它自己也有一劫 —— '
        + '那一劫来临前,谁跟着它谁死。所以它从不回头。',
    tell:'林中人说:青穹回头之日,便是你该死之时。',
    hp:3000, dmg:96, xp:280,
    drops:[{ id:'stone_5', p:0.42 }, { id:'scroll_5', p:0.25 },
            { id:'bld_barracks', p:0.14 }, { id:'bld_market', p:0.10 }],
    quest: { title:'不 回 头', desc:'青穹不会回头。你也不能。',
            target:'qingqiong', reward:{ dao:6000, scroll:'scroll_5', special:'noLook' } },
  },
  jiangu: {
    key:'jiangu', name:'剑骨', img:'assets/legend/jiangu.jpg',
    rarity:4, kind:'wraith', where:'elite',
    lore:'古战场那三百柄断剑,有一柄不属于任何败者。',
    story:'他本是墨影座下唯一赢过他的人。赢的那一刻,他自己的剑断了。'
        + '他的魂魄就卡在那柄断剑里,年年岁岁重复那一剑。',
    tell:'断剑冢最深处有一柄剑,剑骨站在旁边。杀剑骨,剑归你;不杀,它替你再演一遍。',
    hp:760, dmg:58, xp:42,
    drops:[{ id:'stone_3', p:0.36 }, { id:'scroll_3', p:0.20 },
            { id:'jiangu_sword', p:0.06 }],
    quest: { title:'第 三 百 一 柄', desc:'让剑骨演完那一剑。看完再决定要不要杀他。',
            target:'jiangu', reward:{ dao:1800, scroll:'scroll_3', special:'watch' } },
  },
  shijiang: {
    key:'shijiang', name:'墓前石将', img:'assets/legend/shijiang.jpg',
    rarity:4, kind:'construct', where:'tomb',
    lore:'仙人墓的守门人。它守的不是墓,是一句没说完的话。',
    story:'墓主死前让人刻了一句话在石将背上,没刻完就咽气了。'
        + '一千年来,石将这半句守成了完整的一句话 —— 只是没人知道原话是什么。',
    tell:'石将从不主动出手。你若动它身上的一个字,后果自负。',
    hp:1400, dmg:64, xp:70,
    drops:[{ id:'stone_4', p:0.38 }, { id:'scroll_4', p:0.24 },
            { id:'bld_tower', p:0.10 }],
    quest: { title:'半 句 话', desc:'补完石将背上那句话。它会告诉你墓主是谁。',
            target:'shijiang', reward:{ dao:2600, scroll:'scroll_4', special:'words' } },
  },
  dengshi: {
    key:'dengshi', name:'灯尸', img:'assets/legend/dengshi.jpg',
    rarity:3, kind:'ghost', where:'field',
    lore:'纸人扎成的队伍,本是给死人引路的。后来引错了方向。',
    story:'白事上走在最前头的那串灯笼,走了一夜没走到坟。'
        + '它们现在还在找那座坟。你若替它们找到,它们就散了。',
    tell:'夜里听见远处有铃,别应。那是灯尸在问路。',
    hp:210, dmg:20, xp:12,
    drops:[{ id:'scroll_1', p:0.26 }, { id:'stone_1', p:0.28 },
            { id:'bld_field', p:0.03 }],
    quest: { title:'引 路', desc:'替灯尸找到那座找不到的坟。',
            target:'dengshi', reward:{ dao:500, scroll:'scroll_1' } },
  },
};
export const LEGEND_LIST = Object.values(LEGEND);
export function legendByRarity(r) { return LEGEND_LIST.filter(l => l.rarity === r); }

// 按地点找该出现的传说妖
export function legendAt(where) {
  return LEGEND_LIST.filter(l => l.where === where);
}