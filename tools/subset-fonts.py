# -*- coding: utf-8 -*-
"""按站内实际用到的字符集，把思源宋体裁剪成子集。

用法（在站点根目录下）：
    pip install fonttools brotli
    python tools/subset-fonts.py

每次新增文章/歌词之后重跑一次即可。脚本会遍历所有 .html，去掉标签但保留
<script>/<style> 里的字符串（歌词数据就在 script 里），再把常用标点和 ASCII 补进去。
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "fonts"

# 无论用不用得上都保留的字符：ASCII + 常用中西标点 + 日文段落记号
EXTRA = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "　、。，．・：；？！゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー—‐／＼～∥｜…‥"
    + "''""（）〔〕［］｛｝〈〉《》「」『』【】＋－±×÷＝≠＜＞≦≧∞∴♂♀°′″℃￥＄"
    + "¢£％＃＆＊＠§☆★○●◎◇◆□■△▲▽▼※〒→←↑↓〓"
    + "—…–·“”‘’‰′″⁄"
    + "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
)


def collect_chars() -> str:
    chars = set(EXTRA)
    for path in ROOT.rglob("*.html"):
        if ".git" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        # 去掉注释和标签，但保留 script/style 内的字符串
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        chars.update(text)
    # 去掉控制字符
    return "".join(sorted(c for c in chars if c.isprintable() or c == " "))


def main() -> int:
    text = collect_chars()
    charset = ROOT / "fonts" / ".charset.txt"
    charset.write_text(text, encoding="utf-8")
    print(f"字符集：{len(text)} 个不同字符 → {charset.relative_to(ROOT)}")

    for name in ("SourceHanSerifCN-Regular.woff2", "SourceHanSerifCN-Bold.woff2"):
        src = FONT_DIR / name
        out = FONT_DIR / (src.stem + ".subset.woff2")
        before = src.stat().st_size
        cmd = [
            sys.executable, "-m", "fontTools.subset", str(src),
            f"--text-file={charset}",
            "--flavor=woff2",
            "--layout-features=*",
            "--no-hinting",
            "--desubroutinize",
            f"--output-file={out}",
        ]
        subprocess.run(cmd, check=True)
        after = out.stat().st_size
        print(f"{name}: {before/1048576:.2f} MB → {after/1048576:.2f} MB "
              f"（{(1 - after / before) * 100:.0f}% 更小）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
