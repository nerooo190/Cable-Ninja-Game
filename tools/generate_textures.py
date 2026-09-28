#!/usr/bin/env python3
"""
Procedural texture painter for the server room environment.

    rack_front.png     19" rack face: servers, switches, patch panels, vents
    rack_emissive.png  LED / port-light mask for the same face (animated in-shader)
    floor_grid.png     raised data-centre floor tile with perforations
    cable_coax.png     silver braided coax jacket (menu OPTIONS cable)

Usage:  python3 tools/generate_textures.py
"""
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "textures"
OUT.mkdir(parents=True, exist_ok=True)

rnd = random.Random(1337)

W, H = 512, 1536
U = 32  # pixels per rack unit (1U)
MARGIN = 34

LED_COLORS = [(40, 255, 110), (40, 255, 110), (40, 255, 110), (255, 50, 70), (80, 170, 255), (255, 190, 40)]


def rack():
    base = Image.new("RGB", (W, H), (12, 14, 30))
    emis = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(base)
    e = ImageDraw.Draw(emis)

    # rails with mounting holes
    for x0 in (0, W - MARGIN):
        d.rectangle([x0, 0, x0 + MARGIN - 1, H], fill=(24, 26, 48))
        d.line([x0 + (MARGIN - 2 if x0 == 0 else 1), 0, x0 + (MARGIN - 2 if x0 == 0 else 1), H], fill=(70, 60, 140), width=2)
        for y in range(8, H, U // 3):
            d.rectangle([x0 + 12, y, x0 + 20, y + 5], fill=(6, 6, 14))

    y = 6
    while y < H - U:
        kind = rnd.choices(["server1", "server2", "switch", "patch", "blank", "storage"], [3, 3, 3, 2, 1, 2])[0]
        units = {"server1": 1, "server2": 2, "switch": 1, "patch": 1, "blank": 1, "storage": 3}[kind]
        h = units * U - 3
        if y + h > H - 4:
            break
        x0, x1 = MARGIN + 3, W - MARGIN - 3
        shade = rnd.randint(22, 34)
        d.rectangle([x0, y, x1, y + h], fill=(shade, shade + 2, shade + 22), outline=(58, 54, 110))
        d.line([x0 + 1, y + 1, x1 - 1, y + 1], fill=(90, 86, 160))
        if kind in ("server1", "server2"):
            # vent slots
            for vx in range(x0 + 12, x0 + 170, 7):
                d.rectangle([vx, y + 6, vx + 3, y + h - 6], fill=(8, 8, 18))
            # drive bays
            bays = rnd.randint(4, 8)
            for b in range(bays):
                bx = x0 + 190 + b * 28
                if bx + 24 > x1 - 50:
                    break
                d.rectangle([bx, y + 5, bx + 24, y + h - 5], fill=(18, 20, 40), outline=(70, 70, 120))
                led = rnd.choice(LED_COLORS)
                e.rectangle([bx + 18, y + 8, bx + 21, y + 11], fill=led)
                d.rectangle([bx + 18, y + 8, bx + 21, y + 11], fill=tuple(c // 3 for c in led))
            # power + status LEDs
            for k in range(3):
                led = rnd.choice(LED_COLORS)
                cx = x1 - 36 + k * 10
                e.ellipse([cx, y + 8, cx + 5, y + 13], fill=led)
                d.ellipse([cx, y + 8, cx + 5, y + 13], fill=tuple(c // 3 for c in led))
        elif kind == "switch":
            # 24 RJ45 ports in two rows with link LEDs
            for r in range(2):
                for p in range(20):
                    px = x0 + 14 + p * 20
                    py = y + 4 + r * 13
                    if px + 14 > x1 - 10:
                        break
                    d.rectangle([px, py, px + 12, py + 9], fill=(4, 4, 10), outline=(80, 80, 110))
                    if rnd.random() < 0.8:
                        led = (40, 255, 110) if rnd.random() < 0.8 else (255, 190, 40)
                        e.rectangle([px + 1, py, px + 3, py + 1], fill=led)
                        e.rectangle([px + 9, py, px + 11, py + 1], fill=(40, 255, 110))
        elif kind == "patch":
            for p in range(24):
                px = x0 + 12 + p * 18
                if px + 12 > x1 - 8:
                    break
                d.rectangle([px, y + 9, px + 11, y + 20], fill=(4, 4, 10), outline=(95, 95, 130))
                # plugged coloured patch cable stubs
                if rnd.random() < 0.55:
                    col = rnd.choice([(40, 120, 255), (255, 200, 40), (60, 220, 90), (255, 60, 70)])
                    d.rectangle([px + 2, y + 11, px + 9, y + 19], fill=col)
        elif kind == "storage":
            for r in range(3):
                for b in range(12):
                    bx = x0 + 10 + b * 36
                    by = y + 4 + r * (U - 1)
                    if bx + 32 > x1 - 6:
                        break
                    d.rectangle([bx, by, bx + 32, by + U - 8], fill=(20, 22, 44), outline=(64, 64, 110))
                    led = rnd.choice(LED_COLORS)
                    e.rectangle([bx + 26, by + 3, bx + 29, by + 6], fill=led)
        else:  # blank panel with vent holes
            for vx in range(x0 + 10, x1 - 10, 9):
                d.ellipse([vx, y + 11, vx + 4, y + 15], fill=(8, 8, 18))
        # handle ears
        d.rectangle([x0 + 2, y + 4, x0 + 6, y + h - 4], fill=(80, 80, 120))
        d.rectangle([x1 - 6, y + 4, x1 - 2, y + h - 4], fill=(80, 80, 120))
        y += h + 3

    # soft blue/purple rim light gradient
    grad = Image.new("RGB", (W, H))
    gd = ImageDraw.Draw(grad)
    for x in range(W):
        t = x / W
        gd.line([x, 0, x, H], fill=(int(25 * t), int(10 + 10 * (1 - t)), int(40 + 30 * t)))
    base = Image.blend(base, grad, 0.18)
    emis = emis.filter(ImageFilter.GaussianBlur(0.6))
    base.save(OUT / "rack_front.png")
    emis.save(OUT / "rack_emissive.png")
    print("  rack_front.png / rack_emissive.png", base.size)


def floor():
    S = 256
    im = Image.new("RGB", (S, S), (10, 10, 24))
    d = ImageDraw.Draw(im)
    d.rectangle([2, 2, S - 3, S - 3], outline=(70, 50, 150), width=3)
    for yy in range(24, S - 20, 16):
        for xx in range(24, S - 20, 16):
            d.ellipse([xx, yy, xx + 6, yy + 6], fill=(4, 4, 12))
    im.save(OUT / "floor_grid.png")
    print("  floor_grid.png", im.size)


def coax():
    w, h = 256, 64
    im = Image.new("RGB", (w, h), (70, 74, 84))
    d = ImageDraw.Draw(im)
    step = 8
    for i in range(-h, w + h, step):
        d.line([i, 0, i + h, h], fill=(150, 156, 170), width=3)
        d.line([i + h, 0, i, h], fill=(110, 114, 128), width=2)
    for y in range(h):
        k = 0.55 + 0.45 * (1 - abs(y - h / 2) / (h / 2))
        for x in range(w):
            r, g, b = im.getpixel((x, y))
            im.putpixel((x, y), (int(r * k), int(g * k), int(b * k)))
    im.save(OUT / "cable_coax.png")
    print("  cable_coax.png", im.size)


if __name__ == "__main__":
    print("Painting textures ->", OUT)
    rack()
    floor()
    coax()
