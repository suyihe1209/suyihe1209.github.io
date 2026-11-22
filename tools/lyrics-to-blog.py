# -*- coding: utf-8 -*-
"""把「日语歌词精讲」项目的成品页变成展示站能用的页。

项目那边（D:\\DSH-Workspace\\日语歌词精讲\\）生成的是**深色独立版**，
展示站这边是暖纸浅色、带站点导航的版本。每次新增/重建歌词页都要走一遍本脚本，
否则新页面会跟站内其它页长得不一样。

用法（在站点根目录下）：

    python tools/lyrics-to-blog.py "源文件.html" "lyrics/目标文件.html"
    python tools/lyrics-to-blog.py 合集.html lyrics/合集.html
    # 带上下首导航（可选）
    python tools/lyrics-to-blog.py 源.html lyrics/目标.html \
        --prev "三日月ステップ_歌词精讲.html" --prev-title "三日月ステップ"

它做五件事：
  1. 把 html.light 的覆盖块提升成 :root 的默认值，删掉覆盖块与 html.light 前缀
  2. 摘掉主题切换按钮与 localStorage 的主题 JS
  3. 把只成立在深底上的 rgba（顶栏、等级徽章、激活态按钮）换成浅底版本
  4. 删掉右上角装饰图案 .ball 与 body 上的霓虹光斑
  5. 令牌换回站点暖纸色板、注入站点导航行、统一 favicon
"""
import pathlib
import re
import sys

# 项目模板里「浅色主题」用的是淡紫，这里统一改回暖纸
WARM_TOKENS = {
    "--bg:#f5f3fb;": "--bg:#f5efe6;",
    "--bg2:#eeeaf8;": "--bg2:#efe6d8;",
    "--panel2:#f4f1fc;": "--panel2:#f7f1e8;",
    "--line:#e2dcf0;": "--line:#efe6d8;",
    "--line2:#cfc6e8;": "--line2:#e0d3bf;",
}

# 深底专用 rgba → 浅底版本
RGBA_SUBS = [
    ("background:rgba(8,7,13,.94);", "background:rgba(245,239,230,.92);"),
    (".nav{background:rgba(250,248,255,.94);}", ".nav{background:rgba(245,239,230,.92);}"),
    ("\n.bar{background:rgba(250,248,255,.94);}\n", "\n"),
    (".lv.n5{background:rgba(127,240,168,.15);color:var(--green);border:1px solid rgba(127,240,168,.35);}",
     ".lv.n5{background:rgba(15,122,70,.09);color:var(--green);border:1px solid rgba(15,122,70,.26);}"),
    (".lv.n4{background:rgba(95,227,245,.14);color:var(--cyan);border:1px solid rgba(95,227,245,.34);}",
     ".lv.n4{background:rgba(11,122,141,.08);color:var(--cyan);border:1px solid rgba(11,122,141,.24);}"),
    (".lv.n3{background:rgba(255,194,102,.14);color:var(--amber);border:1px solid rgba(255,194,102,.34);}",
     ".lv.n3{background:rgba(138,90,0,.08);color:var(--amber);border:1px solid rgba(138,90,0,.24);}"),
    (".lv.n2{background:rgba(255,128,128,.13);color:var(--red);border:1px solid rgba(255,128,128,.32);}",
     ".lv.n2{background:rgba(179,38,30,.07);color:var(--red);border:1px solid rgba(179,38,30,.22);}"),
    (".lv.rep{background:rgba(183,140,255,.14);color:var(--violet);border:1px solid rgba(183,140,255,.34);}",
     ".lv.rep{background:rgba(107,63,184,.08);color:var(--violet);border:1px solid rgba(107,63,184,.24);}"),
    (".tg.on{background:rgba(255,111,181,.15);border-color:var(--pink);color:var(--pink);font-weight:600;}",
     ".tg.on{background:rgba(194,24,91,.09);border-color:var(--pink);color:var(--pink);font-weight:600;}"),
]

SITE_NAV_CSS = """
/* ---------- 站点导航（与站内其它页统一） ---------- */
.logo{font-size:20px;font-weight:700;color:var(--text);text-decoration:none;margin-right:auto;}
.bar .logo .dot,.logo .dot{color:var(--pink);}
.mainnav{display:flex;align-items:center;gap:18px;}
.bar .mainnav a{text-decoration:none;color:var(--muted);font-size:16.5px;font-weight:400;
  padding:4px 0;transition:color .2s;}
.bar .mainnav a:hover{color:var(--cyan);}
.bar .mainnav a.active{color:var(--cyan);font-weight:700;}
.bar .row.navrow{padding:10px 22px 0;border-bottom:0;}
@media (max-width:700px){
  .bar .mainnav{gap:12px;overflow-x:auto;}
  .bar .mainnav a{font-size:15px;white-space:nowrap;}
  .bar .row.navrow{padding:8px 12px 0;}
}
"""

SITE_NAV_HTML = '''  <div class="row navrow">
    <a class="logo" href="../index.html">柳园最终兵器<span class="dot">.</span></a>
    <nav class="mainnav">
      <a href="../index.html">首页</a>
      <a href="../index.html#tools">工具箱</a>
      <a href="../index.html#lyrics" class="active">歌词精讲</a>
    </nav>
  </div>
'''

