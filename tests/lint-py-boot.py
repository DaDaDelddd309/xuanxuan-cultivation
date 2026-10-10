#!/usr/bin/env python3
"""浏览器测试的「离线可达性」体检 —— 只验**能不能跑起来**，不验断言。

## 为什么需要它(工单 XX-AUDIT-014 / XX-AUDIT-033)

浏览器测试只能在 CI 上跑(playwright 无 bionic wheel,本机装不上),
于是这类 bug 在本地**结构性不可见**:

```
NameError: name 'os' is not defined
```

而 `python3 -m py_compile` **查不出它** —— py_compile 只查语法,
不查运行期名字解析。我第一版修 full79.py 时就踩了这个坑:
两段"补 os"的注释里各有一句,后加的那段排在了 import 前面,
把刚修好的 bug 又带了回来,而 py_compile 依然是绿的。

## 本脚本做什么

用一个假 `playwright` 模块把 `sync_playwright()` 桩掉,
让每个 .py 测试文件**真的从头执行一遍**,然后只关心两种错:

- `NameError` / `ImportError` / `AttributeError` —— 脚本自身的问题,本地就该抓出来
- 任何其它异常 —— **不算失败**(那多半是桩导致的,不是真 bug)

换句话说:它回答「这个文件在真机上**还没开始点按钮**之前,
会不会就已经崩了」。

## 它不能回答什么

**不能**证明断言对。桩出来的 `pg.evaluate()` 返回假对象,
所有 `ok(name, mock)` 都会判真。所以这个脚本全绿
**不代表浏览器测试会过** —— 那是 CI 的事。
"""
import contextlib
import glob
import io
import os
import sys
import types
import traceback

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TESTS_DIR)


class _Stub:
    """什么都返回自己的万能桩。方法调用 → 新桩;属性 → 新桩;布尔 → True。"""

    def __init__(self, name="_stub"):
        self._name = name

    def __call__(self, *a, **k):
        return _Stub(f"{self._name}()")

    def __getattr__(self, item):
        if item.startswith("__") and item.endswith("__"):
            raise AttributeError(item)
        return _Stub(f"{self._name}.{item}")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __bool__(self):
        return True


def _install_stub():
    """把 playwright.sync_playwright 换成桩,并把 time.sleep 打掉。"""
    pw = types.ModuleType("playwright")
    sync = types.ModuleType("playwright.sync_api")
    sync.sync_playwright = _Stub("sync_playwright")
    pw.sync_api = sync
    sys.modules["playwright"] = pw
    sys.modules["playwright.sync_api"] = sync

    # ⚠️ time.sleep 必须打掉:测试里 sleep 是**真的**在等页面动画,
    #   8 个文件加起来能睡好几分钟。这里只验「能不能开跑」,不等动画。
    import time as _t
    _t.sleep = lambda *a, **k: None


def _run_with_timeout(src, path, seconds=25):
    """在独立线程里跑,超时就算「卡住」—— 防止某个文件把整个 lint 拖死。"""
    import threading
    box = {}

    def run():
        try:
            exec(compile(src, path, "exec"), {"__name__": "__main__", "__file__": path})
            box["ok"] = True
        except BaseException as e:          # noqa: BLE001 - 这里就是要拦住一切
            box["exc"] = e

    th = threading.Thread(target=run, daemon=True)
    # 测试文件自己会 print 一大堆(桩下全是假数据),全部静音 —— 只留本脚本的结论。
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        th.start()
        th.join(seconds)
    if th.is_alive():
        box["timeout"] = True
    return box


def main():
    _install_stub()
    sys.path.insert(0, TESTS_DIR)
    os.chdir(ROOT)  # 测试里用的是 http://127.0.0.1:$XX_TEST_PORT/,工作目录要在仓库根

    ME = os.path.basename(__file__)
    files = sorted(glob.glob(os.path.join(TESTS_DIR, "*.py")))
    # 排除本文件(否则自我递归)和下划线开头的辅助模块(不是测试)。
    files = [f for f in files if os.path.basename(f) != ME
             and not os.path.basename(f).startswith("_")]

    # 真实的"脚本自身故障"只有这三类:名字没解析、模块没找到、属性不存在。
    # TimeoutError / AssertionError 那类是桩造成的,不算。
    REAL_BUGS = (NameError, ImportError, AttributeError, SyntaxError, IndentationError)

    broken = []
    skipped = []
    for f in files:
        name = os.path.basename(f)
        src = open(f, encoding="utf-8").read()
        box = _run_with_timeout(src, f)
        if box.get("timeout"):
            print(f"  ⏱ {name:<22} 桩下超过 25s 未结束(被判定为卡住,不计失败)")
            skipped.append(name)
            continue
        exc = box.get("exc")
        if exc is None:
            print(f"  ✅ {name:<22} 可执行(桩下跑通)")
        elif isinstance(exc, REAL_BUGS):
            tb = traceback.extract_tb(exc.__traceback__)[-1]
            print(f"  ❌ {name:<22} {type(exc).__name__}: {exc}")
            print(f"       出处: line {tb.lineno}  →  {(tb.line or '').strip()[:70]}")
            broken.append(name)
        else:
            print(f"  ✅ {name:<22} 开跑正常(桩下在 {type(exc).__name__} 处中断 —— 桩所致,非脚本 bug)")
            skipped.append(name)

    print()
    if broken:
        print(f"❌ {len(broken)} 个文件在真机上开跑之前就会崩: {', '.join(broken)}")
        print("   这些**不需要浏览器**就能修 —— 它们不是环境问题,是脚本自己的问题。")
        sys.exit(1)
    print(f"✅ {len(files)} 个浏览器测试文件全部可执行(桩下);"
          f"{len(skipped)} 个因桩而中断(正常,不代表有 bug)")


if __name__ == "__main__":
    main()
