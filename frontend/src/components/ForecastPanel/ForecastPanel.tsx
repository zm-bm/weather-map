import { getUnitDisplay, getUnitOption } from '../../units'
import { useLoadedForecastSelectionContext } from '../../forecast-selection/ForecastSelectionContext'
import {
  formatValidTimeLabel,
  useForecastTimeContext,
} from '../../forecast-time'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import { useMapProbe } from '../../map-probe/context'
import { useProbeValue } from '../../map-probe/useProbeValue'

function formatCoordinate(value: number) {
  return value.toFixed(2)
}

function formatProbeValue(value: number | null) {
  if (value == null) return 'No data'

  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded
}

function ForecastPanel() {
  const { activeScalar, variableMeta, getScalarUnitOptionId } = useLoadedForecastSelectionContext()
  const { state: forecastTimeState } = useForecastTimeContext()
  const { lastProbe } = useMapProbe()
  const { value: rawProbeValue, loading: probeLoading } = useProbeValue(activeScalar)
  const validTimeLabel = formatValidTimeLabel(forecastTimeState.appliedTimeMs)
  const probeMeta = getScalarMeta(activeScalar, variableMeta)
  const probeUnitDisplay = probeMeta == null ? null : getUnitDisplay(probeMeta)

  const probeUnitOption = probeMeta == null || probeUnitDisplay == null
    ? null
    : getUnitOption(
      probeUnitDisplay,
      getScalarUnitOptionId(probeMeta.id, probeUnitDisplay.defaultOptionId)
    )
  const convertedProbeValue = rawProbeValue == null || probeUnitOption == null
    ? rawProbeValue
    : probeUnitOption.convert(rawProbeValue)

  const probeValueText = lastProbe == null
    ? 'Click map to sample current layer'
    : probeLoading
      ? 'Loading current layer'
    : formatProbeValue(convertedProbeValue)

  return (
    <section className="forecast-panel wm-panel-shell" aria-label="Local forecast panel">
      <div className="forecast-panel__header wm-titlebar">
        <span className="forecast-panel__eyebrow wm-eyebrow">Local Forecast</span>
        <strong className="forecast-panel__title wm-display-caps">
          {lastProbe == null ? 'Click Map' : (probeMeta?.label ?? activeScalar)}
        </strong>
      </div>

      <div className="forecast-panel__body">
        <div className="forecast-panel__readout forecast-panel__readout--headline">
          <span className="forecast-panel__label wm-mono-caps">Valid Time</span>
          <strong className="forecast-panel__value forecast-panel__value--headline wm-display-caps">
            {validTimeLabel ?? 'Unavailable'}
          </strong>
        </div>

        <div className="forecast-panel__readout">
          <span className="forecast-panel__label wm-mono-caps">Latitude / Longitude</span>
          <strong className="forecast-panel__value wm-display-caps">
            {lastProbe == null
              ? '-- / --'
              : `${formatCoordinate(lastProbe.lat)} / ${formatCoordinate(lastProbe.lon)}`}
          </strong>
        </div>

        <div className="forecast-panel__readout">
          <span className="forecast-panel__label wm-mono-caps">Value</span>
          <strong className="forecast-panel__value wm-display-caps">
            {lastProbe == null
              ? probeValueText
              : `${probeValueText}${convertedProbeValue != null && probeUnitOption?.buttonLabel ? ` ${probeUnitOption.buttonLabel}` : ''}`}
          </strong>
        </div>
      </div>
    </section>
  )
}

export default ForecastPanel
