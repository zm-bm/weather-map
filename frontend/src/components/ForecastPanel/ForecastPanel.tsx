import { getUnitDisplay, getUnitOptionForSystem } from '../../units'
import { useLoadedForecastSelectionContext } from '../../forecast-selection/ForecastSelectionContext'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import { useMapProbe } from '../../map-probe/context'
import { useProbeValue } from '../../map-probe/useProbeValue'
import ForecastControls from '../ForecastControls'

function formatCoordinate(value: number) {
  return value.toFixed(2)
}

function formatProbeValue(value: number | null) {
  if (value == null) return 'No data'

  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded
}

function ForecastPanel() {
  const { activeScalar, variableMeta, unitSystem } = useLoadedForecastSelectionContext()
  const { lastProbe } = useMapProbe()
  const { value: rawProbeValue, loading: probeLoading } = useProbeValue(activeScalar)
  const probeMeta = getScalarMeta(activeScalar, variableMeta)
  const probeUnitDisplay = probeMeta == null ? null : getUnitDisplay(probeMeta)

  const probeUnitOption = probeMeta == null || probeUnitDisplay == null
    ? null
    : getUnitOptionForSystem(
      probeUnitDisplay,
      unitSystem
    )
  const convertedProbeValue = rawProbeValue == null || probeUnitOption == null
    ? rawProbeValue
    : probeUnitOption.convert(rawProbeValue)

  const probeValueText = probeLoading ? 'Loading' : formatProbeValue(convertedProbeValue)

  return (
    <section className="forecast-panel wm-panel-shell" aria-label="Local forecast panel">
      <div className="forecast-panel__header wm-titlebar">
        <ForecastControls />
      </div>

      {lastProbe != null && (
        <div className="forecast-panel__body">
          <div className="forecast-panel__readout">
            <span className="forecast-panel__label wm-mono-caps">Lat / Lon</span>
            <strong className="forecast-panel__value wm-display-caps">
              {`${formatCoordinate(lastProbe.lat)} / ${formatCoordinate(lastProbe.lon)}`}
            </strong>
          </div>

          <div className="forecast-panel__readout">
            <span className="forecast-panel__label wm-mono-caps">Value</span>
            <strong className="forecast-panel__value wm-display-caps">
              {`${probeValueText}${convertedProbeValue != null && probeUnitOption?.buttonLabel ? ` ${probeUnitOption.buttonLabel}` : ''}`}
            </strong>
          </div>
        </div>
      )}
    </section>
  )
}

export default ForecastPanel
