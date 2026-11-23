#!/usr/bin/env python3
"""Wrap caption files to fit the video width.

Usage: caption.py <txtdir> <fontsize> <maxwidth>
Rewrites cap<N>.txt in place, greedy-wrapped so every line fits maxwidth.
Lines are never truncated — a long caption simply becomes more lines.
Overlong single words are hard-broken mid-word as a last resort.
"""
import glob
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/TTF/DejaVuSans.ttf"


def width(text, font, draw):
    return draw.textlength(text, font=font)


def wrap(text, font, draw, maxw):
    words = text.split(" ")
    # hard-break any single word wider than the frame
    fixed = []
    for w in words:
        while width(w, font, draw) > maxw:
            cut = len(w)
            while cut > 1 and width(w[:cut], font, draw) > maxw:
                cut -= 1
            fixed.append(w[:cut])
            w = w[cut:]
        fixed.append(w)
    words = fixed
    if width(" ".join(words), font, draw) <= maxw:
        return " ".join(words)
    # most balanced split where both lines fit
    best, best_score = None, None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        if width(a, font, draw) <= maxw and width(b, font, draw) <= maxw:
            score = abs(width(a, font, draw) - width(b, font, draw))
            if best_score is None or score < best_score:
                best, best_score = (a, b), score
    if best:
        return "\n".join(best)
    # longer than two lines: greedy-wrap into as many lines as needed.
    # Never truncate — every word survives, each line fits maxw.
    lines, cur = [], []
    for w in words:
        if cur and width(" ".join(cur + [w]), font, draw) > maxw:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return "\n".join(lines)


def main():
    txtdir, fontsize, maxw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    font = ImageFont.truetype(FONT, fontsize)
    draw = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    for path in sorted(glob.glob(os.path.join(txtdir, "cap*.txt"))):
        if not re.fullmatch(r"cap\d+\.txt", os.path.basename(path)):
            continue  # per-line render files live here too — skip them
        text = open(path).read().strip().replace("\n", " ")
        wrapped = wrap(text, font, draw, maxw)
        for ln in wrapped.split("\n"):
            assert width(ln, font, draw) <= maxw + 0.5, f"{path}: {ln!r} overflows"
        open(path, "w").write(wrapped)
        print(f"{os.path.basename(path)}: {wrapped!r}")


main()
