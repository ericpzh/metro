import { artworks, tagline } from '../artworks.js'
import { sheet, specUrl } from '../site.js'

const facts = [
  ['技术栈', 'React 19 + Vite、three.js（react-three-fiber）、Web Worker 仿真'],
  ['模式', '沙盒 / 解谜模拟，单人'],
  ['视角', '2:1 等轴测 3D、剖切、按层切片、360° 环绕'],
  ['状态', '设计文档，草稿 1'],
]

export default function Hero() {
  const first = artworks[0]

  return (
    <section className="hero" id="top">
      <div className="hero__grid" aria-hidden="true" />
      <div className="hero__inner">
        <p className="hero__eyebrow">地铁车站设计师 · 概念图</p>
        <h1>
          建造一座地铁车站。
          <br />
          再看人群
          <br />
          <span className="hero__accent">试着把它用起来。</span>
        </h1>

        <div className="hero__cols">
          <div>
            <p className="hero__tagline">{tagline}</p>
            <div className="hero__actions">
              <a className="btn btn--primary" href="#gallery">
                看这 {artworks.length} 张概念图
              </a>
              <a className="btn" href={specUrl} target="_blank" rel="noreferrer">
                阅读设计文档
              </a>
            </div>
          </div>

          <a className="hero__peek" href={`#sheet-${first.id}`} aria-label={`前往第 ${first.id} 张概念图`}>
            <img src={sheet(first.file)} alt="" loading="eager" decoding="async" aria-hidden="true" />
            <span className="hero__peek-tag">
              <b>{first.id}</b> {first.nav}
            </span>
          </a>
        </div>

        <dl className="hero__facts">
          {facts.map(([k, v]) => (
            <div className="hero__fact" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
