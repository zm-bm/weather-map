import { cycleLabel as formatCycleLabel } from '../../map/time/format'
import { getScalarLayerMeta } from '../../map/scalar'
import { useLoadedVariableContext } from '../../state/VariableContext'

function LayerDeck() {
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
    <section className="layer-deck wm-docked-band-shell wm-module-shell lower-third__module" aria-label="Layer deck">
      <div className="layer-deck__titlebar wm-titlebar wm-module-titlebar">
        <span className="layer-deck__eyebrow wm-eyebrow">Map Layer</span>
      </div>

      <div className="layer-deck__body">
        <div className="layer-deck__meta">
          <span className="layer-deck__label wm-mono-caps">Current Layer</span>
          <strong className="wm-display-caps wm-text-truncate">{activeScalarMeta.label}</strong>
          <span className="layer-deck__detail wm-mono-meta wm-text-truncate">
            {cycleText ?? 'Forecast view'}
          </span>
        </div>

        <div className="layer-deck__pill-list">
          {scalarVariables.map((variableId) => {
            const meta = getScalarLayerMeta(variableId, variableMeta)
            const isActive = activeScalar === variableId

            return (
              <label
                key={variableId}
                className={`layer-deck__pill wm-bevel-button wm-choice-chip ${isActive ? 'layer-deck__pill--active wm-choice-chip--active' : ''}`}
              >
                <input
                  className="layer-deck__input"
                  type="radio"
                  name="layer-deck-variable"
                  checked={isActive}
                  onChange={() => setActiveScalar(variableId)}
                />
                <span>{meta.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default LayerDeck
