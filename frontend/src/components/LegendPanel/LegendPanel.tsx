import { getScalarLayerMeta } from '../../map/scalar'
import { useLoadedVariableContext } from '../../state/VariableContext'
import { LegendPanelView } from './LegendPanelView'

export default function LegendPanel() {
  const { activeScalar, variableMeta } = useLoadedVariableContext()
  const meta = getScalarLayerMeta(activeScalar, variableMeta)

  return <LegendPanelView meta={meta} />
}
