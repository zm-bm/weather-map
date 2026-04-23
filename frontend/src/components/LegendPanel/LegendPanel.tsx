import { useLoadedForecastSelectionContext } from '../../forecast-selection/ForecastSelectionContext'
import { getScalarMeta } from '../../forecast-metadata/scalar'
import { getUnitDisplay, getUnitOption } from '../../units'
import { LegendPanelView } from './LegendPanelView'

export default function LegendPanel() {
  const { activeScalar, variableMeta, getScalarUnitOptionId, setScalarUnitOptionId } = useLoadedForecastSelectionContext()
  const meta = getScalarMeta(activeScalar, variableMeta)
  const unitDisplay = getUnitDisplay(meta)
  const selectedOption = getUnitOption(
    unitDisplay,
    getScalarUnitOptionId(meta.id, unitDisplay.defaultOptionId)
  )
  const canCycleUnits = unitDisplay.options.length > 1

  const handleCycleUnits = () => {
    if (!canCycleUnits) return

    const currentIndex = unitDisplay.options.findIndex((option) => option.id === selectedOption.id)
    const nextOption = unitDisplay.options[(currentIndex + 1) % unitDisplay.options.length]
    if (!nextOption) return

    setScalarUnitOptionId(meta.id, nextOption.id)
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
