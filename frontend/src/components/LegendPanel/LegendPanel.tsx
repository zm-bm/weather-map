import { useLoadedForecastSelectionContext } from '../../forecast-selection'
import { getLayerMeta } from '../../forecast-catalog'
import {
  canToggleUnitSystem,
  getUnitDisplay,
  getUnitOptionForSystem,
} from '../../units'
import { LegendPanelView } from './LegendPanelView'

export default function LegendPanel() {
  const { manifest, selectedLayerId, layers, unitSystem, toggleUnitSystem } = useLoadedForecastSelectionContext()
  if (selectedLayerId == null) return null

  const meta = getLayerMeta(selectedLayerId, layers, manifest)
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
