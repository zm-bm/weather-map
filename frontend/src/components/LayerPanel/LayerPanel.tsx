import { cycleLabel as formatCycleLabel } from '../../map/time/format'
import { useLoadedVariableContext } from '../../state/VariableContext'
import { getScalarLayerMeta } from '../../map/scalar'

function LayerPanel() {
  const {
    scalarVariables,
    activeScalar,
    variableMeta,
    cycle,
    setActiveScalar,
  } = useLoadedVariableContext()

  const activeScalarMeta = getScalarLayerMeta(activeScalar, variableMeta)
  const cycleText = formatCycleLabel(cycle)

  return (
    <section className="layer-panel wm-panel-shell" aria-label="Weather map panel">
      <div className="layer-panel__header wm-titlebar">
        <span className="layer-panel__eyebrow wm-eyebrow">Weather Map</span>
        <strong className="layer-panel__title wm-display-caps">{activeScalarMeta.label}</strong>
        <span className="layer-panel__subtitle wm-mono-meta">
          {cycleText ?? 'Forecast view'}
        </span>
      </div>

      <fieldset className="panel-section">
        <legend className="panel-section__legend wm-eyebrow">Variable</legend>
        <div className="layer-pill-list">
          {scalarVariables.map((variableId) => {
            const meta = getScalarLayerMeta(variableId, variableMeta)
            const isActive = activeScalar === variableId

            return (
              <label
                key={variableId}
                className={`layer-pill wm-bevel-button wm-choice-chip ${isActive ? 'layer-pill--active wm-choice-chip--active' : ''}`}
              >
                <input
                  className="layer-pill__input"
                  type="radio"
                  name="variable"
                  checked={isActive}
                  onChange={() => setActiveScalar(variableId)}
                />
                <span>{meta.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
    </section>
  )
}

export default LayerPanel
