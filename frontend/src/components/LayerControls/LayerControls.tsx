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
    <section className="control-dock" aria-label="Weather controls">
      <div className="control-dock__header">
        <span className="control-dock__eyebrow">Weather Map</span>
        <strong className="control-dock__title">{activeScalarMeta.label}</strong>
        <span className="control-dock__subtitle">
          {cycleText ?? 'Forecast view'}
        </span>
      </div>

      <fieldset className="control-section">
        <legend className="control-section__legend">Variable</legend>
        <div className="layer-pill-list">
          {scalarVariables.map((variableId) => {
            const meta = getScalarLayerMeta(variableId, variableMeta)

            return (
              <label key={variableId} className={`layer-pill ${activeScalar === variableId ? 'layer-pill--active' : ''}`}>
                <input
                  className="layer-pill__input"
                  type="radio"
                  name="variable"
                  checked={activeScalar === variableId}
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
