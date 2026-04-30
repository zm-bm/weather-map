import { useLoadedForecastSelectionContext } from '../../forecast-selection/ForecastSelectionContext'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import {
  canToggleUnitSystem,
  getUnitDisplay,
  getUnitOptionForSystem,
} from '../../units'
import { LegendPanelView } from './LegendPanelView'

export default function LegendPanel() {
  const { activeScalar, variableMeta, unitSystem, toggleUnitSystem } = useLoadedForecastSelectionContext()
  const meta = getScalarMeta(activeScalar, variableMeta)
  const unitDisplay = getUnitDisplay(meta)
  const selectedOption = getUnitOptionForSystem(unitDisplay, unitSystem)
  const canCycleUnits = canToggleUnitSystem(unitDisplay)

  const handleCycleUnits = () => {
    if (!canCycleUnits) return
    toggleUnitSystem()
  }

  return (
    <LegendPanelView
      meta={meta}
      selectedOption={selectedOption}
      canCycleUnits={canCycleUnits}
      onCycleUnits={handleCycleUnits}
    />
  )
}
