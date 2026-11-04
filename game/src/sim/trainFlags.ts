import type { LineDef } from './types.ts'

/** Preserve the 10-float pose: low bits are doors/power, upper bits identify the line. */
export function trainFlags(doors:number,line:LineDef,lines:readonly LineDef[]):number {
  return doors | (line.power==='catenary'?4:0) | ((lines.indexOf(line)+1)<<3)
}
