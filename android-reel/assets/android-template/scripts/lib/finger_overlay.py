#!/usr/bin/env python3
"""Render the amber finger overlay as a transparent video.

Input : events.json — { "width":1080, "height":2400, "duration": <s>,
                         "taps": [ {t,x,y} ... ] }
Output: finger.mov — qtrle RGBA, 360x800 @30fps, same duration.
The dot glides (easeInOutCubic) between taps, holds through each tap,
and emits an expanding ripple ring on every tap. Matches the web
demo-reel amber (#f59e0b) cursor language.
"""
import json
import math
import subprocess
import sys

from PIL import Image, ImageDraw

SW, SH = 360, 800          # overlay canvas (scaled up 2x in composite)
FPS = 30
AMBER = (245, 158, 11)
GLIDE = 0.55               # seconds of glide before each tap
RIPPLE_T = 0.45            # expanding-ring duration on contact
PRESS_T = 0.3              # finger-down window after each tap


def is_pressed(t, taps):
    return any(0 <= t - tap["t"] <= PRESS_T for tap in taps)


def ease_in_out_cubic(u):
    u = min(1.0, max(0.0, u))
    if u < 0.5:
        return 4 * u * u * u
    return 1 - ((-2 * u + 2) ** 3) / 2


def load_events(path):
    with open(path) as f:
        return json.load(f)


def finger_pos_at(t, taps):
    """Position (full-res coords) of the finger dot at time t."""
    if not taps:
        return None
    if t <= taps[0]["t"]:
        return (taps[0]["x"], taps[0]["y"])
    for i in range(1, len(taps)):
        prev, cur = taps[i - 1], taps[i]
        g0 = cur["t"] - GLIDE
        if t < g0:
            return (prev["x"], prev["y"])
        if t <= cur["t"]:
            u = ease_in_out_cubic((t - g0) / GLIDE)
            return (
                prev["x"] + (cur["x"] - prev["x"]) * u,
                prev["y"] + (cur["y"] - prev["y"]) * u,
            )
    return (taps[-1]["x"], taps[-1]["y"])


def draw_dot(base, cx, cy, alpha, pressed=False):
    """Flat amber ring like the web demo-reel cursor. Press state is shown
    purely by opacity: idle = dim ring, finger-down = bright ring. No glow."""
    s = base.width / SW  # supersample factor
    x, y = cx * s, cy * s
    d = ImageDraw.Draw(base, "RGBA")
    r = 11 * s / 2
    fill_a = 150 if pressed else 40
    edge_a = 255 if pressed else 200
    d.ellipse([x - r, y - r, x + r, y + r],
              fill=(*AMBER, int(fill_a * alpha)))
    d.ellipse([x - r, y - r, x + r, y + r],
              outline=(*AMBER, int(edge_a * alpha)), width=max(2, int(2 * s)))


def draw_ripple(base, cx, cy, age):
    """Expanding fading ring. age in [0, RIPPLE_T]."""
    u = age / RIPPLE_T
    s = base.width / SW
    x, y = cx * s, cy * s
    r = (12 + (44 - 12) * (1 - (1 - u) ** 3)) * s / 2
    a = int(230 * (1 - u))
    w = max(2, int(4 * s / 2 * (1 - u * 0.5)))
    ImageDraw.Draw(base, "RGBA").ellipse(
        [x - r, y - r, x + r, y + r], outline=(*AMBER, a), width=w)


def main(events_path, out_path):
    ev = load_events(events_path)
    taps = sorted(ev["taps"], key=lambda e: e["t"])
    dur = float(ev["duration"])
    n = int(math.ceil(dur * FPS))
    sx, sy = SW / ev["width"], SH / ev["height"]  # full-res -> canvas

    cmd = ["ffmpeg", "-y", "-v", "error",
           "-f", "rawvideo", "-pix_fmt", "rgba",
           "-s", f"{SW*2}x{SH*2}", "-r", str(FPS), "-i", "-",
           "-c:v", "qtrle", "-r", str(FPS), out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        t = i / FPS
        img = Image.new("RGBA", (SW * 2, SH * 2), (0, 0, 0, 0))
        pos = finger_pos_at(t, taps)
        if pos is not None:
            cx, cy = pos[0] * sx, pos[1] * sy
            # fade in on first 0.4s, fade out on last 0.5s
            alpha = 1.0
            if taps and t < taps[0]["t"]:
                alpha = min(1.0, max(0.0, (t - (taps[0]["t"] - 0.6)) / 0.4))
            if t > dur - 0.5:
                alpha = min(alpha, max(0.0, (dur - t) / 0.5))
            for tap in taps:
                age = t - tap["t"]
                if 0 <= age <= RIPPLE_T:
                    draw_ripple(img, tap["x"] * sx, tap["y"] * sy, age)
            if alpha > 0:
                draw_dot(img, cx, cy, alpha, pressed=is_pressed(t, taps))
        proc.stdin.write(img.tobytes())
    proc.stdin.close()
    rc = proc.wait()
    if rc != 0:
        sys.exit(f"ffmpeg overlay render failed ({rc})")
    print(f"wrote {out_path} ({n} frames, {dur:.1f}s)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
