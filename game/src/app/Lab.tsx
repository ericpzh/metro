// /lab — the V1 material lab (PLAN.md §4 V1). The renderer we judge here is the
// renderer the game keeps: rounded-corner autotile, outline pass, contact blobs,
// AO + light rig, and procedural granite / enamel / baffle materials. It also
// reports the chunk mesh build time against the §10.4 budget of < 4 ms.

import { useEffect, useRef, useState } from 'react'
import { SceneRenderer } from '../render/scene.ts'
import { labStation } from '../build/model.ts'

export function Lab(): React.ReactElement {
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
        <h1>材质试验台</h1>
        <p className="muted">一块 8×8 的板，中间开个洞，远侧有台阶。观感先在这看，觉得行再拿去当游戏本体。</p>
        <ul>
          <li>
            <b>圆角自铺装</b>：8 邻域掩码，暴露顶边 12.5 cm 倒角，外侧圆角。
          </li>
          <li>
            <b>描边</b>：反向外壳，约 0.05 m（设计尺度上 ≈ 0.8 px）。
          </li>
          <li>
            <b>接触阴影</b>：每个设备与行人下方一张软阴影贴片。
          </li>
          <li>
            <b>环境光遮蔽 + 布光</b>：顶点 AO 烘焙 + 主光 / 天光 / 补光。
          </li>
          <li>
            <b>程序化材质</b>：花岗岩斑点、搪瓷板缝、白色格栅天花、拉丝不锈钢。
          </li>
        </ul>
        <div className="labStats">
          <div className="kv">
            <span>区块网格构建</span>
            <b className={chunkMs > 4 ? 'bad' : 'good'}>{chunkMs.toFixed(2)} ms</b>
          </div>
          <div className="kv">
            <span>预算</span>
            <b>&lt; 4 ms / 区块</b>
          </div>
          <div className="kv">
            <span>FPS</span>
            <b>{fps}</b>
          </div>
        </div>
        <a className="back" href="./">
          ← 回到游戏
        </a>
      </div>
    </div>
  )
}
