"""Trace the supplied Nanjing plum blossom emblem without rewriting its source bitmap.
Usage: python tools/trace-nanjing-branding.py <P4.png>
Requires Pillow. Contours include the white counters via even-odd fill.
"""
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from PIL import Image

def simplify(points, epsilon=2.0):
    if len(points)<3:return points
    a,b=points[0],points[-1];dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
    distances=[]
    for x,y in points[1:-1]:
        t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/den)) if den else 0
        distances.append((x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2)
    index=max(range(len(distances)),key=distances.__getitem__)+1
    if distances[index-1]<=epsilon*epsilon:return [a,b]
    return simplify(points[:index+1],epsilon)[:-1]+simplify(points[index:],epsilon)

source=Path(sys.argv[1]);im=Image.open(source).convert('RGB')
mask={(x,y) for y in range(im.height) for x in range(im.width)
      if (lambda r,g,b:r>g+50 and r>b+50)(*im.getpixel((x,y)))}
edges=defaultdict(list)
for x,y in sorted(mask):
    for n,a,b in [((x,y-1),(x,y),(x+1,y)),((x+1,y),(x+1,y),(x+1,y+1)),((x,y+1),(x+1,y+1),(x,y+1)),((x-1,y),(x,y+1),(x,y))]:
        if n not in mask:edges[a].append(b)
paths=[]
while edges:
    start=min(edges);p=start;path=[p]
    while True:
        q=edges[p].pop()
        if not edges[p]:del edges[p]
        path.append(q);p=q
        if p==start:break
    area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(path,path[1:])))/2
    if area>=10:paths.append(simplify(path))
x0=min(x for x,y in mask);y0=min(y for x,y in mask)
w=max(x for x,y in mask)-x0+1;h=max(y for x,y in mask)-y0+1
target=Path('game/src/assets/branding/nanjing-contours.json')
target.write_text(json.dumps({'aspect':w/h,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
    'paths':[[[round((x-x0)/w,5),round((y-y0)/h,5)] for x,y in path] for path in paths]},separators=(',',':'))+'\n',encoding='utf-8')
print(f'{target}: {len(paths)} contours, {w} x {h}')
