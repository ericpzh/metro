import contours from '../assets/branding/nanjing-contours.json' with { type:'json' }

/** P4 plum blossom silhouette, with its white open roundel and central upright. */
export function drawNanjingLogo(g:CanvasRenderingContext2D,cx:number,cy:number,size:number):void {
  const w=size*contours.aspect,x=cx-w/2,y=cy-size/2
  // The outer petal is the largest contour; the white counter is traced separately.
  for(const [i,path] of contours.paths.entries()){
    g.beginPath();path.forEach(([u,v],j)=>j?g.lineTo(x+u*w,y+v*size):g.moveTo(x+u*w,y+v*size));g.closePath()
    g.fillStyle=i===0?'#d82316':'#ffffff';g.fill()
  }
}
