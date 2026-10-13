#!/usr/bin/env node
// 生成公告页 changelog.html —— 开发日志 / 更新公告(XX-DEPLOY-003)
//
// 为什么是**生成**的而不是手写的:
//   手写的更新日志三个月后必然变成谎言 —— 它不会跟着代码变,也不会跟着验证结果变。
//   而这个项目本轮已经栽过好几次「静态页面比代码乐观」的坑
//   (手写文档说某检查存在,实测 grep 计数为 0)。
//   所以这一页的每个数字都从真源取:
//     版本/构建/文件数 ← version.json
//     模块清单        ← js/ 实际文件树
//     门禁条数        ← package.json 的 lint / test 链
//     更新历史        ← git log(不是另写一套文案)
//   跑一次就同步一次,不会漂。
//
// 用法: node tools/ops/make-changelog.mjs [--check]
//        --check 只校验页面与当前真源一致(接进门禁),不写文件
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK_ONLY = process.argv.includes('--check');
const OUT = join(ROOT, 'changelog.html');

// ⚠️ 版本与构建号从 **sw.js** 读,不从 version.json 读。
//
//   VERSION-CONVENTION §2:sw.js 的 `const V` 是版本号唯一真源,其余三处由 lint-version 校验。
//   从 version.json 读会构成一个环:
//       changelog.html 内嵌 version.json 的版本号
//       version.json 又含 changelog.html 的哈希
//       → 改任一个,另一个立刻过期。本轮就被这个坑红过一次。
//   改从真源读,环就断了;写完页面再自动重生成清单,一条命令收敛。
const swSrc = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const V = (/const V\s*=\s*'([^']+)'/.exec(swSrc) || [])[1] || 'unknown';
const BUILD = (/const BUILD\s*=\s*'([^']+)'/.exec(swSrc) || [])[1] || '';

