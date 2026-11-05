import type { LineDef } from '../../../sim/types.ts'

export function drawNanjingRailIcon(g:CanvasRenderingContext2D,x:number,y:number,size:number,ink='#ffffff'):void {
  g.strokeStyle=ink;g.fillStyle=ink;g.lineWidth=size*.035
  g.beginPath();g.roundRect(x,y,size,size,size*.1);g.stroke()
  g.beginPath();g.roundRect(x+size*.22,y+size*.12,size*.56,size*.64,size*.18);g.stroke()
  g.fillRect(x+size*.32,y+size*.23,size*.36,size*.22)
  for(const u of [.34,.66]){g.beginPath();g.arc(x+size*u,y+size*.62,size*.035,0,Math.PI*2);g.fill()}
  g.beginPath();g.moveTo(x+size*.33,y+size*.75);g.lineTo(x+size*.22,y+size*.89);g.moveTo(x+size*.67,y+size*.75);g.lineTo(x+size*.78,y+size*.89);g.stroke()
}
/** P8: line tiles, rail icon + bilingual station, and an outlined numeric exit. */
export function drawNanjingHeader(g:CanvasRenderingContext2D,name:string,exit:string,english:string,width:number,lines:readonly LineDef[]):void {
  g.fillStyle='#14213f';g.fillRect(0,0,width,96)
  const badges=lines.slice(0,3),slot=35
  g.textAlign='center';g.textBaseline='middle'
  badges.forEach((line,i)=>{
    const x=12+i*slot;g.fillStyle=line.colour;g.fillRect(x,19,30,58)
    g.fillStyle=['#f2da51','#f2df67','#ffc600'].includes(line.colour.toLowerCase())?'#14213f':'#ffffff'
    g.font='42px Arial,"Microsoft YaHei",sans-serif';g.fillText(line.id,x+15,49,27)
  })
  const end=16+badges.length*slot
  g.fillStyle='#ffffff';g.textAlign='left';g.font='23px "Microsoft YaHei",sans-serif';g.fillText('号线',end,36,49)
  g.font='12px Arial,sans-serif';g.fillText('Line '+badges.map(l=>l.id).join('/'),end,64,75)
  const icon=end+81;drawNanjingRailIcon(g,icon,24,48)
  const left=icon+61,right=width-77,room=Math.max(30,right-left),cy=english.trim()?37:48
  const title=(name.trim()||'南京地铁').replace(/站$/u,'')+'站'
  g.fillStyle='#ffffff';g.font='28px "Microsoft YaHei",sans-serif';g.fillText(title,left,cy,room)
  if(english.trim()){g.font='13px Arial,sans-serif';g.fillText(english.trim().replace(/\s+station$/i,'').toUpperCase(),left,66,room)}
  const id=(exit.trim()||'1').replace(/(?:号口|出入口|出口|入口|口)$/u,'')
  g.strokeStyle='#ffffff';g.lineWidth=2;g.strokeRect(width-63,15,49,66)
  g.textAlign='center';g.font='51px Arial,"Microsoft YaHei",sans-serif';g.fillText(id,width-38.5,49,43)
}
