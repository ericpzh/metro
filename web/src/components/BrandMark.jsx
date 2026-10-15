import mark from '../assets/brand/station-designer-mark.png'

/** The approved icon silhouette; its colour follows the surrounding design. */
export default function BrandMark({ className = '' }) {
  return (
    <span
      className={`brand-mark ${className}`}
      style={{ maskImage: `url(${mark})`, WebkitMaskImage: `url(${mark})` }}
      aria-hidden="true"
    />
  )
}
