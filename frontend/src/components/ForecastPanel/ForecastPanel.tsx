import { forwardRef } from 'react'

import { formatCycleRunTimeLabel } from '../../forecast-time'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import { useLoadedForecastSelectionContext } from '../../forecast-selection'
import type { CycleManifest, ScalarVariableId } from '../../manifest'

type ScalarVariableGroup = CycleManifest['scalarVariableGroups'][number]

const CATEGORY_BUTTON_LABELS: Record<string, string> = {
  temperature: 'Temp',
  precipitation: 'Precip',
}

function ignorePlaceholderControlChange() {
  return undefined
}

function getActiveScalarGroup(
  scalarVariableGroups: CycleManifest['scalarVariableGroups'],
  activeScalar: ScalarVariableId
): ScalarVariableGroup {
  return scalarVariableGroups.find((group) => group.variables.includes(activeScalar))
    ?? scalarVariableGroups[0]
}

function formatCategoryButtonLabel(group: ScalarVariableGroup): string {
  return CATEGORY_BUTTON_LABELS[group.id] ?? group.label
}

function formatModelRunLabel(runTime: string): string {
  return runTime === '--' ? 'CYCLE --' : `CYCLE ${runTime.replace(',', '').toUpperCase()}`
}

const ForecastPanel = forwardRef<HTMLElement>(function ForecastPanel(_props, ref) {
  const {
    cycle,
    scalarVariableGroups,
    activeScalar,
    variableMeta,
    setActiveScalar,
  } = useLoadedForecastSelectionContext()
  const runTime = formatCycleRunTimeLabel(cycle) ?? '--'
  const runLabel = formatModelRunLabel(runTime)
  const activeScalarGroup = getActiveScalarGroup(scalarVariableGroups, activeScalar)

  return (
    <section ref={ref} className="forecast-panel wm-panel-shell" aria-label="Local forecast panel">
      <div className="forecast-controls" aria-label="Forecast controls">
        <div
          className="forecast-controls__meta wm-mono-caps"
          aria-label={`Forecast model GFS, forecast cycle initialized ${runTime}`}
          title={`Forecast cycle initialized ${runTime}`}
        >
          <select
            className="forecast-controls__quiet-select forecast-controls__model-select"
            aria-label="Forecast model"
            value="gfs"
            onChange={ignorePlaceholderControlChange}
          >
            <option value="gfs">GFS</option>
          </select>
          <span className="forecast-controls__run">{runLabel}</span>
        </div>

        <div
          className={
            scalarVariableGroups.length === 1
              ? 'forecast-controls__category-tabs forecast-controls__category-tabs--single'
              : 'forecast-controls__category-tabs'
          }
          aria-label="Category"
        >
          {scalarVariableGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              className="forecast-controls__category-tab wm-mono-caps"
              aria-label={group.label}
              aria-pressed={group.id === activeScalarGroup.id}
              title={group.label}
              onClick={() => setActiveScalar(group.defaultVariable)}
            >
              {formatCategoryButtonLabel(group)}
            </button>
          ))}
        </div>

        <select
          className="forecast-controls__select forecast-controls__measurement-select"
          aria-label="Measurement"
          value={activeScalar}
          onChange={(event) => setActiveScalar(event.currentTarget.value as ScalarVariableId)}
        >
          {activeScalarGroup.variables.map((variableId) => {
            const meta = getScalarMeta(variableId, variableMeta)

            return (
              <option key={variableId} value={variableId}>
                {meta.label}
              </option>
            )
          })}
        </select>
      </div>
    </section>
  )
})

export default ForecastPanel
