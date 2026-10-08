#!/usr/bin/env node
// 版本清单生成器（工单 XX-PROBE-001）
//
// 产物：version.json —— 版本 + 改了哪些文件 + 文件数 + 校验和
//
// 为什么需要它:
//   这轮「全站灰色」查了两轮才找到真因，其中一大半时间花在
//   「到底是缓存问题还是真 bug」上 —— 因为线上跑的是哪一版、
//   哪些文件是新的，**页面自己知道，但没人告诉它、也没人去看**。
//
//   把这些做成一个探针能读的文件，排查就从「猜」变成「查」。
//
// 用法：node tests/make-manifest.mjs            # 读 git 算出清单
//      node tests/make-manifest.mjs --write    # 写进 version.json
//      node tests/make-manifest.mjs --base <sha>  # 对比某个历史版本
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execSync(`git ${a.join(' ')}`, { cwd: ROOT, encoding: 'utf8' }).trim();

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;

// —— 版本 ——
const sw = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const V = (sw.match(/const V\s*=\s*'([^']+)'/) || [])[1] || 'unknown';
const BUILD = (sw.match(/const BUILD\s*=\s*'([^']+)'/) || [])[1] || '';

// —— 文件清单 + 校验和（sha256 前 12 位，够用且短）——
function walk(dir, out = [], base = '') {
  for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(`${dir}/${e.name}`, out, rel);
    else out.push(rel);
  }
  return out;
}
const files = walk('.')
  .filter(f => /\.(js|css|html|json|webmanifest|md)$/.test(f) || /^icons\//.test(f))
  .filter(f => f !== 'version.json' && f !== 'node_modules/version.json')
  .sort();

const manifest = {};
for (const f of files) {
  try {
    manifest[f] = createHash('sha256').update(readFileSync(resolve(ROOT, f))).digest('hex').slice(0, 12);
  } catch { /* 跳过读不了的 */ }
}

const out = {
  version: V,
  build: BUILD,
  count: Object.keys(manifest).length,
  // 关键：探针只比对 files 就能知道「我是不是旧的」
  files: manifest,
  ...(BASE ? { base: BASE, changed: changedSince(BASE) } : {}),
};

function changedSince(base) {
  try {
    const raw = git('diff', '--name-only', `${base}`, 'HEAD');
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch { return []; }
}

const json = JSON.stringify(out, null, 2);
if (WRITE) {
  writeFileSync(resolve(ROOT, 'version.json'), json);
  console.log(`✅ version.json 已写：${out.version} · ${out.count} 个文件`);
} else {
  console.log(json);
}