PAGER_CSS = """
/* ---------- 上一首 / 下一首 ---------- */
.pager{display:flex;justify-content:space-between;align-items:stretch;gap:12px;margin-top:48px;}
.pager a{flex:1;text-decoration:none;color:var(--text);background:transparent;
  border:1px solid var(--line);border-radius:var(--r-md);padding:14px 16px;
  transition:.16s;display:flex;flex-direction:column;gap:4px;min-width:0;}
.pager a:hover{border-color:var(--pink);background:transparent;transform:translateY(-2px);}
.pager .lab{font-size:11.5px;letter-spacing:.14em;color:var(--muted2);font-weight:700;}
.pager .ttl{font-size:15px;font-weight:700;color:var(--cyan);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pager .next{align-items:flex-end;text-align:right;}
.pager .prev{align-items:flex-start;text-align:left;}
@media (max-width:700px){
  .pager{flex-direction:column;}
  .pager a{align-items:flex-start;text-align:left;}
  .pager .next{align-items:flex-start;text-align:left;}
}
"""


def lift_light_block(src: str) -> str:
    """html.light{...} 的令牌写回 :root，覆盖块整体删掉。"""
    m = re.search(r"html\.light\{(.*?)\n\}", src, re.S)
    if not m:
        return src
    tokens = dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", m.group(1)))
    src = src[: m.start()] + src[m.end():]
    rm = re.search(r":root\{(.*?)\n\}", src, re.S)
    if not rm:
        return src

    def sub(mo):
        name = mo.group(1)
        if name in tokens:
            return "%s:%s;" % (name, tokens[name].strip())
        return mo.group(0)

    new_root = re.sub(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", sub, rm.group(1))
    return src[: rm.start(1)] + new_root + src[rm.end(1):]


def convert(src: str) -> str:
    src = lift_light_block(src)
    src = src.replace("html.light ", "")

    # 主题切换按钮 + 相关 JS
    src = re.sub(r"\n[ \t]*<button[^>]*id=\"themeBtn\"[^>]*>.*?</button>", "", src)
    js = re.search(
        r"/\* ---------- 主题 ---------- \*/\n.*?\nsyncThemeBtn\(\);\n(syncNavH\(\);)", src, re.S
    )
    if js:
        src = src[: js.start()] + js.group(1) + src[js.end():]

    # 深底 rgba
    for a, b in RGBA_SUBS:
        src = src.replace(a, b)

    # 装饰图案与光斑
    src = re.sub(r'[ \t]*<svg class="ball".*?</svg>\n', "", src, flags=re.S)
    src = re.sub(r"header \.ball\{[^}]*\}\n", "", src)
    # body 上的霓虹光斑：整行删掉 radial-gradient 声明即可（剩下的 var(--bg) 仍是合法值）
    src = chr(10).join(ln for ln in src.split(chr(10)) if "radial-gradient(" not in ln)


    # 令牌换暖纸
    for a, b in WARM_TOKENS.items():
        src = src.replace(a, b)

    # favicon 统一
    src = src.replace("fill='%2308070d'", "fill='%23f5efe6'")
    src = src.replace(
        "stroke='%23ff6fb5' stroke-width='2'/%3E%3Ccircle cx='13' cy='13' r='2' fill='%235fe3f5'",
        "stroke='%23c2185b' stroke-width='2'/%3E%3Ccircle cx='13' cy='13' r='2' fill='%230a6d7d'",
    )
    return src


def inject_nav(src: str) -> str:
    if 'class="mainnav"' in src:
        return src
    if SITE_NAV_CSS.strip() not in src:
        src = src.replace("</style>", SITE_NAV_CSS + "</style>", 1)
    # 插到顶栏第一行之前
    m = re.search(r'<div class="bar" id="bar">\n(  <div class="row">)', src)
    if m:
        src = src[: m.start(1)] + SITE_NAV_HTML + src[m.start(1):]
    else:
        m = re.search(r'<div class="bar"[^>]*>\n', src)
        if m:
            src = src[: m.end()] + SITE_NAV_HTML + src[m.end():]
    return src


def inject_pager(src: str, prev_file: str | None, prev_title: str | None) -> str:
    if 'class="pager"' in src:
        return src
    if PAGER_CSS.strip() not in src:
        src = src.replace("</style>", PAGER_CSS + "</style>", 1)
    left = (
        '<a class="prev" href="%s" title="上一首：%s"><span class="lab">← 上一首</span>'
        '<span class="ttl">%s</span></a>' % (prev_file, prev_title, prev_title)
        if prev_file
        else '<span class="spacer">已是第一首</span>'
    )
    block = (
        '<div class="pager">\n  %s\n  '
        '<a class="next" href="合集.html" title="回到合集"><span class="lab">全部曲目 →</span>'
        '<span class="ttl">合集</span></a>\n</div>\n' % left
    )
    return src.replace("<footer>", block + "<footer>", 1)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    src_path, dst_path = argv[1], argv[2]
    prev = prev_title = None
    if "--prev" in argv:
        prev = argv[argv.index("--prev") + 1]
    if "--prev-title" in argv:
        prev_title = argv[argv.index("--prev-title") + 1]

    raw = pathlib.Path(src_path).read_text(encoding="utf-8")
    out = inject_nav(convert(raw))
    if prev:
        out = inject_pager(out, prev, prev_title or prev)

    dst = pathlib.Path(dst_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(out, encoding="utf-8", newline="")
    checks = {
        "themeBtn": out.count("themeBtn"),
        "html.light": out.count("html.light"),
        "ball": out.count('class="ball"'),
        "radial-gradient": out.count("radial-gradient"),
        "冷白/深底rgba": out.count("rgba(250,248,255") + out.count("rgba(8,7,13"),
        "淡紫令牌": sum(out.count(k) for k in WARM_TOKENS),
    }
    bad = {k: v for k, v in checks.items() if v}
    print(f"写出 {dst}  ({len(out):,} 字符)")
    print("残留检查:", bad if bad else "全部为 0 ✓")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
