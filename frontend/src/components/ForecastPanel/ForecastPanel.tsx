import { validLabel as formatValidLabel } from '../../map/time/format'
import { hourTokenAt, normalizeHourIndex } from '../../map/time/core'
import { getScalarLayerMeta } from '../../map/scalar'
import { useTimelineContext } from '../../state/TimelineContext'
import { useLoadedVariableContext } from '../../state/VariableContext'
import { useMapProbe } from '../../state/MapProbeContext'

function formatCoordinate(value: number) {
  return value.toFixed(2)
}

function formatProbeValue(value: number | null) {
  if (value == null) return 'No data'

  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded
}

function ForecastPanel() {
  const { variableMeta } = useLoadedVariableContext()
  const { cycle, forecastHours, state: timelineState } = useTimelineContext()
  const { lastProbe } = useMapProbe()
  const totalHours = Math.max(1, forecastHours.length)
  const appliedHourIdx = normalizeHourIndex(timelineState.appliedHourIndex, totalHours)
  const appliedHourToken = hourTokenAt(forecastHours, appliedHourIdx)
  const validTimeLabel = formatValidLabel(cycle, appliedHourToken)
  const probeMeta = lastProbe?.variableId == null ? null : getScalarLayerMeta(lastProbe.variableId, variableMeta)
  const probeValueText = lastProbe == null ? 'Click map to sample current layer' : formatProbeValue(lastProbe.value)

  return (
    <section className="forecast-panel wm-panel-shell" aria-label="Local forecast panel">
      <div className="forecast-panel__header wm-titlebar">
        <span className="forecast-panel__eyebrow wm-eyebrow">Local Forecast</span>
        <strong className="forecast-panel__title wm-display-caps">
          {probeMeta?.label ?? 'Click Map'}
        </strong>
      </div>

      <div className="forecast-panel__body">
        <div className="forecast-panel__readout forecast-panel__readout--headline">
          <span className="forecast-panel__label wm-mono-caps">Valid Time</span>
          <strong className="forecast-panel__value forecast-panel__value--headline wm-display-caps">
            {validTimeLabel ?? `Hour ${appliedHourToken}`}
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
              : `${probeValueText}${probeMeta?.units ? ` ${probeMeta.units}` : ''}`}
          </strong>
        </div>
      </div>
    </section>
  )
}

export default ForecastPanel
