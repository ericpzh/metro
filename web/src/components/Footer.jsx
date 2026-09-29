import { artUrl, repoUrl, specUrl } from '../site.js'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__col">
          <h2>这套画风是怎么来的</h2>
          <p>
            画风取材自真实的广州地铁：白白的挡板吊顶、亮面的彩色搪瓷墙板（拼缝都留着）、
            撒着深色小点的花岗岩地面、拉丝不锈钢柱子、顶上一道线路色的全高屏蔽门，还有特别醒目的安全黄盲道。
          </p>
          <p className="footer__note">
            参考照片只用来看，没放进包里。配色和元素都在 <code>tools/iso.mjs</code> 里重画了一遍；每张图都由{' '}
            <code>node tools/gen-art.mjs</code> 生成，用的是和游戏里一模一样的 2:1 等轴测投影。
          </p>
        </div>

        <div className="footer__col footer__col--links">
          <h2>文档</h2>
          <ul className="footer__links">
            <li>
              <a href={specUrl} target="_blank" rel="noreferrer">
                GAME-SPEC.md <span>完整设计</span>
              </a>
            </li>
            <li>
              <a href={artUrl} target="_blank" rel="noreferrer">
                art/ <span>SVG 源文件</span>
              </a>
            </li>
            <li>
              <a href={repoUrl} target="_blank" rel="noreferrer">
                代码仓库 <span>工具与生成器</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer__base">
        <p>地铁车站设计师 — 概念图，草稿 1。</p>
        <p>
          不差钱，不招人，也不用交维护费。你只管搭，人群自己会来；车站扛得住就皆大欢喜，扛不住……那就再改改嘛。
        </p>
      </div>
    </footer>
  )
}
