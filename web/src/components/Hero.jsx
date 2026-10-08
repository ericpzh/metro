import { artworks, tagline } from '../artworks.js'
import { gamePath, sheet } from '../site.js'

const facts = [
  ['建造', '从一米方块到多层换乘站'],
  ['运行', '调节客流，观察排队与滞留'],
  ['观察', '转动、俯视、剖开车站'],
  ['模式', '自由沙盒，专注空间与客流'],
]

export default function Hero() {
  const first = artworks[0]

  return (
    <section className="hero" id="top">
      <div className="hero__grid" aria-hidden="true" />
      <div className="hero__inner">
        <p className="hero__eyebrow">地铁车站设计师 · 游戏</p>
        <h1>
          搭一座小小地铁车站。
          <br />
          看人群来来去去。
          <br />
          <span className="hero__accent">再想办法，别让它挤爆。</span>
        </h1>

        <div className="hero__cols">
          <div>
            <p className="hero__tagline">{tagline}</p>
            <div className="hero__actions">
              <a className="btn btn--primary" href={gamePath}>
                开始游戏
              </a>
              <a className="btn" href="#gallery">
                浏览概念图
              </a>
            </div>
          </div>

          <a className="hero__peek" href={`#sheet-${first.id}`} aria-label="前往第一张概念图">
            <img src={sheet(first.file)} alt="" loading="eager" decoding="async" aria-hidden="true" />
            <span className="hero__peek-tag">{first.nav}</span>
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
