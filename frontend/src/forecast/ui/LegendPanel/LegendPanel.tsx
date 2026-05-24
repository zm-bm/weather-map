import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import { getLayerDisplay } from '@/forecast/catalog'
import {
  canToggleUnitSystem,
  getUnitDisplay,
  getUnitOptionForSystem,
} from '@/forecast/units'
import { LegendPanelView } from './LegendPanelView'

export default function LegendPanel() {
  const { activeRun, selectedLayerId, layers } = useLoadedForecastSelectionContext()
  const {
    settings,
    actions,
  } = useForecastSettings()
  if (selectedLayerId == null) return null

  const display = getLayerDisplay(selectedLayerId, layers, activeRun)
  const unitDisplay = getUnitDisplay(display.unitBehavior)
  const selectedOption = getUnitOptionForSystem(unitDisplay, settings.units.system)
  const canCycleUnits = canToggleUnitSystem(unitDisplay)

  const handleCycleUnits = () => {
    if (!canCycleUnits) return
    actions.toggleUnitSystem()
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
