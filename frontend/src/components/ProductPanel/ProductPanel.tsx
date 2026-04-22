import type { ScalarVariableId } from '../../map/manifest'
import { getScalarLayerMeta } from '../../map/scalar'
import { useLoadedVariableContext } from '../../state/VariableContext'

function ProductPanel() {
  const {
    scalarVariables,
    activeScalar,
    variableMeta,
    setActiveScalar,
  } = useLoadedVariableContext()

  return (
    <section className="product-panel wm-module-shell lower-third__module" aria-label="Product panel">
      <div className="product-panel__titlebar wm-titlebar wm-module-titlebar">
        <span className="product-panel__eyebrow wm-eyebrow">Current Map</span>
      </div>

      <div className="product-panel__body">
        <div className="product-panel__console lower-third__console">
          <div className="product-panel__meta">
            <span className="product-panel__label wm-mono-caps">Model</span>
            <strong className="product-panel__detail wm-mono-caps">GFS Forecast</strong>
          </div>

          <label className="product-panel__field">
            <span className="product-panel__label wm-mono-caps">Current Layer</span>
            <select
              className="product-panel__select"
              aria-label="Current layer"
              value={activeScalar}
              onChange={(event) => setActiveScalar(event.currentTarget.value as ScalarVariableId)}
            >
              {scalarVariables.map((variableId) => {
                const meta = getScalarLayerMeta(variableId, variableMeta)

                return (
                  <option key={variableId} value={variableId}>
                    {meta.label}
                  </option>
                )
              })}
            </select>
          </label>
        </div>
      </div>
    </section>
  )
}

export default ProductPanel