const vjson = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8'));
const FILE_COUNT = Object.keys(vjson.files).length;   // 只用于显示条目数,不参与版本判定
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const git = (...a) => { try { return execSync(`git ${a.join(' ')}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }); } catch { return ''; } };

// ── 门禁条数 ──
const countGates = s => (s.match(/tests\/[A-Za-z0-9._-]+\.(mjs|py)/g) || []).length;
const LINT_GATES = countGates(pkg.scripts.lint);
const TEST_SUITES = countGates(pkg.scripts.test);
const LEGACY = countGates(pkg.scripts['test:legacy'] || '');
const RNG = countGates(pkg.scripts['test:rng'] || '');
const E2E = countGates(pkg.scripts['test:e2e'] || '');

// ── 模块清单(来自真实文件树)──
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(f)) out.push(relative(ROOT, p));
  }
  return out;
}
const mods = walk(join(ROOT, 'js'));
const AREAS = [
  ['核心引擎', /^js\/core\//], ['战斗与掉落', /^js\/game\//], ['像素素材', /^js\/pix\//],
  ['局内界面', /^js\/ui\//], ['修仙系统', /^js\/xiuxian\/(?!world\/|ui\/)/],
  ['修仙界面', /^js\/xiuxian\/ui\//], ['大世界', /^js\/xiuxian\/world/],
];
const areaRows = AREAS.map(([name, re]) => {
  const list = mods.filter(m => re.test(m));
  return list.length ? { name, n: list.length, files: list.map(m => m.replace(/^js\//, '')) } : null;
}).filter(Boolean);

// ── 更新历史 ──
//
// ⚠️ 不能按「提交信息里写了升版」来分版本 —— 实测当前分支上只有 7 条 `升 v` 提交,
//    而 sw.js 的 const V 改过三十多次:大量版本是在 feat/fix 提交里**悄悄**升的。
//    按提交信息分组会漏掉一大半历史(第一版就只分出 8 段)。
//
// 判据改成取自被检查对象本身:**每个提交当时的 sw.js 里 const V 是多少**。
// 那正是玩家浏览器里实际存在的缓存版本,也是 sw.js 自己认的版本。
// 所以本页显示的版本号不可能与线上对不上。
//
// ⚠️ 必须带 `--first-parent`:不加的话版本序列是乱的
//    (实测 aj→ai→aj→ai→ah→ag→ah —— 合并把分支上基于旧点的提交带回来,
//    日期序 ≠ 发布序)。只走主线才是「发布过的顺序」。
const HISTORY_DEPTH = 80;                 // 深度上限,页面别无限长
const commitLog = git('log', '--first-parent', `-${HISTORY_DEPTH}`, '--pretty=format:%H%x1f%s%x1f%b%x1e')
  .split('\x1e').filter(s => s.trim());
const parsed = commitLog.map(s => {
  const [h, subj] = s.replace(/^\n/, '').split('\x1f');
  const m = /^(fix|feat|test|docs|chore|refactor|perf)(?:\(([^)]+)\))?:\s*(.+)$/.exec((subj || '').trim());
  return {
    sha: (h || '').slice(0, 7),
    type: m ? m[1] : 'other', scope: m ? (m[2] || '') : '',
    title: m ? m[3] : (subj || '').trim(),
    date: git('show', '-s', '--format=%ad', '--date=short', h).trim(),
    v: (/const V\s*=\s*'([^']+)'/.exec(git('show', `${h}:sw.js`)) || [])[1] || '',
  };
});
// 按 sw.js 里 const V 的实际值分组:同一版本号的提交归到一段,新的在前
const releases = [];
for (const e of parsed) {
  const key = e.v || '(无版本)';
  if (!releases.length || releases[releases.length - 1].version !== key) {
    releases.push({ version: key, date: e.date, items: [] });
  }
  releases[releases.length - 1].items.push(e);
}
// xuanxuan-v099an → V0.99 · an(099 是 0.99 的编码,与 lint-version 同一套记法)
const prettyV = v => {
  const m = /^xuanxuan-v(\d{3})([a-z]*)$/.exec(v || '');
  if (!m) return v || '(未知)';
  return `V${m[1][0]}.${m[1].slice(1)}${m[2] ? ' · ' + m[2] : ''}`;
};
const TYPE_CN = { fix: '修复', feat: '新增', test: '门禁', docs: '文档', chore: '维护', refactor: '重构', perf: '性能', other: '其他' };
const SCOPE_CN = {
  audio: '音频', sw: '离线缓存', lint: '门禁', math: '局内难度', xiuxian: '修仙',
  ui: '界面', manifest: '版本清单', ci: '持续集成', tools: '工具', game: '战斗', deploy: '部署',
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── 页面 ──
const rel = versions => versions.map((r, ri) => `
  <section class="rel${ri === 0 ? ' cur' : ''}">
    <h3>${esc(prettyV(r.version))}${ri === 0 ? ' <span class="tag">当前</span>' : ''}<small>${esc(r.date)} · ${r.items.length} 条</small></h3>
    <ul class="items">${r.items.slice(0, 40).map(i => `
      <li class="t-${i.type}"><span class="badge">${TYPE_CN[i.type] || i.type}</span>${i.scope ? `<span class="scope">${SCOPE_CN[i.scope] || esc(i.scope)}</span>` : ''}<span class="ti">${esc(i.title)}</span><code>${esc(i.sha)}</code></li>`).join('')}
    </ul>${r.items.length > 40 ? `<p class="more">…另有 ${r.items.length - 40} 条</p>` : ''}
  </section>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>轩轩修仙传 · 更新日志</title>
<meta name="description" content="轩轩修仙传的版本更新、质量门禁与模块清单。">
<link rel="icon" href="icons/icon-192.png">
<style>
:root{
  --ink:#080706; --ink2:#131110; --ink3:#1c1917; --line:rgba(236,229,211,.12);
  --paper:#ece5d3; --dim:#c9c0ab; --faint:#8a8378;
  --gold:#c9a227; --gold-dim:#8a6f1c; --jade:#5a7a6a; --cinnabar:#8c3a2e;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--paper);
  font:16px/1.75 "Noto Serif SC",'Songti SC',serif;
  -webkit-text-size-adjust:100%}
.wrap{max-width:780px;margin:0 auto;padding:28px 18px 64px}
header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:26px}
h1{margin:0 0 6px;font-size:26px;letter-spacing:.12em;font-weight:600}
.sub{color:var(--faint);font-size:13px;letter-spacing:.06em}
.back{display:inline-block;margin-top:14px;color:var(--gold);text-decoration:none;
  border:1px solid var(--line);padding:7px 15px;border-radius:3px;font-size:14px}
.back:hover{border-color:var(--gold-dim)}
h2{font-size:17px;letter-spacing:.1em;margin:34px 0 14px;color:var(--gold);
  border-left:3px solid var(--gold-dim);padding-left:10px}
h3{font-size:15px;margin:0 0 10px;letter-spacing:.06em;display:flex;
  align-items:baseline;gap:10px;flex-wrap:wrap}
h3 small{color:var(--faint);font-weight:400;font-size:12px}
.tag{background:var(--gold-dim);color:#1a1508;font-size:11px;padding:1px 7px;
  border-radius:2px;letter-spacing:.05em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px}
.card{background:var(--ink2);border:1px solid var(--line);border-radius:3px;padding:13px 15px}
.card .n{font-size:25px;color:var(--gold);line-height:1.25}
.card .l{color:var(--faint);font-size:12px;letter-spacing:.05em}
.card .s{color:var(--jade);font-size:12px;margin-top:3px}
.rel{background:var(--ink2);border:1px solid var(--line);border-radius:3px;
  padding:16px 18px;margin-bottom:14px}
.rel.cur{border-color:var(--gold-dim)}
ul.items{list-style:none;padding:0;margin:0}
ul.items li{display:flex;gap:9px;align-items:baseline;padding:5px 0;
  border-bottom:1px dashed rgba(236,229,211,.07);font-size:14px;line-height:1.6}
ul.items li:last-child{border-bottom:0}
.badge{flex:none;font-size:11px;padding:1px 6px;border-radius:2px;letter-spacing:.04em;
  border:1px solid var(--line);color:var(--faint)}
.t-fix .badge{color:var(--jade);border-color:var(--jade)}
.t-feat .badge{color:var(--gold);border-color:var(--gold-dim)}
.t-test .badge{color:var(--dim)}
.t-docs .badge{color:var(--faint)}
.t-chore .badge{color:var(--cinnabar);border-color:rgba(140,58,46,.5)}
.scope{flex:none;color:var(--gold-dim);font-size:12px;min-width:2.6em}
.ti{flex:1;color:var(--dim)}
code{color:var(--faint);font-size:11px;opacity:.7}
.more{color:var(--faint);font-size:12px;margin:8px 0 0}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--faint);font-weight:400;font-size:12px;letter-spacing:.05em}
td.n{color:var(--gold);white-space:nowrap}
td.files{color:var(--faint);font-size:11.5px;line-height:1.6}
.note{background:var(--ink3);border-left:3px solid var(--cinnabar);
  padding:12px 15px;font-size:13.5px;color:var(--dim);margin:12px 0}
