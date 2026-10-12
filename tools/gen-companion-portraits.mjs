// 按角色卡批量出图 —— MiniMax image-01
// 用法: node tools/gen-companion-portraits.mjs [--only <stage>] [--dry]
//
// 为什么要有这个脚本而不是手点:
//   1. 五张图必须**规格一致**(同底色/同构图/同笔触),手点五次必然漂;
//      脚本把角色卡的公共段与每阶段差异段拆开,保证差异可控、主体恒定。
//   2. 凭证从 .minimax/config.yaml 读,不落在脚本里、不进版本库。
//   3. 出完自动落 assets/portrait/,并把清单写进 PORTRAIT 可查的命名规则。
//
// ⚠️ 视觉一致性是这类活的主要风险,门禁 tests/companion-portrait-set.mjs
//    盯的是**结构**(五张都在/尺寸一致/都被引用),不是像素级相似度 ——
//    后者靠模型,不靠测试,也不该假装能靠测试保证。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';

const CFG = process.env.HOME + '/.minimax/config.yaml';
const OUT = '/data/data/com.termux/files/home/.tmp/xxv96/local/xxdeploy/assets/portrait';
const CARD = '/data/data/com.termux/files/home/.tmp/xxv96/local/xxdeploy/docs/COMPANION-CARD.md';

// ——— 凭证:只读要用,不打印、不落盘 ———
function readKey() {
  const s = readFileSync(CFG, 'utf8');
  const i = s.indexOf('minimax_api:');
  const seg = s.slice(i, i + 400);
  const m = seg.match(/apiKey:\s*(\S+)/);
  if (!m) { console.error('config.yaml 里找不到 minimax_api.apiKey'); process.exit(2); }
  return m[1];
}
const KEY = readKey();

// ——— 角色卡公共段:五张图**必须一致**的部分 ———
// 逐条都有出处,不是凭感觉堆的形容词:
//   · 画法/底色/构图 ← assets/portrait/companion.jpg 实图(720x964,宣纸底水墨淡彩)
//   · 下半身化墨须    ← docs/COMPANION-MUTATION.md「漩涡、触手、不规则肢体」
//   · 五阶段定义     ← docs/COMPANION-MUTATION.md §一 STAGES
// 改动这里等于改整个角色的身份,必须连同出处一起改。
const BASE = [
  '中式水墨淡彩人物立绘,宣纸米黄底色(约 #ece5d3),墨色浓淡渐变,不是照片、不是3D、不是动漫赛璐璐。',
  '同一位年轻东方女性修士,约十八九岁,黑色长发编成粗辫垂过左肩,几缕碎发垂在颊边。',
  '三分之二侧身朝右,头微低,眼睑下垂,神情安静而略带哀色 —— 不是哀怨,是被安抚过的平静。',
  '穿宽袖长袍,袖口与下摆是极淡的灰墨渲染,布料边缘自然晕开。',
  '**关键特征**:下半身与衣摆正在消散成一缕缕墨色烟须与漩涡,笔触湿润,像宣纸上化开的墨 —— 这是她身上唯一的非人元素,必须保留,但保持唯美、不做恐怖、不加眼球或甲壳。',
  '背景留白为主,只在远景处有极淡的水墨山影与一两缕上升的墨线烟气。',
  '整体色调克制:黑发、灰墨、米黄纸底,除金线外不出现高饱和色。',
].join(' ');

