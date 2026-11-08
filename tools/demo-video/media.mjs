import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ui } from '../../web/src/i18n.js'
import { renderGraphics } from './design.mjs'
import { music } from './audio.mjs'

export function command(executable, args, { capture = false } = {}) {
  return new Promise((ok, bad) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout?.on('data', b => { stdout += b })
    child.stderr?.on('data', b => { stderr = (stderr + b).slice(-100000) })
    child.once('error', bad)
    child.once('exit', code => code === 0 ? ok({ stdout, stderr }) : bad(new Error(`${executable} exited ${code}\n${stderr.slice(-6000)}`)))
  })
}

export async function encodeTake(directory, shot, { width, height, fps }) {
  const recorded=JSON.parse((await command('ffprobe',['-v','error','-show_streams','-of','json',resolve(directory,'frame-00000.jpg')],{capture:true})).stdout).streams[0]
  if(recorded.width!==width||recorded.height!==height)throw new Error(`Native capture dimensions differ in ${shot.id}: ${recorded.width}×${recorded.height}`)
  // Preserve the captured camera timing and synthesize in-between frames after
  // the 4× retime. A plain fps filter would hold a 1× capture frame for several
  // output frames on crowded stations.
  const cadence=shot.view==='flythrough'
    ? `tpad=stop_mode=clone:stop_duration=0.4,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1`
    : `fps=${fps}`
  // Placement has no usable first second: retime first, then trim delivered
  // seconds, so the build starts on its wall and ends when its camera does.
  const trim=shot.trimStart??0
  const trimFilter=trim?`trim=start=${trim},setpts=PTS-STARTPTS,`:''
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-safe', '0', '-f', 'concat', '-i', resolve(directory, 'frames.ffconcat'),
    '-vf', `settb=AVTB,setpts=(PTS-STARTPTS)/${shot.playbackRate},${trimFilter}scale=${width}:${height}:flags=lanczos,setsar=1,${cadence}`, '-t', String(shot.seconds), '-an',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(directory, 'raw.mp4')])
}