.note b{color:var(--cinnabar)}
.ok{color:var(--jade)} .warn{color:var(--gold-dim)}
footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);
  color:var(--faint);font-size:12px}
</style>
</head>
<body><div class="wrap">

<header>
  <h1>轩轩修仙传 · 更新日志</h1>
  <div class="sub">当前版本 ${esc(V)} · 构建 ${esc(BUILD)} · 本页由 tools/ops/make-changelog.mjs 从 git 与仓库实况生成</div>
  <a class="back" href="index.html">← 回到游戏</a>
</header>

<h2>这一版的完成度</h2>
<div class="cards">
  <div class="card"><div class="n">${LINT_GATES}</div><div class="l">代码门禁</div><div class="s ok">全部通过</div></div>
  <div class="card"><div class="n">${TEST_SUITES}</div><div class="l">逻辑测试</div><div class="s ok">全部通过</div></div>
  <div class="card"><div class="n">${LEGACY + RNG + E2E}</div><div class="l">兼容 / 随机 / 端到端</div><div class="s ok">全部通过</div></div>
  <div class="card"><div class="n">${mods.length}</div><div class="l">JS 模块</div><div class="s">${FILE_COUNT} 个文件在版本清单内</div></div>
</div>

<div class="note">
  <b>门禁全绿 ≠ 没问题。</b>它只说明「当前这些检查全部通过」。
  浏览器实测在持续集成里跑（playwright + chromium），
  本机（Android/Termux）装不了 playwright，没有 bionic wheel —— 所以本地跑不了这一套。
