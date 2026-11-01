import { drawMetroMark } from '../../cityBranding.ts'
import { t, tForLanguage } from '../../../sim/i18n.ts'
import type { LineDef } from '../../../sim/types.ts'

/** Shared artwork for the entrance fascia and both over-roof signs. */
export function drawBeijingHeader(g:CanvasRenderingContext2D,name:string,english:string,width:number,lines:readonly LineDef[]):void {
  g.fillStyle='#073563';g.fillRect(0,0,width,96)
  drawMetroMark(g,49,48,62,'#ffffff','beijing')
  const badges=lines.slice(0,3),badgeW=55,gap=5
  const right=width-10-badges.length*(badgeW+gap)
  const station=(name||tForLanguage('zh-CN','metro')).trim()
  const title=station.endsWith('站')?station:tForLanguage('zh-CN','value_station',station)
  const x=(98+right)/2,room=Math.max(40,right-112)
  g.fillStyle='#ffffff';g.textBaseline='middle';g.textAlign='center';g.font='bold 30px "Microsoft YaHei",sans-serif'
  g.fillText(title,x,english.trim()?35:48,room)
  if(english.trim()){g.font='bold 15px Arial,sans-serif';g.fillText(english.trim(),x,65,room)}
  badges.forEach((line,i)=>{
    const x=right+8+i*(badgeW+gap)
    g.fillStyle=line.colour;g.fillRect(x,38,badgeW,38)
    g.strokeStyle='#e4eced';g.lineWidth=.8;g.strokeRect(x,38,badgeW,38)
    g.fillStyle='#ffffff';g.font='25px Arial,sans-serif';g.fillText(line.id,x+17,55,28)
    g.font='10px "Microsoft YaHei",sans-serif';g.fillText(t('printed_line_suffix'),x+41,49,23)
    g.font='8px Arial,sans-serif';g.fillText(t('printed_line_value',line.id),x+38,64,29)
  })
}
