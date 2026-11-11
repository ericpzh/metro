from PIL import Image
import json, sys
image = Image.open(sys.argv[1]).convert("RGB")
pixels = sum(1 for r,g,b in image.getdata() if b > 60 and g > 45 and b > r * 1.18)
print(json.dumps({"width": image.width, "height": image.height, "bluePixels": pixels}))
if pixels < 50: sys.exit(1)
