import { artUrl, repoUrl, specUrl } from '../site.js'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__col">
          <h2>美术风格从何而来</h2>
          <p>
            美术方向是对真实广州地铁车站的风格化解读：高亮白色的挡板吊顶、带可见拼缝的亮面彩色搪瓷墙板、
            带深色嵌条的斑点花岗岩地面、拉丝不锈钢立柱、带线路色顶带的全高屏蔽门，以及饱和的安全黄色盲道带。
          </p>
          <p className="footer__note">
            参考照片只作研究，并未随包发布。配色与母题在 <code>tools/iso.mjs</code> 中重新演绎；每一张图都由{' '}
            <code>node tools/gen-art.mjs</code> 生成，采用与游戏相同的 2:1 等轴测投影。
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
          没有金钱，没有员工，没有维护费。你只管建造，人群自会到来，车站要么扛得住，要么扛不住。
        </p>
      </div>
    </footer>
  )
}
