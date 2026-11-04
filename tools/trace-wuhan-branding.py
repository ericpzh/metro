"""Reconstruct the straight edges of the supplied P1 Wuhan mark.
Usage: python tools/trace-wuhan-branding.py <P1.png>
The tiny reference has JPEG ringing and blue-tinted white gaps. These measured
edge intersections regularize its M and three lower bars instead of tracing
compression speckles or closing the two horizontal white separators.
"""
import hashlib
import json
import sys
from pathlib import Path

source=Path(sys.argv[1])
# Coordinates in the supplied 157 x 147 image. White gaps are geometry, not paint.
paths=[
 [(15,10),(52,10),(81,83),(110,10),(147,10),(147,104),(123,104),(123,47),(96,104),(66,104),(39,47),(39,104),(15,104)],
 [(15,108),(39,108),(39,120),(69,108),(94,108),(123,120),(123,108),(147,108),(147,124),(119,124),(81,112),(43,124),(15,124)],
 [(15,128),(50,128),(50,139),(15,139)],
 [(63,128),(98,128),(98,139),(63,139)],
 [(111,128),(147,128),(147,139),(111,139)],
]
target=Path('game/src/assets/branding/wuhan-contours.json')
target.write_text(json.dumps({'aspect':132/129,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'paths':[[[round((x-15)/132,6),round((y-10)/129,6)] for x,y in path] for path in paths]},separators=(',',':'))+'\n',encoding='utf-8')
print(f'{target}: {len(paths)} straight-edge contours, 132 x 129')
