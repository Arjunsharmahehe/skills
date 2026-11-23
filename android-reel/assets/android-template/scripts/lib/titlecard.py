#!/usr/bin/env python3
"""720x1600 minimal title card. Usage: titlecard.py <out> <flow name>.
Just the flow name, centered on near-black — nothing else."""
import sys
from PIL import Image, ImageDraw, ImageFont

out, title = sys.argv[1], sys.argv[2]
W, H = 720, 1600
img = Image.new("RGB", (W, H), (16, 16, 20))
d = ImageDraw.Draw(img)


def fit_font(lines, start=44, maxw=620):
    size = start
    while size > 20:
        f = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", size)
        if all(d.textbbox((0, 0), ln, font=f)[2] <= maxw for ln in lines):
            return f
        size -= 2
    return ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", 20)


lines = [ln.strip() for ln in title.split("|")]
f_big = fit_font(lines)


def centered(y, text, font, fill):
    bb = d.textbbox((0, 0), text, font=font)
    d.text(((W - (bb[2] - bb[0])) / 2, y), text, font=font, fill=fill)


y = H / 2 - (len(lines) * f_big.size * 0.8)
for i, ln in enumerate(lines):
    centered(y + i * f_big.size * 1.6, ln, f_big, (235, 235, 240))
img.save(out)
print(f"wrote {out}")
