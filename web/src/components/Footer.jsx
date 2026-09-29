import { artUrl, repoUrl, specUrl } from '../site.js'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__col">
          <h2>Where the look comes from</h2>
          <p>
            The art direction is a stylised read of real Guangzhou Metro stations: high-key white
            baffle ceilings, glossy coloured enamel wall panels with visible seams, speckled granite
            floors with dark inlay bands, brushed stainless columns, full-height platform screen
            doors with a line-colour header band, and saturated safety-yellow tactile strips.
          </p>
          <p className="footer__note">
            Reference photographs were studied, not shipped. The palette and motifs are
            reinterpreted in <code>tools/iso.mjs</code>; every sheet is generated from{' '}
            <code>node tools/gen-art.mjs</code> in the same 2:1 dimetric projection the game uses.
          </p>
        </div>

        <div className="footer__col footer__col--links">
          <h2>The documents</h2>
          <ul className="footer__links">
            <li>
              <a href={specUrl} target="_blank" rel="noreferrer">
                GAME-SPEC.md <span>the full design</span>
              </a>
            </li>
            <li>
              <a href={artUrl} target="_blank" rel="noreferrer">
                art/ <span>the source SVGs</span>
              </a>
            </li>
            <li>
              <a href={repoUrl} target="_blank" rel="noreferrer">
                Repository <span>tools and generator</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer__base">
        <p>Metro Station Designer — concept art, draft 1.</p>
        <p>
          No money, no staff, no upkeep. You build, the crowds arrive, and the station either copes
          or it does not.
        </p>
      </div>
    </footer>
  )
}
