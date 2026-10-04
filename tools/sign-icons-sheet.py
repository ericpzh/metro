#!/usr/bin/env python3
"""A contact sheet of the generated pictograms on the board's own ground.

Renders each asset at the size the board prints a mark and beside it at a
thumbnail size, so the only two things that matter can be checked at a glance:
that the marks carry the same visual weight as each other, and that each one
still reads when it is small.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'game' / 'src' / 'assets' / 'pictograms'
OUT = ROOT / 'tools' / 'sign-icons-report' / 'contact-sheet.png'

# `render/signFace.ts`'s own colours: the lit board and its pale ink.
BOARD = (13, 17, 22)
INK = (244, 247, 250)

NAMES = ['train', 'lift', 'accessible', 'restroom', 'escalator', 'stairs']


def recolour(path: Path, size: int) -> Image.Image:
    """One asset at `size`, drawn in the board's ink over the board's ground."""
    img = Image.open(path).convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)
    ground = Image.new('RGBA', (size, size), BOARD + (255,))
    ink = Image.new('RGBA', (size, size), INK + (255,))
    ink.putalpha(img.getchannel('A'))
    return Image.alpha_composite(ground, ink)


def main() -> None:
    big, small, pad = 120, 34, 10
    w = pad + len(NAMES) * (big + pad)
    h = pad + big + pad + small + pad + 18
    sheet = Image.new('RGB', (w, h), BOARD)
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(NAMES):
        x = pad + i * (big + pad)
        sheet.paste(recolour(ASSETS / f'{name}.png', big), (x, pad))
        sheet.paste(recolour(ASSETS / f'{name}.png', small), (x + (big - small) // 2, pad + big + pad))
        d.text((x, pad + big + pad + small + 4), name, fill=INK)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(OUT)


if __name__ == '__main__':
    main()
