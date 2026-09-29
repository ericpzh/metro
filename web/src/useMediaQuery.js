import { useEffect, useState } from 'react'

/**
 * Track a CSS media query from React. Reads synchronously on first render so
 * layout decisions (like whether the note starts collapsed) are right on the
 * first paint, then follows the query as the viewport changes.
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
