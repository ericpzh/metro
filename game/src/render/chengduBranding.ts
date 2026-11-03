import contours from '../assets/branding/chengdu-contours.json' with { type: 'json' }

/** Separate P1 train/UI and P6 exit lockups, traced from the supplied artwork.
 * Width-based sizing preserves their wide silhouette in a square icon/atlas slot.
 * Filled contours retain actual lettering without depending on installed fonts. */
export function drawChengduLogo(g:CanvasRenderingContext2D,cx:number,cy:number,width:number,exit=false,monochrome?:string):void {
  const art=exit?contours.exit:contours.trainUi,height=width/art.aspect
  for(const layer of art.layers) {
    g.fillStyle=monochrome??layer.colour;g.beginPath()
    for(const path of layer.paths) {
      path.forEach(([x,y],i)=>{
        const X=cx+(x-.5)*width,Y=cy+(y-.5)*height
        if(i===0)g.moveTo(X,Y);else g.lineTo(X,Y)
      });g.closePath()
    }
    g.fill('evenodd')
  }
}
