import { translate, t } from '../sim/i18n.ts'
import { useLanguage } from './i18n.ts'
// /lab — the V1 material lab (PLAN.md §4 V1). The renderer we judge here is the
// renderer the game keeps: rounded-corner autotile, outline pass, contact blobs,
// AO + light rig, and procedural granite / enamel / baffle materials. It also
// reports the chunk mesh build time against the §10.4 budget of < 4 ms.

import { useEffect, useRef, useState } from 'react'
import { SceneRenderer } from '../render/scene.ts'
import { labStation } from '../build/model.ts'

export function Lab(): React.ReactElement {
  useLanguage()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [chunkMs, setChunkMs] = useState(0)
  const [fps, setFps] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new SceneRenderer(canvas)
    scene.onStats = (s) => {
      setFps(s.fps)
      setChunkMs(s.lastChunkMs)
    }
    scene.setStation(labStation())
    scene.setLevel(0, false)
    scene.setPreset('iso')
    const resize = (): void => scene.resize(canvas.clientWidth, canvas.clientHeight)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      scene.dispose()
    }
  }, [])

  return (
    <div className="lab">
      <canvas ref={canvasRef} className="viewport" />
      <div className="labPanel">
        <h1>{t('material_lab')}</h1>
        <p className="muted">{t('an_8_8_slab_with_a_hole_and_steps_at_the_far_side_try_materials_')}</p>
        <ul>
          <li>
            <b>{t('auto_tiling')}</b>{t('eight_neighbour_masks_shared_faces_are_hidden_blocks_are_right_a')}</li>
          <li>
            <b>{t('outlines')}</b>{t('inverted_hull_about_0_05_m_0_8_px_at_design_scale')}</li>
          <li>
            <b>{t('contact_shadows')}</b>{t('soft_shadow_beneath_every_piece_and_passenger')}</li>
          <li>
            <b>{t('ambient_occlusion_lighting')}</b>{t('baked_vertex_ao_key_sky_fill_lights')}</li>
          <li>
            <b>{t('procedural_materials')}</b>{t('granite_speckles_enamel_seams_white_ceiling_grilles_brushed_stee')}</li>
        </ul>
        <div className="labStats">
          <div className="kv">
            <span>{t('chunk_meshing')}</span>
            <b className={chunkMs > 4 ? 'bad' : 'good'}>{translate(chunkMs.toFixed(2))} ms</b>
          </div>
          <div className="kv">
            <span>{t('budget')}</span>
            <b>{t('lt_4_ms_chunk')}</b>
          </div>
          <div className="kv">
            <span>{t('fps')}</span>
            <b>{translate(fps)}</b>
          </div>
        </div>
        <a className="back" href="./">
          {t('back_to_game')}</a>
      </div>
    </div>
  )
}
