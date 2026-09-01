/**
 * Fixed, decorative page background: a slowly panning colour wash under a
 * breathing dot mesh. Purely presentational, so it is aria-hidden and sits at
 * z-index -1 with pointer events off.
 *
 * The CSS lives in src/styles.css rather than beside this file, so the whole
 * theme ships as one stylesheet asset.
 */
export function Background() {
  return (
    <div aria-hidden="true" className="bg-fx-root opacity-5">
      <div className="bg-fx-wash" />
      <div className="bg-mesh-stage" style={{ opacity: 0.2 }}>
        <div className="bg-mesh-dots" />
      </div>
    </div>
  )
}
