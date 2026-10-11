// 探针：扫全仓 effect/result 字面量的 key 有没有消费点。先只看不判红。
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const JS = 'js';
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(JS);

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
  // 去掉字符串/模板串,避免注释和文案里的同名字段被当成消费点
  .replace(/`(?:\\.|[^`\\])*`/g, '``')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""');

const src = files.map(f => ({ f, code: strip(readFileSync(f, 'utf8')) }));
const all = src.map(s => s.code).join('\n');

const KEY = /\b(?:effect|result|fx)\s*:\s*\{([^}]*)\}/g;
const hits = [];
for (const { f, code } of src) {
  let m;
  KEY.lastIndex = 0;
  while ((m = KEY.exec(code))) {
    const keys = m[1].split(',')
      .map(s => s.split(':')[0].trim())
      .filter(k => /^[A-Za-z_$][\w$]*$/.test(k));
    for (const k of keys) {
      // 消费点:该 key 在别处作为属性被读(key: value 形式即"再声明",不算)
      const readRe = new RegExp(`\\.${k}\\b|\\[['"]${k}['"]\\]|\\b${k}\\s*\\]`, 'g');
      let n = 0, r;
      while ((r = readRe.exec(all))) n++;
      // 动态访问(整体遍历)也算有读者
      const dyn = /Object\.(keys|entries|values)\s*\(\s*(e|fx|effect|result|r)\b/.test(all)
        || /for\s*\(\s*(?:const|let|var)?\s*\w+\s+in\s+(?:e|fx|effect|result)\b/.test(all);
      if (n === 0) hits.push({ f, k, dyn });
    }
  }
}
console.log(`扫描 ${files.length} 个文件,effect/result 字面量里 ${hits.length} 个 key 疑似无消费点:\n`);
for (const h of hits) console.log(`  ${h.f}  ${h.k}${h.dyn ? '   [疑似被动态遍历覆盖 — 需人工确认]' : ''}`);