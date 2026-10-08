import { artUrl, repoUrl, specUrl } from '../site.js'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__col">
          <h2>继续搭你的车站</h2>
          <p>从示例车站开始，或者从空地搭起。运行后看哪里拥堵，再试一种新的布局。</p>
          <p className="footer__note">这些概念图使用游戏模型与界面，展示你能建造和调整的空间。</p>
        </div>

        <div className="footer__col footer__col--links">
          <h2>文档</h2>
          <ul className="footer__links">
            <li>
              <a href={specUrl} target="_blank" rel="noreferrer">
                游戏设计 <span>详细说明</span>
              </a>
            </li>
            <li>
              <a href={artUrl} target="_blank" rel="noreferrer">
                概念图 <span>SVG 原图</span>
              </a>
            </li>
            <li>
              <a href={repoUrl} target="_blank" rel="noreferrer">
                代码仓库 <span>项目源码</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer__base">
        <p>地铁车站设计师</p>
        <p>
          搭一座车站，看人群来来去去。
        </p>
      </div>
    </footer>
  )
}
