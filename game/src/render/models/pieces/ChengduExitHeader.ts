import { drawChengduLogo } from '../../chengduBranding.ts'
import { t, tForLanguage } from '../../../sim/i18n.ts'
import type { LineDef } from '../../../sim/types.ts'

/** P4 fascia: P6 white lockup, bilingual station, live line badge and exit letter. */
export function drawChengduHeader(g:CanvasRenderingContext2D,name:string,exit:string,english:string,width:number,lines:readonly LineDef[]):void {
  g.fillStyle='#343433';g.fillRect(0,0,width,96)
  drawChengduLogo(g,70,48,122,true,'#ffffff')
  const badges=lines.slice(0,2),badgeW=43,gap=4,right=width-108-badges.length*(badgeW+gap)
  const station=(name||tForLanguage('zh-CN','metro')).trim()
  const title=station.endsWith('站')?station:tForLanguage('zh-CN','value_station',station)
  // Centre the badge on the combined station-name ink (30 px Chinese / 14 px English).
  const centreY=english.trim()?((37-15)+(65+7))/2:48
  g.fillStyle='#ffffff';g.textBaseline='middle';g.textAlign='center'
  g.font='30px "Microsoft YaHei",sans-serif';g.fillText(title,(140+right)/2,english.trim()?37:48,Math.max(36,right-151))
  if(english.trim()){g.font='14px Arial,sans-serif';g.fillText(english.trim(),(140+right)/2,65,Math.max(36,right-151))}
  badges.forEach((line,i)=>{
    const x=right+5+i*(badgeW+gap)
    g.fillStyle=line.colour;g.fillRect(x,centreY-15.5,badgeW,31);g.strokeStyle='#dddddd';g.lineWidth=.8;g.strokeRect(x,centreY-15.5,badgeW,31)
    g.fillStyle='#ffffff';g.font='14px "Microsoft YaHei",sans-serif';g.fillText(`${line.id}号线`,x+badgeW/2,centreY-6,badgeW-4)
    g.font='9px Arial,sans-serif';g.fillText(t('printed_line_value',line.id),x+badgeW/2,centreY+8,badgeW-4)
  })
  const label=exit.trim()||'A',identifier=label.match(/^([A-Za-z]\d*)(?:入口|出口|口)?$/)?.[1]
  g.fillStyle='#ffffff';g.font='62px Arial,sans-serif';g.fillText(identifier?.toUpperCase()??label,width-76,49,56)
  g.font='27px "Microsoft YaHei",sans-serif';g.fillText('入口',width-31,33,53)
  g.font='11px Arial,sans-serif';g.fillText(t('printed_entrance'),width-31,68,55)
}