export async function editVideo(output, plan, takes, settings) {
  const edit = resolve(output, 'edit'); mkdirSync(edit, { recursive: true })
  const seconds=plan.at(-1).end
  const graphics=await renderGraphics(output,plan,settings.language,{width:settings.width,height:settings.height})
  const styled=resolve(edit,'styled');mkdirSync(styled,{recursive:true})
  for(const shot of plan){
    const trim=shot.trimStart??0
    let placementCard=null
    if(shot.kind==='placement'){
      const events=takes.find(t=>t.id===shot.id).events.filter(e=>e.card)
      let first=0
      for(let i=0;i<events.length;i++)if(events[i].at<=trim)first=i
      const shown=events.slice(first)
      const ends=[0,...shown.map(e=>Math.max(0,e.at-trim)),shot.seconds]
      const rows=[]
      for(let i=0;i<ends.length-1;i++)rows.push(`file '${resolve(graphics,`placement-card-${String(first+i).padStart(2,'0')}.png`).replaceAll('\\','/')}'`,`duration ${(ends[i+1]-ends[i]).toFixed(6)}`)
      rows.push(`file '${resolve(graphics,`placement-card-${String(first+Math.max(0,shown.length-1)).padStart(2,'0')}.png`).replaceAll('\\','/')}'`)
      const list=resolve(edit,'placement-cards.ffconcat');writeFileSync(list,'ffconcat version 1.0\n'+rows.join('\n')+'\n')
      placementCard=resolve(edit,'placement-cards.mov')
      await command('ffmpeg',['-v','error','-y','-safe','0','-f','concat','-i',list,'-vf',`fps=${settings.fps}`,'-t',String(shot.seconds),'-c:v','qtrle','-pix_fmt','argb',placementCard])
    }
    const rapid=['city','stock','decor'].includes(shot.kind)
    const fade=rapid?`[1:v]format=rgba[graphics]`:`[1:v]format=rgba,fade=t=in:st=0:d=0.14:alpha=1,fade=t=out:st=${shot.seconds-.12}:d=0.12:alpha=1[graphics]`
    const bookends=shot.kind==='hero'?',fade=t=in:d=0.35':shot.kind==='cta'?`,fade=t=out:st=${shot.seconds-.5}:d=0.5`:''
    // Placement is already trimmed in its raw take; the trim start only shifts
    // its phase cards and audio cues onto the shorter picture.
    const base=placementCard?`[0:v][graphics]overlay=x=0:y=0:shortest=1:format=auto[base];[base][2:v]overlay=x=${Math.round(settings.width-896*settings.width/2560)}:y=${Math.round(1100*settings.height/1440)}:shortest=1:format=auto`:'[0:v][graphics]overlay=x=0:y=0:shortest=1:format=auto'
    const compose=`${base}${bookends},scale=in_range=auto:out_range=tv:out_color_matrix=bt709,format=yuv420p[picture]`
    console.log(`Designing ${shot.id}`)
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',resolve(output,'takes',shot.id,'raw.mp4'),'-loop','1','-framerate',String(settings.fps),'-i',resolve(graphics,`${shot.id}.png`),
      ...(placementCard?['-i',placementCard]:[]),
      '-filter_complex',`${fade};${compose}`,'-map','[picture]','-an','-t',String(shot.seconds),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',
      '-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart',resolve(styled,`${shot.id}.mp4`)])
  }
  const rawList = resolve(edit, 'takes.ffconcat')
  writeFileSync(rawList, 'ffconcat version 1.0\n' + plan.map(s => `file '${resolve(styled,`${s.id}.mp4`).replaceAll('\\', '/')}'`).join('\n') + '\n')
  const joined = resolve(edit, 'picture.mp4')
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-safe', '0', '-f', 'concat', '-i', rawList, '-c', 'copy', joined])

  const audioRoot = resolve('game/public/audio')
  const manifest = JSON.parse(readFileSync(resolve(audioRoot, 'manifest.json'), 'utf8'))
  const layers = [{ file: resolve(audioRoot, 'music', music.file), at: 0, duration: seconds, gain: .7, music: true }]
  // Editorial ambient beds remain at normal pitch even where the sim runs 4×.
  for (const shot of plan) {
    if (shot.station!=='empty'&&!['blocks', 'equipment', 'city'].includes(shot.kind)) layers.push({ file: resolve(audioRoot, 'crowd.mp3'), at: shot.start, duration: shot.seconds, gain: .08 })
    if (['train', 'stock'].includes(shot.kind)) {
      const last=layers.at(-1),file=resolve(audioRoot,'train.mp3')
      if(last?.file===file&&Math.abs(last.at+last.duration-shot.start)<.001)last.duration+=shot.seconds
      else layers.push({file,at:shot.start,duration:shot.seconds,gain:.16})
    }
    const trim = shot.trimStart ?? 0
    for (const e of takes.find(t => t.id === shot.id).events ?? []) if (e.file && e.at >= trim) layers.push({ file: resolve(audioRoot, e.file), at: shot.start + e.at - trim, duration: .8, gain:shot.playbackRate>=4?.35:.55, cue: true })
  }
  for (const l of layers) if (!existsSync(l.file)) throw new Error(`Missing audio asset ${l.file}`)
  const args = ['-hide_banner', '-y']
  for (const layer of layers) args.push(...(!layer.cue ? ['-stream_loop', '-1'] : []), '-i', layer.file)
  const filters = layers.map((l, i) => `[${i}:a]atrim=start=${l.music ? 8 : 0}:duration=${l.duration},asetpts=PTS-STARTPTS,aresample=48000,${l.music ? 'loudnorm=I=-23:TP=-3:LRA=9,' : ''}volume=${l.gain},afade=t=in:d=${l.cue ? .008 : .35},afade=t=out:st=${Math.max(0, l.duration - (l.music ? 3 : .35))}:d=${l.music ? 3 : .35},adelay=${Math.round(l.at * 1000)}:all=1[a${i}]`)
  filters.push(layers.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${layers.length}:duration=longest:normalize=0,atrim=duration=${seconds},loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json[mix]`)
  const mixed = resolve(edit, 'soundtrack.wav')
  args.push('-filter_complex', filters.join(';'), '-map', '[mix]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', mixed)
  const audioResult = await command('ffmpeg', args)
  writeFileSync(resolve(edit, 'audio-render.log'), audioResult.stderr)
  const final = resolve(output, `station-designer-demo-${settings.language}.mp4`)
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', joined, '-i', mixed,
    '-map', '0:v:0', '-map', '1:a:0', '-t', String(seconds), '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-metadata', `title=${ui[settings.language].video.title}`,
    '-metadata', `comment=Real game recordings. Music: ${music.title} by ${music.author} (${music.license}). Full source and audio credits accompany this video.`, final])
  const usedFiles = [...new Set(layers.filter(l => !l.music).map(l => l.file.split(/[\\/]/).at(-1)))]
  const credits = { music, sounds: manifest.filter(m => usedFiles.includes(m.file)), mix: ui[settings.language].video.audioEdit, layers }
  writeFileSync(resolve(output, 'audio-credits.json'), JSON.stringify(credits, null, 2))
  writeFileSync(resolve(output, 'CREDITS.md'), `# ${ui[settings.language].video.credits}\n\n` + `${music.credit}\n${music.source}\n${music.licenseUrl}\n\n` + credits.sounds.map(s => `- ${s.file}: ${s.source.author} — ${s.source.license}. ${s.source.source}`).join('\n') + '\n\n' + credits.mix + '\n')
  return final
}

export async function validateVideo(file, seconds = 60, settings = {width:2560,height:1440,fps:30}) {
  const probe = JSON.parse((await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { capture: true })).stdout)
  const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio')
  if (!v || !a || v.codec_name !== 'h264' || a.codec_name !== 'aac') throw new Error('Delivery requires H.264 video and AAC audio')
  if(v.pix_fmt!=='yuv420p')throw new Error('Delivery requires standard 8-bit 4:2:0 video')
  if(v.width!==settings.width||v.height!==settings.height||Math.abs(Number(v.avg_frame_rate.split('/')[0])/Number(v.avg_frame_rate.split('/')[1])-settings.fps)>.001)throw new Error('Delivery dimensions/frame rate differ from the capture settings')
  if (Math.abs(Number(probe.format.duration) - seconds) > .08) throw new Error(`Incorrect video duration ${probe.format.duration}`)
  const { stderr } = await command('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json', '-vn', '-f', 'null', '-'])
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/)
  if (!match) throw new Error('Could not measure delivered soundtrack')
  const loudness = JSON.parse(match[0])
  if (Number(loudness.input_tp) > -1 || Math.abs(Number(loudness.input_i) + 18) > 2) throw new Error(`Soundtrack outside delivery target: ${match[0]}`)
  return { duration: Number(probe.format.duration), width: v.width, height: v.height, frameRate: v.avg_frame_rate,
    codecs: [v.codec_name, a.codec_name], bytes: Number(probe.format.size), loudness }
}
