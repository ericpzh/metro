import { artUrl, repoUrl, specUrl } from '../site.js'

export default function Footer({ t }) {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__col">
          <h2>{t.footer.buildTitle}</h2>
          <p>{t.footer.buildBody}</p>
          <p className="footer__note">{t.footer.buildNote}</p>
        </div>

        <div className="footer__col footer__col--links">
          <h2>{t.footer.docsTitle}</h2>
          <ul className="footer__links">
            <li>
              <a href={specUrl} target="_blank" rel="noreferrer">
                {t.footer.spec} <span>{t.footer.specSub}</span>
              </a>
            </li>
            <li>
              <a href={artUrl} target="_blank" rel="noreferrer">
                {t.footer.art} <span>{t.footer.artSub}</span>
              </a>
            </li>
            <li>
              <a href={repoUrl} target="_blank" rel="noreferrer">
                {t.footer.repo} <span>{t.footer.repoSub}</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer__base">
        <p>{t.footer.name}</p>
        <p>
          {t.footer.line}
        </p>
      </div>
    </footer>
  )
}
