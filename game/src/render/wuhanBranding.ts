import contours from '../assets/branding/wuhan-contours.json' with { type: 'json' }

/** Supplied P1 silhouette. Station/UI/cab use its blue gradient; signs use white. */
export function drawWuhanLogo(g:CanvasRenderingContext2D,cx:number,cy:number,size:number,colour?:string):void {
  const w=size*contours.aspect,x=cx-w/2,y=cy-size/2
  if(colour)g.fillStyle=colour
  else {
    const gradient=g.createLinearGradient(0,y,0,y+size)
    gradient.addColorStop(0,'#b7e0f0');gradient.addColorStop(.45,'#5faed8');gradient.addColorStop(.82,'#003b83');gradient.addColorStop(1,'#002866')
    g.fillStyle=gradient
  }
  g.beginPath()
  for(const path of contours.paths){path.forEach(([u,v],i)=>i?g.lineTo(x+u*w,y+v*size):g.moveTo(x+u*w,y+v*size));g.closePath()}
  g.fill('evenodd')
}
