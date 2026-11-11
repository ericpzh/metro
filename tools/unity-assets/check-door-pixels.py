import json, sys
from pathlib import Path
from PIL import Image, ImageChops
root=Path(sys.argv[1])
def changed(a,b):
    one=Image.open(root/a).convert('RGB'); two=Image.open(root/b).convert('RGB')
    diff=ImageChops.difference(one,two)
    return sum(1 for pixel in diff.getdata() if max(pixel)>5)
print(json.dumps({'plus':changed('plus-closed.png','plus-open.png'),'minus':changed('minus-closed.png','minus-open.png')}))
