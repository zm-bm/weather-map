import type { ScalarVariableId } from '../../manifest'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import { useLoadedForecastSelectionContext } from '../../forecast-selection/ForecastSelectionContext'
import {
  formatUnitLabel,
  getUnitDisplay,
  getUnitOption,
} from '../../units'

function ProductPanel() {
  const {
    scalarVariables,
    activeScalar,
    variableMeta,
    setActiveScalar,
    getScalarUnitOptionId,
    setScalarUnitOptionId,
  } = useLoadedForecastSelectionContext()
  const scalarMeta = getScalarMeta(activeScalar, variableMeta)
  const scalarUnitDisplay = getUnitDisplay(scalarMeta)
  const scalarUnitOption = getUnitOption(
    scalarUnitDisplay,
    getScalarUnitOptionId(scalarMeta.id, scalarUnitDisplay.defaultOptionId)
  )
  const canSelectScalarUnits = scalarUnitDisplay.options.length > 1

  return (
    <section className="product-panel wm-module-shell lower-third__module" aria-label="Product panel">
      <div className="product-panel__body">
        <div className="product-panel__console lower-third__console">
          <div className="product-panel__field product-panel__field--plate">
            <span className="product-panel__label wm-mono-caps">Model</span>
            <a
              className="product-panel__detail product-panel__detail-link wm-mono-caps"
              href="https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast"
              target="_blank"
              rel="noreferrer"
            >
              GFS
            </a>
          </div>

          <div className="product-panel__field product-panel__field--row">
            <span className="product-panel__label wm-mono-caps">Layer</span>
            <div className="product-panel__control-row">
              <select
                className="product-panel__select product-panel__select--layer"
                aria-label="Scalar layer"
                value={activeScalar}
                onChange={(event) => setActiveScalar(event.currentTarget.value as ScalarVariableId)}
              >
                {scalarVariables.map((variableId) => {
                  const meta = getScalarMeta(variableId, variableMeta)

                  return (
                    <option key={variableId} value={variableId}>
                      {meta.label}
                    </option>
                  )
                })}
              </select>

              {canSelectScalarUnits ? (
                <select
                  className="product-panel__select product-panel__select--unit"
                  aria-label="Scalar units"
                  value={scalarUnitOption.id}
                  onChange={(event) => setScalarUnitOptionId(scalarMeta.id, event.currentTarget.value)}
                >
                  {scalarUnitDisplay.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {formatUnitLabel(option.buttonLabel)}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={`product-panel__readout product-panel__readout--unit${scalarUnitOption.casing === 'literal' ? ' product-panel__readout--literal' : ''}`}
                  aria-label={`Scalar units ${scalarUnitOption.units}`}
                >
                  {formatUnitLabel(scalarUnitOption.buttonLabel)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default ProductPanel
