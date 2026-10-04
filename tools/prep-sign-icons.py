#!/usr/bin/env python3
"""Turn the supplied 指示牌 photographs into the renderer's pictogram assets.

`game/src/render/signFace.ts` prints a board's marks from one bitmap per icon, so
each supplied photograph has to become a single asset with a known shape. This
script is that conversion, and the only thing that makes an asset:

  * **truly black and truly white.** Every pixel of a source is thresholded, so no
    anti-aliased grey survives: the ink is written as pure `#ffffff` (the board's
    own pale mark colour) and **everything else is fully transparent**. The dark
    ground of a photographed sign is not part of the mark — carrying it as a near
    black square would only put a second, dirtier panel on the lit board, whose
    own ground is already near-black.
  * **square**, and the same square for every mark. The ink is cropped to its own
    bounding box and fitted into a square canvas with one margin, so no pictogram
    arrives larger than its neighbour and the renderer can place them all in one
    box.
  * **without the source sign's own frame.** 列车, 电梯 and 扶梯 are photographed as
    complete signs with a rounded-square border. That border is the *sign's*
    frame, and `drawSignPanel` strokes the plate's own frame around the whole
    board, so the photograph's frame is found as the connected bright ring that
    spans the picture while filling almost none of it, and dropped before fitting.
    无障碍 and 卫生间 have no such border (the frame visible on those two is the mark's
    own rounded surround, part of the artwork). 楼梯's frame is *fused* into its
    staircase — the lowest tread runs into the border, and one connected blob holds
    both — so erasing it would take the tread with it; that source is used whole.
    This is why the frame test is measured rather than assumed per file: it drops
    exactly the three that have a border to drop.

Usage:
    python tools/prep-sign-icons.py             # write game/src/assets/pictograms
    python tools/prep-sign-icons.py --report    # measure the sources only
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = Path(__file__).resolve().parent / 'sign-icons-source'
OUT = ROOT / 'game' / 'src' / 'assets' / 'pictograms'

# The one ink colour: every kept pixel is this, and every other pixel is clear.
INK = 255
# The share of the square left empty, so a mark never touches the box the
# renderer hands it.
MARGIN = 0.06
# What separates ink from ground in a source. Otsu's threshold is measured per
# image, and a mark whose two peaks Otsu cannot separate falls back to this.
OTSU_FLOOR = 100

# The icons, in the order the board's palette lists them. Each entry names its
# source file and whether the source is a photograph of a complete sign (whose
# own rounded frame is found and dropped).
ICONS: dict[str, tuple[str, bool]] = {
    'train': ('train.png', True),
    'lift': ('lift.png', True),
    'accessible': ('accessible.png', False),
    'restroom': ('restroom.png', False),
    'escalator': ('escalator.png', True),
    'stairs': ('stairs.png', False),
}


def load_luma(path: Path) -> np.ndarray:
    """One source, as a float luma field 0…255."""
    return np.asarray(Image.open(path).convert('L'), dtype=np.float32)


def otsu(luma: np.ndarray) -> float:
    """The ink/ground split of a source, from its own histogram."""
    hist = np.bincount(luma.astype(np.uint8).ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    omega = np.cumsum(hist) / total
    mu = np.cumsum(hist * np.arange(256)) / total
    with np.errstate(divide='ignore', invalid='ignore'):
        sigma = np.where((omega > 0) & (omega < 1),
                         (mu[-1] * omega - mu) ** 2 / (omega * (1 - omega)), 0.0)
    return max(OTSU_FLOOR, float(np.argmax(sigma)))


def ink_mask(luma: np.ndarray) -> np.ndarray:
    """The mark's pixels: bright ink on the source's dark ground."""
    return luma > otsu(luma)


def blobs(mask: np.ndarray) -> list[np.ndarray]:
    """Bright connected components, largest first, as boolean masks."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out: list[np.ndarray] = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            comp = np.zeros_like(mask, dtype=bool)
            queue = deque([(y0, x0)])
            seen[y0, x0] = True
            while queue:
                y, x = queue.popleft()
                comp[y, x] = True
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            out.append(comp)
    out.sort(key=lambda c: -int(c.sum()))
    return out