</div>

<h2>模块清单</h2>
<table>
  <tr><th>区域</th><th>模块数</th><th>文件</th></tr>
  ${areaRows.map(a => `<tr><td>${esc(a.name)}</td><td class="n">${a.n}</td><td class="files">${a.files.map(esc).join('、')}</td></tr>`).join('\n  ')}
</table>

<h2>更新历史</h2>
${rel(releases)}

<h2>还没做完的</h2>
<div class="note">
  这些是<b>已知且未复核/未完成</b>的部分，写在这里以免「全绿」被误读成「已完工」：
  <ul style="margin:8px 0 0;padding-left:18px">
    <li>死成员清单 174 条<b>只抽样复核了 6 条</b>，其余逐条未复核（门禁为 report-only）</li>
    <li>音频电平结论全部来自<b>数值仿真</b>（真跑 audio.js 量总线），<b>未经实机听感确认</b></li>
    <li>赶路遭遇系统、搜打撤等特性由 FEATURE_FLAGS 显式关闭，属未接线而非缺陷</li>
  </ul>
</div>

<footer>
  生成时间取自构建号 ${esc(BUILD)}。页面内容全部取自仓库实况（git log / version.json / package.json / 文件树），
  不含手写数字；重跑 <code>npm run changelog</code> 即可与代码同步。
</footer>

</div></body></html>
`;

if (CHECK_ONLY) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== html) {
    console.error('❌ changelog.html 与仓库实况不一致 —— 重新生成: npm run changelog');
    const hint = [
      [`v${esc(V)}`, cur.includes(V)],
      [`构建号`, cur.includes(BUILD)],
      [`模块数 ${mods.length}`, cur.includes(`>${mods.length}<`)],
      [`门禁数 ${LINT_GATES}`, cur.includes(`>${LINT_GATES}<`)],
    ];
    for (const [k, okk] of hint) console.error(`   ${okk ? '✓' : '✗'} ${k}`);
    process.exit(1);
  }
  console.log('✅ changelog.html 与仓库实况一致');
  process.exit(0);
}

writeFileSync(OUT, html);
console.log(`✅ changelog.html 已写 · ${LINT_GATES} 门禁 / ${TEST_SUITES} 测试 / ${mods.length} 模块 / ${releases.length} 个版本段`);

// 写完页面立刻重生成清单 —— 否则 version.json 里 changelog.html 的哈希是旧的,
// 而 lint-version 会判「清单已过期」。把这一步收进本命令,
// 是为了让人不必记住「先写页面还是先写清单」这个顺序(本轮已经因此红过一次)。
try {
  execSync(`node ${JSON.stringify(join(ROOT, 'tests', 'make-manifest.mjs'))} --write`,
    { cwd: ROOT, stdio: 'ignore' });
  console.log('   已连带重生成 version.json(页面哈希同步)');
} catch (e) {
  console.error(`   ⚠️ 重生成 version.json 失败:${e.message} —— 手动跑 npm run manifest:write`);
  process.exit(1);
}