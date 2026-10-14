#!/usr/bin/env python3
"""Draw the extension icons (no external assets needed)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
SIZE = 512
BG_TOP = (16, 122, 95)
BG_BOT = (7, 74, 60)
WHITE = (255, 255, 255)
ACC = (255, 214, 102)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def rounded(size, radius, color):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=color)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    s = SIZE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # vertical gradient
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        gd.line([(0, y), (s, y)], fill=lerp(BG_TOP, BG_BOT, y / max(1, s - 1)) + (255,))
    mask = rounded(s, int(s * 0.22), (255, 255, 255, 255)).split()[3]
    img = Image.composite(grad, img, mask)
    d = ImageDraw.Draw(img)

    cx, cy = s / 2, s / 2
    # railway line
    y_line = cy + s * 0.06
    d.rounded_rectangle([s * 0.12, y_line - s * 0.022, s * 0.88, y_line + s * 0.022],
                        radius=int(s * 0.022), fill=WHITE)
    # sleepers
    for i in range(6):
        x = s * (0.17 + i * 0.132)
        d.rectangle([x - s * 0.008, y_line + s * 0.03, x + s * 0.008, y_line + s * 0.062], fill=(255, 255, 255, 170))

    # three stations: the middle one is "you", the outer two are the alternatives
    for x, r, col in ((s * 0.22, 0.052, WHITE), (s * 0.5, 0.072, ACC), (s * 0.78, 0.052, WHITE)):
        d.ellipse([x - s * r, y_line - s * r, x + s * r, y_line + s * r], fill=col)
        d.ellipse([x - s * r * 0.42, y_line - s * r * 0.42, x + s * r * 0.42, y_line + s * r * 0.42],
                  fill=BG_BOT if col == ACC else (12, 96, 76))

    # up / down arrows over the middle station = "before / after"
    aw, ah = s * 0.052, s * 0.062
    for sign, base_y in ((-1, y_line - s * 0.10), (1, y_line + s * 0.145)):
        tip_y = base_y + sign * ah
        d.polygon([(cx, tip_y), (cx - aw, base_y), (cx + aw, base_y)], fill=ACC)

    for size in (16, 32, 48, 128):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, "icon%d.png" % size))
        print("icon%d.png" % size)


if __name__ == "__main__":
    main()
