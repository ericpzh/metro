// Lane A split (Phase 1): moved verbatim from app/App.tsx. The inspector's
// fold chrome lives here so line cards and future sections share it by
// composition (plan.md R5) instead of each reimplementing a fold.
/**
 * A fold for the right-hand inspector: a clickable head and a body that eases
 * open/closed. The body stays mounted (clipped and `inert` while shut), so a
 * collapsed line keeps its half-typed input state.
 */
export function Disclosure({
  head,
  open,
  onToggle,
  className,
  children,
}: {
  head: React.ReactNode
  open: boolean
  onToggle: () => void
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className={className ? `disclosure ${className}` : 'disclosure'}>
      <button type="button" className={open ? 'disclosureHead open' : 'disclosureHead'} onClick={onToggle} aria-expanded={open}>
        {head}
        <span className="disclosureCaret" aria-hidden="true" />
      </button>
      <div className={open ? 'foldBody open' : 'foldBody'} aria-hidden={!open} inert={!open}>
        <div className="foldInner">{children}</div>
      </div>
    </div>
  )
}
