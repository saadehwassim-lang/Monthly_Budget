#!/usr/bin/env python3
"""Rasterise app/icon.svg into the PNGs a home-screen install actually uses.

iOS ignores an SVG apple-touch-icon and falls back to a screenshot of the page,
and a maskable icon has to bleed to the edges or Android crops the artwork. The
icon is four rounded rectangles and a dot, so rather than carry an image
toolchain for it we draw those shapes directly, 4x supersampled.

    python3 tools/make-icons.py

Rerun after editing app/icon.svg and commit the PNGs alongside it.
"""
import struct, zlib, os

VIEW = 192.0                      # the SVG viewBox, so shapes stay in its units
BLUE = (0x2a, 0x78, 0xd6)
ORANGE = (0xeb, 0x68, 0x34)
WHITE = (0xff, 0xff, 0xff)

# x, y, w, h, radius, colour, alpha — straight from icon.svg
BARS = [
    (42, 104, 21, 46, 6, WHITE, 0.65),
    (76,  78, 21, 72, 6, WHITE, 0.82),
    (110, 52, 21, 98, 6, WHITE, 1.0),
]
DOT = (139, 46, 12, ORANGE, 1.0)  # cx, cy, r, colour, alpha


def rrect_inside(px, py, x, y, w, h, r):
    if px < x or py < y or px > x + w or py > y + h:
        return False
    r = min(r, w / 2, h / 2)
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= r * r


def circle_inside(px, py, cx, cy, r):
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= r * r


def render(size, corner_radius, inset):
    """corner_radius in viewBox units (0 = square, for iOS which masks its own).
    inset shrinks the artwork towards the centre, leaving the maskable safe zone."""
    ss = 4                                    # supersampling factor per axis
    scale = VIEW / size
    step = scale / ss
    pix = bytearray(size * size * 4)
    k = (VIEW - 2 * inset) / VIEW             # artwork scale for the safe zone

    def place(v):
        return inset + v * k

    bars = [(place(x), place(y), w * k, h * k, r * k, c, a)
            for (x, y, w, h, r, c, a) in BARS]
    dcx, dcy, dr, dcol, da = DOT
    dot = (place(dcx), place(dcy), dr * k, dcol, da)

    for py in range(size):
        row = py * size * 4
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]        # premultiplied r, g, b, a
            for sy in range(ss):
                vy = (py * ss + sy + 0.5) * step
                for sx in range(ss):
                    vx = (px * ss + sx + 0.5) * step
                    r_, g_, b_, a_ = 0.0, 0.0, 0.0, 0.0
                    if rrect_inside(vx, vy, 0, 0, VIEW, VIEW, corner_radius):
                        r_, g_, b_ = BLUE
                        a_ = 1.0
                    for (x, y, w, h, rr, col, al) in bars:
                        if rrect_inside(vx, vy, x, y, w, h, rr):
                            r_ = col[0] * al + r_ * (1 - al)
                            g_ = col[1] * al + g_ * (1 - al)
                            b_ = col[2] * al + b_ * (1 - al)
                            a_ = al + a_ * (1 - al)
                    if circle_inside(vx, vy, dot[0], dot[1], dot[2]):
                        r_, g_, b_ = dot[3]
                        a_ = 1.0
                    acc[0] += r_ * a_
                    acc[1] += g_ * a_
                    acc[2] += b_ * a_
                    acc[3] += a_
            n = ss * ss
            a = acc[3] / n
            o = row + px * 4
            if a <= 0:
                continue
            pix[o]     = min(255, int(acc[0] / n / a + 0.5))
            pix[o + 1] = min(255, int(acc[1] / n / a + 0.5))
            pix[o + 2] = min(255, int(acc[2] / n / a + 0.5))
            pix[o + 3] = min(255, int(a * 255 + 0.5))
    return bytes(pix)


def write_png(path, size, rgba):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)                          # filter type 0 (None)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "app")
    jobs = [
        # name,                   size, corner radius, inset (safe zone)
        ("icon-180.png",           180, 0,  0),   # iOS masks its own corners
        ("icon-192.png",           192, 44, 0),
        ("icon-512.png",           512, 44, 0),
        ("icon-maskable-512.png",  512, 0,  24),  # bleeds to the edge, art inset
    ]
    for name, size, radius, inset in jobs:
        n = write_png(os.path.join(out, name), size, render(size, radius, inset))
        print(f"{name:24} {size}x{size}  {n:>6} bytes")


if __name__ == "__main__":
    main()
