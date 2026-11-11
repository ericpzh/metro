import { translate } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'

interface FolderProps {
  tutorialId?: string
  title: string
  count?: number
  /** The Shift+number that folds this folder, badged on the header on hover. */
  shortcut?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function Folder({ tutorialId, title, count, shortcut, open, onToggle, children }: FolderProps): React.ReactElement {
  useLanguage()
  return (
    <section data-tutorial-folder={tutorialId} className={open ? 'folder open' : 'folder'}>
      {/* The key is the ladder's (`RAIL_FOLDERS`), and it is worn the way a tile
          wears its own: a badge on the right of the bar, drawn on hover or focus
          (`styles.css` `.bpKey` / `.folderKey`), so a rail of closed folders stays
          as quiet as it was before there was a ladder. Nothing here is a text
          field, so pointing at the header and pressing the key still folds it
          (`isTypingTarget`). */}
      <button
        type="button"
        className="folderHead"
        onClick={onToggle}
        aria-expanded={open}
        aria-keyshortcuts={shortcut}
      >
        <span className="folderName">{translate(title)}</span>
        {typeof count === 'number' ? <span className="folderCount">{translate(count)}</span> : null}
        <span className="folderCaret" aria-hidden="true" />
        {shortcut ? (
          <span className="folderKey" aria-hidden="true">
            {translate(shortcut)}
          </span>
        ) : null}
      </button>
      <div className="folderBody" aria-hidden={!open} inert={!open}>
        <div className="folderInner">
          <div className="folderPad">{translate(children)}</div>
        </div>
      </div>
    </section>
  )
}
