import "./background.css"

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
