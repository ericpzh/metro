import { t, tForLanguage } from '../../../sim/i18n.ts'
import type { LineDef } from '../../../sim/types.ts'

/** Shanghai sign: line badge left, bilingual station centre, numbered exit right. */
export function drawShanghaiHeader(g:CanvasRenderingContext2D,name:string,exit:string,english:string,width:number,lines:readonly LineDef[]):void {
  g.fillStyle='#353b35';g.fillRect(0,0,width,96)
  g.strokeStyle='#969d87';g.lineWidth=1
  for(const x of [142,width-130]){g.beginPath();g.moveTo(x,5);g.lineTo(x,91);g.stroke()}
  const line=lines[0]
  if(line){
    g.fillStyle=line.colour;g.fillRect(12,22,48,52)
    g.fillStyle='#ffffff';g.textAlign='center';g.textBaseline='middle';g.font='38px Arial,sans-serif';g.fillText(line.id,36,49,44)
    g.textAlign='left';g.font='27px "Microsoft YaHei",sans-serif';g.fillText(t('printed_line_suffix'),66,40,70)
    g.font='12px Arial,sans-serif';g.fillText(t('printed_line_value',line.id),66,64,70)
  }
  const station=name.endsWith('站')?name:tForLanguage('zh-CN','value_station',name)
  const middle=(142+width-130)/2,room=Math.max(60,width-294)
  g.fillStyle='#ffffff';g.textAlign='center';g.textBaseline='middle';g.font='bold 31px "Microsoft YaHei",sans-serif'
  g.fillText(station,middle,english.trim()?36:48,room)
  if(english.trim()){g.font='15px Arial,sans-serif';g.fillText(english.trim(),middle,65,room)}
  const label=(exit||'').replace(/(?:出入口|出口|入口|号口|口)$/u,'').trim()
  g.font='49px Arial,sans-serif';g.fillText(label,width-91,49,60)
  g.font='24px "Microsoft YaHei",sans-serif';g.fillText(t('printed_number_exit'),width-36,36,55)
  g.font='12px Arial,sans-serif';g.fillText(t('printed_exit').toUpperCase(),width-36,61,55)
}
