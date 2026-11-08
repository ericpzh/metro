import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// One selection drives the soundtrack, closing card and exported credits.
export const music = JSON.parse(readFileSync(resolve('game/public/audio/music/manifest.json'), 'utf8')).find(m => m.id === 'sunset-plains')
if (!music) throw new Error('Selected demo music is missing from the approved game manifest')