// ——— 每阶段差异段:只写**这一张和别张不同**的东西 ———
// 门槛数值来自 STAGES(0/1/3/6/10),文案来自 STAGES[].desc。
const STAGES = [
  { key: 'sealed', name: '封印', diff:
    // ⚠️ 第一轮出图实测:模型把「五官模糊」**理解成了轻微的水彩晕染**,
    //   出来的脸其实很清晰 —— 于是封印阶段和别的阶段没有本质区别,
    //   而"看不清脸"正是这一阶段唯一的叙事卖点(STAGES[].desc 原文)。
    //   所以这里改成写**具体的遮挡形态**而不是抽象的程度副词,
    //   并显式否定"清晰"。
    '本阶段唯一的一张,且是整组里最特殊的一张:' +
    '她的脸**被墨色漩涡正面遮住**,只隐约透出眼与嘴的轮廓,像隔着水面看人 —— ' +
    '**不要画出清晰立体的五官**,眉眼与鼻唇必须被墨纹与雾气吞没、边界发虚。' +
    '数道浓墨缠绕颈侧与下颌,漩涡纹理蔓延到面颊;周身明度低、蒙一层薄雾。' +
    '这一张要让人一眼看出"她还没显形"。' },
  { key: 'awaken', name: '初醒', diff:
    '五官轮廓开始浮现:仍被两三道墨痕横跨面部与颈部,眉眼形状可辨但边界发虚,' +
    '像墨正在退去;瞳色隐约透出一点冷调,看不清确切颜色。墨须比封印态收敛。' +
    '比封印态**明显清晰一点**,但还不是完全显形。' },
  { key: 'reveal', name: '显形', diff:
    '脸完全清晰,五官立体可辨,是整组里第一张"看得清长相"的图;' +
    '墨痕退到颈侧与手腕,不再遮脸;' +
    '**第一个特征开始出现**:颈侧浮现一小片不规则的墨色鳞纹状印记,克制、局部、不夸张。' },
  { key: 'morph', name: '化形', diff:
    '**第二个特征成型**:除颈侧印记外,双手腕到小臂出现细密墨色纹路,像水墨在皮肤下流动;' +
    '衣摆的墨须明显变长、卷曲更复杂,开始向身侧延伸;神情比前几张更主动,下颌略抬。' },
  { key: 'true', name: '真身', diff:
    '全部特征定格:墨纹覆盖至肩与锁骨,衣摆完全化为成片墨色触须与漩涡并向身后舒展,' +
    '身周有一圈极淡的漩涡气流;五官完全清晰,目光平静正视前方而非垂眼;' +
    '这是**最终形态**,整组里最完整、最有存在感的一张。' },
];

const only = (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null);
const dry = process.argv.includes('--dry');
const list = only ? STAGES.filter(s => s.key === only) : STAGES;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

for (const st of list) {
  const prompt = BASE + ' ' + st.diff;
  const file = `${OUT}/companion_${st.key}.jpg`;
  console.log(`\n=== ${st.name}(${st.key}) ===`);
  if (dry) { console.log('  [dry] prompt 长度', prompt.length, '→', prompt.slice(0, 80) + '…'); continue; }
  console.log('  prompt:', prompt.length, '字符');

  const body = JSON.stringify({
    model: 'image-01',
    prompt,
    aspect_ratio: '3:4',        // 720x964 ≈ 0.747,3:4=0.75,最接近
    n: 1,
    prompt_optimizer: false,    // 关掉:它会"优化"我们的限定词,改掉不该改的细节
  });
  const tmp = process.env.HOME + '/_img_req.json';
  writeFileSync(tmp, body);
  let out;
  try {
    out = execFileSync('curl', ['-s', '--max-time', '180',
      '-X', 'POST', 'https://api.minimaxi.com/v1/image_generation',
      '-H', 'Authorization: Bearer ' + KEY,
      '-H', 'Content-Type: application/json',
      '--data-binary', '@' + tmp], { encoding: 'utf8', maxBuffer: 1 << 24 });
  } catch (e) {
    console.error('  ❌ 请求失败:', e.message); continue;
  }
  let j; try { j = JSON.parse(out); } catch { console.error('  ❌ 返回不是 JSON:', out.slice(0, 200)); continue; }
  const url = j?.data?.image_urls?.[0];
  if (!url) { console.error('  ❌ 没有 image_urls:', JSON.stringify(j).slice(0, 220)); continue; }

  try {
    execFileSync('curl', ['-s', '--max-time', '120', '-o', file, url]);
    console.log('  ✅ 已存', file);
  } catch (e) { console.error('  ❌ 下载失败:', e.message, url.slice(0, 80)); }
}
console.log('\n完成。出图质量需要**人眼**过一遍 —— 脚本只能保证结构,保证不了她还是同一个人。');
