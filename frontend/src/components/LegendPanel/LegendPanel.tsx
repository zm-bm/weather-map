import { useLoadedForecastSelectionContext } from '../../forecast-selection'
import { getLayerDisplay } from '../../forecast-catalog'
import {
  canToggleUnitSystem,
  getUnitDisplay,
  getUnitOptionForSystem,
} from '../../units'
import { LegendPanelView } from './LegendPanelView'

export default function LegendPanel() {
  const { activeRun, selectedLayerId, layers, unitSystem, toggleUnitSystem } = useLoadedForecastSelectionContext()
  if (selectedLayerId == null) return null

  const display = getLayerDisplay(selectedLayerId, layers, activeRun)
  const unitDisplay = getUnitDisplay(display.unitBehavior)
  const selectedOption = getUnitOptionForSystem(unitDisplay, unitSystem)
  const canCycleUnits = canToggleUnitSystem(unitDisplay)

  const handleCycleUnits = () => {
    if (!canCycleUnits) return
    toggleUnitSystem()
  }

  return (
    <LegendPanelView
      display={display}
      selectedOption={selectedOption}
      canCycleUnits={canCycleUnits}
      onCycleUnits={handleCycleUnits}
    />
  )
}
