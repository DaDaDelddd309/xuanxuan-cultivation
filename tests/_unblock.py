# 清掉挡住页面的全屏层。回合制(.xx-duel)优先点「逃」,走正规退出路径。
UNBLOCK_JS = """() => {
  const d = document.querySelector('.xx-duel:not(.hidden)');
  if (d) {
    const b = [...d.querySelectorAll('button,[data-act],[data-art]')]
      .find(x => /逃|退|认输|认栽/.test(x.textContent || ''));
    if (b) { b.click(); return 'duel-escaped'; }
    const x = d.querySelector('.xx-dlg-x,[data-act=close]');
    if (x) { x.click(); return 'duel-closed'; }
  }
  let n = 0;
  document.querySelectorAll('.xx-ritual,.xx-storycard,.xx-duel')
    .forEach(e => { e.remove(); n++; });
  return 'removed-' + n;
}"""

HAS_OVERLAY_JS = """() => !!document.querySelector('.xx-ritual,.xx-storycard,.xx-duel:not(.hidden)')"""


def unblock(pg, tries=8):
    for _ in range(tries):
        if not pg.evaluate(HAS_OVERLAY_JS):
            return True
        pg.evaluate(UNBLOCK_JS)
        pg.wait_for_timeout(400)
    return not pg.evaluate(HAS_OVERLAY_JS)
