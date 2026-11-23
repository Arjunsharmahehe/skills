#!/usr/bin/env python3
"""Query a uiautomator hierarchy dump. Prints 'x y' center or FAIL."""
import re
import sys
import xml.etree.ElementTree as ET


def center(b):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b or "")
    if not m:
        return None
    x1, y1, x2, y2 = map(int, m.groups())
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def main():
    path, mode, query = sys.argv[1], sys.argv[2], sys.argv[3]
    root = ET.parse(path).getroot()
    nodes = list(root.iter("node"))

    if mode == "--text":
        for n in nodes:
            if (n.get("text") or "") == query:
                c = center(n.get("bounds"))
                if c:
                    print(f"{c[0]} {c[1]}")
                    return
    elif mode == "--checkbox-for":
        # row = smallest clickable View/ancestor containing a node with the text
        target = None
        for n in nodes:
            if query in (n.get("text") or ""):
                target = n
                break
        if target is None:
            print("FAIL: text not found")
            sys.exit(1)
        # find checkbox with closest y to the title node
        tc = center(target.get("bounds"))
        best, best_dy = None, 1e9
        for n in nodes:
            if (n.get("class") or "").endswith("CheckBox"):
                c = center(n.get("bounds"))
                dy = abs(c[1] - tc[1])
                if dy < best_dy:
                    best, best_dy = c, dy
        if best and best_dy < 200:
            print(f"{best[0]} {best[1]}")
            return
    elif mode == "--has-text":
        for n in nodes:
            if query in (n.get("text") or ""):
                print("YES")
                return
        print("NO")
        return
    print("FAIL: not found")
    sys.exit(1)


main()
