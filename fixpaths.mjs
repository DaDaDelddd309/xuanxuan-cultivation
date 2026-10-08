import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url))) + '/';
const TESTS = ROOT + 'tests/';
const OLD = '/workspace/probe/rouge-offline';
const BOOT = "import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';\nconst __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');\n";
let n = 0;
for (const f of readdirSync(TESTS).filter(x => x.startsWith('lint-') && x.endsWith('.mjs'))) {
  const p = TESTS + f;
  const before = readFileSync(p, 'utf8');
  if (!before.includes(OLD)) continue;
  let after = before.replace(/(['"])\/workspace\/probe\/rouge-offline([^'"]*)\1/g,
    (_m, q, tail) => `__ROOT__+${q}${tail}${q}`);
  if (!after.includes('const __ROOT__')) after = BOOT + after;
  writeFileSync(p, after, 'utf8');
  n++;
}
console.log('修复', n, '个');
