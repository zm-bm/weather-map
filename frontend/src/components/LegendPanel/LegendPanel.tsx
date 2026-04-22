import { getScalarLayerMeta } from '../../map/scalar'
import { useLoadedProductContext } from '../../state/ProductContext'
import { getLegendUnitDisplay, getLegendUnitOption } from './legendFormatting'
import { LegendPanelView } from './LegendPanelView'

export default function LegendPanel() {
  const { activeScalar, variableMeta, getScalarUnitOptionId, setScalarUnitOptionId } = useLoadedProductContext()
  const meta = getScalarLayerMeta(activeScalar, variableMeta)
  const unitDisplay = getLegendUnitDisplay(meta)
  const selectedOption = getLegendUnitOption(
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
