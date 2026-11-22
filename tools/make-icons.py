"""Generates the PWA icon set (PNG + SVG). Run: python3 tools/make-icons.py  (needs Pillow)."""
from PIL import Image, ImageDraw
import os

BG = (245, 158, 11, 255)      # #F59E0B (theme color)
FG = (255, 255, 255, 255)
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')

def book(d, s, scale):
    """Draws an open book centred in an s×s canvas; `scale` shrinks it (maskable safe zone)."""
    cx, cy = s / 2, s / 2
    w, h = s * 0.56 * scale, s * 0.40 * scale
    top, bot = cy - h / 2, cy + h / 2
    left, right = cx - w / 2, cx + w / 2
    lw = max(2, int(s * 0.035 * scale))
    # two pages (slightly curved top edge through polygon points)
    for sign in (-1, 1):
        x0 = cx
        x1 = cx + sign * w / 2
        pts = [(x0, top + h * 0.10), (cx + sign * w * 0.25, top), (x1, top + h * 0.06),
               (x1, bot - h * 0.06), (cx + sign * w * 0.25, bot - h * 0.12), (x0, bot)]
        d.polygon(pts, fill=FG)
    # spine line in background colour
    d.line([(cx, top + h * 0.10), (cx, bot)], fill=BG, width=lw)
    # text lines on both pages
    for sign in (-1, 1):
        for i in range(3):
            y = top + h * (0.30 + 0.20 * i)
            xa = cx + sign * w * 0.07
            xb = cx + sign * w * 0.40
            d.line([(xa, y), (xb, y)], fill=BG, width=max(1, lw // 2))

def render(size, maskable=False, rounded=True):
    SS = 4
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)            # full-bleed: the OS applies its own mask
        book(d, s, 0.72)                              # glyph stays inside the 80% safe zone
    else:
        r = int(s * 0.22) if rounded else 0
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=BG)
        book(d, s, 1.0)
    return img.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
render(192).save(os.path.join(OUT, 'icon-192.png'))
render(512).save(os.path.join(OUT, 'icon-512.png'))
render(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
render(180, maskable=True).save(os.path.join(OUT, 'apple-touch-icon.png'))   # iOS rounds the corners itself
render(32).save(os.path.join(OUT, 'favicon-32x32.png'))

svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#F59E0B"/>
<g fill="#fff"><path d="M256 215 C225 195 175 190 143 200 L143 322 C175 312 225 317 256 337 Z"/>
<path d="M256 215 C287 195 337 190 369 200 L369 322 C337 312 287 317 256 337 Z"/></g>
<g stroke="#F59E0B" stroke-width="9" stroke-linecap="round" fill="none">
<path d="M256 215 L256 337"/>
<path d="M172 232 L232 238 M172 262 L232 268 M172 292 L232 298 M340 232 L280 238 M340 262 L280 268 M340 292 L280 298" stroke-width="7"/></g>
</svg>'''
open(os.path.join(OUT, 'icon.svg'), 'w').write(svg)
print('icons written to', os.path.abspath(OUT))
