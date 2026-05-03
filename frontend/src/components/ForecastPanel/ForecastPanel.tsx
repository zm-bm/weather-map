import { forwardRef } from 'react'

import { formatCycleRunTimeLabel } from '../../forecast-time'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import { useLoadedForecastSelectionContext } from '../../forecast-selection'
import {
  getForecastModelLabel,
  type ForecastModelId,
  type ForecastModelOption,
} from '../../forecast-models'
import type { CycleManifest, ScalarVariableId } from '../../manifest'

type ScalarVariableGroup = CycleManifest['scalarVariableGroups'][number]

type ForecastPanelProps = {
  activeModelId: ForecastModelId
  modelOptions: readonly ForecastModelOption[]
  onActiveModelChange: (modelId: ForecastModelId) => void
}

const CATEGORY_BUTTON_LABELS: Record<string, string> = {
  temperature: 'Temp',
  precipitation: 'Precip',
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

const ForecastPanel = forwardRef<HTMLElement, ForecastPanelProps>(function ForecastPanel({
  activeModelId,
  modelOptions,
  onActiveModelChange,
}, ref) {
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
  const activeModelLabel = getForecastModelLabel(activeModelId)

  return (
    <section ref={ref} className="forecast-panel wm-panel-shell" aria-label="Local forecast panel">
      <div className="forecast-controls" aria-label="Forecast controls">
        <div
          className="forecast-controls__meta wm-mono-caps"
          aria-label={`Forecast model ${activeModelLabel}, forecast cycle initialized ${runTime}`}
          title={`Forecast cycle initialized ${runTime}`}
        >
          <select
            className="forecast-controls__quiet-select forecast-controls__model-select"
            aria-label="Forecast model"
            value={activeModelId}
            onChange={(event) => onActiveModelChange(event.currentTarget.value as ForecastModelId)}
          >
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
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
