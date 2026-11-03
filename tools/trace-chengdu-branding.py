"""Trace supplied P1 and P6 into vector contours; requires Pillow.
Usage: python tools/trace-chengdu-branding.py <P1.png> <P6.png>
No bitmap is rewritten. Even-odd contours retain original lettering counters.
"""
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from PIL import Image

COLOURS = [(0, 104, 178), (22, 133, 200), (124, 189, 230), (40, 26, 22)]

def simplify(points, epsilon=.45):
    if len(points) < 3:return points
    a,b=points[0],points[-1];dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
    distances=[]
    for x,y in points[1:-1]:
        t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/den)) if den else 0
        distances.append((x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2)
    index=max(range(len(distances)),key=distances.__getitem__)+1
    if distances[index-1]<=epsilon*epsilon:return [a,b]
    return simplify(points[:index+1],epsilon)[:-1]+simplify(points[index:],epsilon)

def contours(mask):
    edges=defaultdict(list)
    for x,y in sorted(mask):
        for neighbor,a,b in [((x,y-1),(x,y),(x+1,y)),((x+1,y),(x+1,y),(x+1,y+1)),((x,y+1),(x+1,y+1),(x,y+1)),((x-1,y),(x,y+1),(x,y))]:
            if neighbor not in mask:edges[a].append(b)
    paths=[]
    while edges:
        start=min(edges);p=start;path=[p]
        while True:
            q=edges[p].pop()
            if not edges[p]:del edges[p]
            path.append(q);p=q
            if p==start:break
        area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(path,path[1:])))/2
        if area>=2:paths.append(simplify(path))
    return paths

def trace(file,white):
    im=Image.open(file).convert('RGBA');masks=[set() for _ in COLOURS]
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a=im.getpixel((x,y))
            if a<128 or (white and min(r,g,b)>210):continue
            if b>r+30:colour=min(range(3),key=lambda i:sum((v-c)**2 for v,c in zip((r,g,b),COLOURS[i])))
            elif max(r,g,b)<180:colour=3
            else:continue
            masks[colour].add((x,y))
    allpoints=set.union(*masks);x0=min(x for x,y in allpoints);y0=min(y for x,y in allpoints)
    width=max(x for x,y in allpoints)-x0+1;height=max(y for x,y in allpoints)-y0+1
    return {'aspect':width/height,'sha256':hashlib.sha256(Path(file).read_bytes()).hexdigest(),
            'layers':[{'colour':'#%02x%02x%02x'%colour,'paths':[[[round((x-x0)/width,5),round((y-y0)/height,5)] for x,y in path] for path in contours(mask)]} for colour,mask in zip(COLOURS,masks)]}

target=Path('game/src/assets/branding/chengdu-contours.json')
target.write_text(json.dumps({'trainUi':trace(sys.argv[1],False),'exit':trace(sys.argv[2],True)},separators=(',',':'))+'\n',encoding='utf-8')
print(f'{target}: {target.stat().st_size} bytes')
