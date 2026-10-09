#!/bin/bash
# 逻辑测试全跑。任一失败即退出。
#
# 单一真源 = package.json 的 npm scripts。
# 这里只负责:① 逐项跑出可读的汇总 ② 自检「没有游离在 CI 之外的测试」。
#
# 为什么不再手工列 lint 清单(XX-AUDIT-001):
#   原来这里硬列 9 项,与 npm run lint 的 19 项不一致 —— 漏掉的 10 项
#   (lint-arts / lint-contrast / lint-scope / lint-portraits 等)从来没被检查过,
#   于是「run-all 全绿」并不代表基线完整。改走 npm run lint 之后,
#   「清单」只有一份,加 lint 不会再漏接。
cd "$(dirname "$0")/.." || exit 1
fail=0

# —— 1. 编号测试(t80–t93)逐个跑,输出可读的「通过/失败」汇总 ——
# 为什么单独列而不是并进 npm test:并进 `&&` 链会在第一个失败处停下,
# 后面的全看不见。排查时需要知道「到底几个挂了」,而不只是「挂了」。
for t in t80 t81 t82 t83 t84 t85 t86 t87 t88 t89 t90 t91 t92 t93; do
  f=""
  [ -f "tests/$t.mjs" ] && f="tests/$t.mjs"
  [ -z "$f" ] && [ -f "tests/$t.js" ] && f="tests/$t.js"
  [ -z "$f" ] && { echo "❌ 缺 $t"; fail=1; continue; }
  out=$(node "$f" 2>&1)
  line=$(echo "$out" | grep -E "^通过 [0-9]+ / 失败 [0-9]+$" | tail -1)
  n_ok=$(echo "$line" | sed -n 's/通过 \([0-9]*\).*/\1/p')
  n_no=$(echo "$line" | sed -n 's/.*失败 \([0-9]*\)/\1/p')
  echo "  $t: 通过 ${n_ok:-?} / 失败 ${n_no:-?}"
  if [ "${n_no:-1}" != "0" ]; then
    fail=1
    echo "$out" | grep -B1 "❌" | sed 's/^/      /'
  fi
done

# —— 2. 其余测试(test-* / e2e-*)逐个跑 ——
# 同样逐个跑而不是并进 `&&`,理由同上。
echo ""
for f in tests/test-*.mjs tests/e2e-*.mjs; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  if out=$(node "$f" 2>&1); then
    printf "  ✅ %-26s %s\n" "$b" "$(echo "$out" | grep -oE '\([0-9]+/[0-9]+\)|[0-9]+ 通过 / [0-9]+ 失败' | tail -1)"
  else
    printf "  ❌ %s\n" "$b"
    echo "$out" | grep -E '❌|FAIL|Error' | head -4 | sed 's/^/      /'
    fail=1
  fi
done

# —— 3. 完整 lint 套件(单一真源:npm run lint)——
echo ""
npm run lint || fail=$((fail+1))

# —— 4. 死导出检测(XX-AUDIT-007):report-only,不参与 fail 计数 ——
# 它是「提醒清单」不是门禁 —— 候选里混着真死代码与动态访问,机器分不开,
# 人工确认过的写进 deadexport-baseline.txt。挂在 run-all 里是为了
# 「每次跑基线都能看见有没有新增死导出」,而不是为了拦路。
node tests/lint-deadexport.mjs || true

# —— 5. 元检查:tests/ 下不该有「存在但没被跑」的测试 ——
#
# 这套东西反复出问题,根因都是同一个:测试文件存在,但没人接进基线。
#   · test-companion.mjs 完整覆盖灵伴且一直全绿,而测**已删除 API** 的
#     t81.js 长期是红的 —— 红着提交进了仓库。
#   · 15 个 test-* + 10 个 lint-* 长期游离在 run-all 之外。
#   · t80–t83 不在任何 npm 脚本里,CI 跑的 check 会完整跳过。
# 光「这次把它们接进来」没用,下次新增还会漏。所以加这道自检:
# 任何没被接进来的 .js/.mjs,这里直接红。
#
# 有意排除:
#   harness.mjs   —— e2e 引用的库,本身不是测试
#   make-manifest.mjs —— 要 --write 才写盘的工具
#   lib-swlist.mjs —— sw.js 预缓存清单的**共享解析**(lint-precache 与 test-assets 共用,
#                     2026-10-10 把那两份拷贝收敛成一份)
#   lib-uimod.mjs  —— 修仙阁 UI 层的**共享源码解析**(XX-AUDIT-005 拆 ui.js 配套)。
#                     被 test-spine-wiring / test-uimod / 后续多个结构测试 import,
#                     本身不是测试。放在这里是因为它读的是 tests/ 同级的源码,
#                     而它的自测是 test-uimod.mjs(那个才进 CI)。
# .py 属于浏览器套件,不在本脚本职责内(见 run-browser.sh)。
echo ""
excluded='harness.mjs|make-manifest.mjs|lib-swlist.mjs|lib-uimod.mjs'
orphan=0
for f in tests/*.mjs tests/*.js; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  echo "$b" | grep -qE "^($excluded)$" && continue
  echo "$b" | grep -qE '^t[89][0-9]\.(mjs|js)$'   && continue   # 第一个循环按编号接
  echo "$b" | grep -qE '^(test|e2e)-.*\.mjs$'         && continue   # 第二个循环按 glob 接
  grep -q "$b" package.json && continue                          # npm scripts 用裸名
  grep -q "$b" "$0"        && continue
  case "$b" in lint-*) grep -q "${b%.mjs}" package.json && continue;; esac
  echo "  ❌ 孤儿测试:$b(存在,但既不在 npm scripts 也不在本脚本的循环里)"
  orphan=$((orphan+1))
done
if [ $orphan -gt 0 ]; then
  echo "  → $orphan 个测试文件游离在 CI 之外。接进 package.json,或从 tests/ 移走。"
  fail=1
else
  echo "  ✅ tests/ 下没有游离测试"
fi

echo ""
if [ $fail -eq 0 ]; then echo "✅ 全部通过"; else echo "❌ 有失败"; fi
exit $fail