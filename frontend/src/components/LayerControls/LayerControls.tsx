import { cycleLabel as formatCycleLabel } from '../../map/time/format'
import { useLoadedVariableContext } from '../../state/VariableContext'
import { getScalarLayerMeta } from '../../map/scalar'

function LayerControls() {
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
    <section className="control-dock wm-panel-shell" aria-label="Weather controls">
      <div className="control-dock__header wm-titlebar">
        <span className="control-dock__eyebrow wm-eyebrow">Weather Map</span>
        <strong className="control-dock__title wm-display-caps">{activeScalarMeta.label}</strong>
        <span className="control-dock__subtitle wm-mono-meta">
          {cycleText ?? 'Forecast view'}
        </span>
      </div>

      <fieldset className="control-section">
        <legend className="control-section__legend wm-eyebrow">Variable</legend>
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

export default LayerControls
