import type { ScalarVariableId } from '../../manifest'
import { formatCycleRunTimeLabel } from '../../forecast-time'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import { useLoadedForecastSelectionContext } from '../../forecast-selection'

function formatCycleHourLabel(cycle: string | null): string {
  const match = /^(\d{8})(\d{2})$/.exec(cycle ?? '')
  return match ? `${match[2]}Z` : '--'
}

function ignorePlaceholderControlChange() {
  return undefined
}

function ForecastControls() {
  const {
    cycle,
    scalarVariables,
    activeScalar,
    variableMeta,
    setActiveScalar,
  } = useLoadedForecastSelectionContext()
  const runTime = formatCycleRunTimeLabel(cycle) ?? '--'
  const runHour = formatCycleHourLabel(cycle)

  return (
    <section className="forecast-controls" aria-label="Forecast controls">
      <div
        className="forecast-controls__meta wm-mono-caps"
        aria-label={`Forecast level Surface, forecast model GFS, model run ${runTime}`}
        title={`Model run ${runTime}`}
      >
        <select
          className="forecast-controls__quiet-select forecast-controls__level-select"
          aria-label="Forecast level"
          value="surface"
          onChange={ignorePlaceholderControlChange}
        >
          <option value="surface">Surface</option>
        </select>
        <select
          className="forecast-controls__quiet-select forecast-controls__model-select"
          aria-label="Forecast model"
          value="gfs"
          onChange={ignorePlaceholderControlChange}
        >
          <option value="gfs">GFS</option>
        </select>
        <span className="forecast-controls__separator" aria-hidden="true">&middot;</span>
        <span className="forecast-controls__run">{runHour}</span>
      </div>

      <select
        className="forecast-controls__select forecast-controls__layer-select"
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
    </section>
  )
}

export default ForecastControls