def drop_source_frame(mask: np.ndarray, path: Path) -> np.ndarray:
    """Remove the photographed sign's own rounded border, if it has one.

    A photographed sign's border is a *ring*: one connected component that spans
    nearly the whole picture while filling very little of it. Both tests are
    needed, because the frame surrounds the mark without touching it — a mark
    either sits well inside the plate, or is wide and solid — and every component
    is asked, because the frame is not always the biggest thing in the picture.
    """
    h, w = mask.shape
    kept = mask.copy()
    for comp in blobs(mask):
        ys, xs = np.nonzero(comp)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        spans = bw >= 0.8 * w and bh >= 0.8 * h
        thin = comp.sum() / (bw * bh) < 0.3
        if spans and thin:
            print(f'    {path.name}: dropping the sign frame it was photographed with '
                  f'({bw}x{bh}, {comp.sum() / (bw * bh):.2f} filled)')
            kept &= ~comp
            break
    return kept


def fit_square(mask: np.ndarray, size: int) -> np.ndarray:
    """Crop a mask to its own bounds and fit it, centred, into a square canvas."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        raise ValueError('source has no ink')
    crop = mask[int(ys.min()):int(ys.max()) + 1, int(xs.min()):int(xs.max()) + 1]
    ch, cw = crop.shape
    inner = max(1, int(round(size * (1 - 2 * MARGIN))))
    scale = min(inner / cw, inner / ch)
    tw, th = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    # Nearest-neighbour: the mask has no grey to interpolate, and resampling it
    # would only put back the soft edge the thresholding just removed.
    scaled = Image.fromarray((crop * 255).astype(np.uint8), mode='L').resize(
        (tw, th), resample=Image.Resampling.NEAREST)
    canvas = np.zeros((size, size), dtype=bool)
    ox, oy = (size - tw) // 2, (size - th) // 2
    canvas[oy:oy + th, ox:ox + tw] = np.asarray(scaled, dtype=np.uint8) > 127
    return canvas


def write_icon(name: str, mask: np.ndarray, size: int) -> Path:
    """One icon as RGBA: pure white ink over a fully transparent ground."""
    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    rgba[..., 0:3] = INK
    rgba[..., 3] = np.where(mask, 255, 0).astype(np.uint8)
    out = OUT / f'{name}.png'
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode='RGBA').save(out, optimize=True)
    return out


def prepare(name: str, framed: bool, size: int) -> tuple[np.ndarray, dict]:
    path = RAW / f'{name}.png'
    luma = load_luma(path)
    mask = ink_mask(luma)
    stats = {'source': f'{luma.shape[1]}x{luma.shape[0]}', 'frame': False}
    if framed:
        stripped = drop_source_frame(mask, path)
        stats['frame'] = stripped.sum() != mask.sum()
        mask = stripped
    square = fit_square(mask, size)
    stats['ink'] = f'{square.mean() * 100:.1f}%'
    return square, stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--report', action='store_true', help='measure only; write no assets')
    ap.add_argument('--size', type=int, default=512, help='output edge in pixels (default 512)')
    args = ap.parse_args()

    for name, (file, framed) in ICONS.items():
        square, stats = prepare(name, framed, args.size)
        if args.report:
            print(f'{name:11s} {file:15s} {stats["source"]:>9s}  frame dropped={stats["frame"]!s:5s}  '
                  f'ink {stats["ink"]}')
            continue
        out = write_icon(name, square, args.size)
        print(f'{out.relative_to(ROOT)}  {args.size}x{args.size}  ink {stats["ink"]}  '
              f'frame dropped={stats["frame"]}')


if __name__ == '__main__':
    main()
