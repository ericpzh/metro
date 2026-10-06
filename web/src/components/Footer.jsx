import { artUrl, repoUrl, specUrl } from '../site.js'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__col">
          <h2>这些图是怎么来的</h2>
          <p>
            每一张都是游戏自己的截图：把正式构建跑在无头浏览器里，载入示例车站（动物园），
            调好相机再拍下来——不是另画一遍的示意图。
          </p>
          <p className="footer__note">
            画风取自真实广州地铁：白色挡板吊顶、亮面彩色搪瓷墙板、带深色斑点的花岗岩地面、
            不锈钢柱子、顶部带线路色的全高屏蔽门，还有醒目的安全黄盲道。照片只看不进包；
            这些图由 <code>node tools/shots.mjs</code> 生成，构图写在{' '}
            <code>tools/sheet-plan.mjs</code> 里。
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
                art/ <span>截图源文件</span>
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
          不差钱，不招人，也不用维护费。你尽管搭，人群自己会来；扛得住就皆大欢喜，扛不住就再改改。
        </p>
      </div>
    </footer>
  )
}
