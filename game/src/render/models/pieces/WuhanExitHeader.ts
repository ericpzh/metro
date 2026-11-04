import { drawWuhanLogo } from '../../wuhanBranding.ts'
import type { LineDef } from '../../../sim/types.ts'

/** P2: navy bilingual lockup, station, actual-colour badges, letter/subscript exit. */
export function drawWuhanHeader(g:CanvasRenderingContext2D,name:string,exit:string,english:string,width:number,lines:readonly LineDef[]):void {
  g.fillStyle='#183b70';g.fillRect(0,0,width,96)
  drawWuhanLogo(g,25,48,44,'#ffffff')
  g.fillStyle='#ffffff';g.textBaseline='middle';g.textAlign='left'
  g.font='bold 20px "Microsoft YaHei",sans-serif';g.fillText('武汉地铁',53,39,84)
  g.font='bold 10px Arial,sans-serif';g.fillText('WUHAN METRO',53,62,84)
  const badges=lines.slice(0,3),right=width-128,badgeWidth=37,gap=4,badgeLeft=right-badges.length*(badgeWidth+gap)-8
  const stationLeft=150,stationRight=badgeLeft-10,room=Math.max(30,stationRight-stationLeft),cx=(stationLeft+stationRight)/2
  const station=name.trim()||'武汉地铁',title=station.endsWith('站')?station:station+'站'
  g.textAlign='center';g.font='bold 29px "Microsoft YaHei",sans-serif';g.fillText(title,cx,english.trim()?35:48,room)
  if(english.trim()){g.font='bold 12px Arial,sans-serif';g.fillText(english.trim().replace(/\s+station$/i,'').toUpperCase()+' STATION',cx,66,room)}
  badges.forEach((line,i)=>{
    const x=badgeLeft+i*(badgeWidth+gap)
    g.fillStyle=line.colour;g.beginPath();g.roundRect(x,25,badgeWidth,46,3);g.fill()
    g.fillStyle='#ffffff';g.font='29px Arial,"Microsoft YaHei",sans-serif';g.fillText(line.id,x+11,46,19)
    g.font='11px "Microsoft YaHei",sans-serif';g.fillText('号线',x+27,38,18)
    g.font='8px Arial,sans-serif';g.fillText('Line '+line.id,x+badgeWidth/2,62,badgeWidth-4)
  })
  const id=(exit.trim()||'A').replace(/(?:出入口|出口|入口|口)$/u,''),match=id.match(/^([A-Za-z]+)(\d+)$/)
  g.fillStyle='#ffffff';g.textAlign='left';g.font='58px Arial,"Microsoft YaHei",sans-serif'
  g.fillText(match?.[1]??id,width-125,49,match?36:60)
  if(match){g.font='28px Arial,sans-serif';g.fillText(match[2],width-91,64,20)}
  g.textAlign='center';g.font='bold 20px "Microsoft YaHei",sans-serif';g.fillText('出入口',width-29,37,55)
  g.font='12px Arial,sans-serif';g.fillText('Entrance',width-29,63,55)
}
