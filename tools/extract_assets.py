#!/usr/bin/env python3
"""
Extract game textures & sprites directly from the reference sheet
(design/reference/assets.jpg + menu.jpg).

  * Cable jackets  -> seamless tube textures (u = along the cable, v = around)
  * Slice sparks / laser blade / warning sign -> alpha-keyed additive sprites
  * CRT monitor + operator avatar -> UI images

Usage:  python3 tools/extract_assets.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "design" / "reference"
OUT = ROOT / "assets" / "textures"
OUT.mkdir(parents=True, exist_ok=True)

sheet = Image.open(REF / "assets.jpg").convert("RGB")
menu = Image.open(REF / "menu.jpg").convert("RGB")


def arr(im):
    return np.asarray(im).astype(np.float32) / 255.0


def img(a, mode="RGB"):
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), mode)


# --------------------------------------------------------------------------
# 1) Cable jacket textures
# --------------------------------------------------------------------------
def cable_texture(box, name, out_w=512, out_h=64, fade=0.18, boost=1.0, clean_ends=None):
    """Crop a side view of a cable, make it tile along its length (cross-fade
    the ends) and wrap around its circumference (vertical mirror)."""
    strip = sheet.crop(box)
    strip = strip.resize((out_w, out_h), Image.LANCZOS)
    a = arr(strip) * boost

    # Seamless along U: cross-fade the right end into the left end
    n = int(out_w * fade)
    w = np.linspace(0, 1, n)[None, :, None]
    left = a[:, :n].copy()
    right = a[:, -n:]
    a[:, :n] = left * w + right * (1 - w)
    a = a[:, : out_w - n]
    a = np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((out_w, out_h), Image.LANCZOS)).astype(np.float32) / 255

    # Around V: top half = strip, bottom half = mirrored strip -> seamless wrap
    wrapped = np.concatenate([a, a[::-1]], axis=0)
    img(wrapped).save(OUT / f"{name}.png")
    print("  cable", name, wrapped.shape)


print("Cable textures")
cable_texture((122, 81, 280, 100), "cable_cat6")
cable_texture((440, 80, 588, 100), "cable_fiber", fade=0.25)
cable_texture((765, 83, 922, 96), "cable_terminal")
cable_texture((44, 200, 262, 226), "cable_hv", out_w=768, fade=0.12)


# --------------------------------------------------------------------------
# 2) Alpha keyed sprites (dark sheet background removed)
# --------------------------------------------------------------------------
def keyed(src, box, name, gamma=1.0, gain=1.6, soft=True, scale=2, radial=False):
    crop = src.crop(box)
    crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
    a = arr(crop)
    # estimate background from crop border
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    diff = np.clip(a - bg[None, None], 0, 1)
    lum = diff.max(axis=2)
    alpha = np.clip(lum * gain, 0, 1) ** gamma
    # vignette-mask the rectangle edges so nothing hard shows up
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]).astype(np.float32)
    alpha *= np.clip(edge / 6.0, 0, 1)
    if radial:  # burst sprites: fade out towards an ellipse so no box edge shows
        r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
        alpha *= np.clip((1.0 - r) / 0.35, 0, 1)
    rgb = np.where(alpha[..., None] > 1e-3, np.clip(diff / np.maximum(alpha[..., None], 1e-3), 0, 1), 0)
    rgba = np.dstack([rgb, alpha])
    im = img(rgba, "RGBA")
    if soft:
        im = im.filter(ImageFilter.SMOOTH)
    im.save(OUT / f"{name}.png")
    print("  sprite", name, im.size)


def remove_hline(im, x0, x1, y0, y1):
    """Inpaint a thin horizontal separator line (panel rule on the sheet)
    by interpolating between the rows just above and below it."""
    a = np.asarray(im).astype(np.float32).copy()
    top, bot = a[y0 - 1, x0:x1], a[y1 + 1, x0:x1]
    for i, y in enumerate(range(y0, y1 + 1)):
        t = (i + 1) / (y1 - y0 + 2)
        a[y, x0:x1] = top * (1 - t) + bot * t
    return Image.fromarray(a.astype(np.uint8))


print("Sprites")
fx_sheet = remove_hline(sheet, 560, 1000, 182, 186)
fx_sheet = remove_hline(fx_sheet, 30, 530, 309, 312)
keyed(fx_sheet, (828, 147, 978, 238), "fx_sparks_a", radial=True)
keyed(fx_sheet, (366, 284, 502, 372), "fx_sparks_b", radial=True)
keyed(sheet, (46, 316, 358, 374), "fx_laser_blade", gain=1.4)
keyed(sheet, (580, 192, 822, 238), "fx_laser_blade_b", gain=1.4)
keyed(sheet, (488, 188, 542, 244), "icon_warning", gain=2.0)
keyed(sheet, (806, 316, 856, 372), "icon_gear", gain=1.5)
keyed(sheet, (878, 316, 952, 372), "icon_wrench", gain=1.5)


# --------------------------------------------------------------------------
# 3) Plain UI images
# --------------------------------------------------------------------------
print("UI images")
crt = sheet.crop((846, 416, 982, 540)).resize((272, 248), Image.LANCZOS)
crt.save(OUT / "ui_crt.png")
avatar = menu.crop((801, 27, 847, 73)).resize((138, 138), Image.LANCZOS)
avatar.save(OUT / "ui_avatar.png")
print("done ->", OUT)
