import type { LineDef } from '../../../sim/types.ts'
import { t } from '../../../sim/i18n.ts'

/** P6–9: cream plate, rail pictogram, coloured separators, bilingual name and exit. */
export function drawChongqingHeader(g:CanvasRenderingContext2D,name:string,exit:string,english:string,width:number,lines:readonly LineDef[]):void {
  g.fillStyle='#f2f0dd';g.fillRect(0,0,width,96)
  const ink='#252b31';g.fillStyle=ink;g.strokeStyle=ink;g.lineWidth=3
  g.beginPath();g.roundRect(13,20,48,56,9);g.fill()
  g.strokeStyle='#f2f0dd';g.lineWidth=2.5;g.beginPath();g.roundRect(22,27,30,36,8);g.stroke()
  g.fillStyle='#f2f0dd';g.fillRect(27,33,20,13)
  for(const x of [29,45]){g.beginPath();g.arc(x,55,2.5,0,Math.PI*2);g.fill()}
  g.beginPath();g.moveTo(29,63);g.lineTo(23,71);g.moveTo(45,63);g.lineTo(51,71);g.stroke()
  const badges=lines.slice(0,3),slot=51
  g.textBaseline='middle';g.textAlign='center'
  badges.forEach((line,i)=>{
    const x=71+i*slot;g.fillStyle=line.colour;g.fillRect(x,14,7,68)
    g.fillStyle=ink;g.font='59px Arial,"Microsoft YaHei",sans-serif';g.fillText(line.id,x+30,48,37)
  })
  const left=badges.length?105+badges.length*slot:74,right=width-118,centre=(left+right)/2,room=Math.max(28,right-left-12)
  g.fillStyle=ink;g.font='bold 30px "Microsoft YaHei",sans-serif';g.fillText(name.trim()||'重庆轨道',centre,english.trim()?37:48,room)
  if(english.trim()){g.font='16px Arial,sans-serif';g.fillText(english.trim(),centre,66,room)}
  if(badges.length){g.font='16px "Microsoft YaHei",sans-serif';g.fillText('号线',left-19,26,31);g.font='11px Arial,sans-serif';g.fillText('Line',left-19,69,29)}
  const identifier=(exit.trim()||'1').replace(/(?:号口|出入口|出口|入口|口)$/u,'')
  g.font='62px Arial,"Microsoft YaHei",sans-serif';g.fillText(identifier,width-86,49,65)
  g.font='24px "Microsoft YaHei",sans-serif';g.fillText('出入口',width-34,34,62)
  g.font='12px Arial,sans-serif';g.fillText(t('printed_entrance'),width-34,66,62)
}
