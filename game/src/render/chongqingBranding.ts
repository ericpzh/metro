import contours from '../assets/branding/chongqing-contours.json' with { type: 'json' }

/** P4 CRT contours, fitted within a square just like the other city icons. */
export function drawChongqingLogo(g:CanvasRenderingContext2D,cx:number,cy:number,size:number,colour='#008c44'):void {
  drawChongqingEmblem(g,cx-size/2,cy-size/contours.aspect/2,size,size/contours.aspect,colour)
}

export function drawChongqingEmblem(g:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,colour:string):void {
  g.save();g.translate(x,y);g.scale(w,h);g.fillStyle=colour;g.beginPath()
  for(const path of contours.paths){path.forEach(([px,py],i)=>i?g.lineTo(px,py):g.moveTo(px,py));g.closePath()}
  g.fill('evenodd');g.restore()
}

/** P1–3: white oval cut into the line-coloured band, CRT and number in that colour. */
export function drawChongqingTrainBadge(g:CanvasRenderingContext2D,line:string,colour:string,width=512,height=128):void {
  g.clearRect(0,0,width,height)
  g.fillStyle='#ffffff';g.beginPath();g.ellipse(width/2,height/2,width*.49,height*.49,0,0,Math.PI*2);g.fill()
  drawChongqingEmblem(g,width*.16,height*.18,width*.50,height*.64,colour)
  const text=line.trim()||'1',box=Math.max(width*.13,Math.min(width*.22,text.length*width*.067))
  g.fillStyle=colour;g.fillRect(width*.685,height*.17,box,height*.66)
  g.fillStyle='#ffffff';g.textAlign='center';g.textBaseline='middle';g.font=`${height*.66}px Arial,sans-serif`
  g.fillText(text,width*.685+box/2,height*.525,box*.87)
}
