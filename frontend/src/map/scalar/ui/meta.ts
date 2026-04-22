import type {
  LayerColortableStop,
  ManifestVariableSpec,
} from '../../../manifest'
import {
  getScalarCatalogEntry,
} from './catalog'

export type ScalarLayerMeta = {
  id: string
  label: string
  units: string
  min: number
  max: number
  colortable: LayerColortableStop[]
}

export function getScalarLayerMeta(
  variableId: string,
  metaById?: Record<string, ManifestVariableSpec> | null
): ScalarLayerMeta {
  const sourceMeta = metaById?.[variableId]
  const catalog = getScalarCatalogEntry(variableId)

  if (!sourceMeta) {
    throw new Error(`Missing layer metadata for ${variableId}`)
  }

  return {
    id: variableId,
    label: catalog.label,
    units: catalog.units || sourceMeta.units,
    min: catalog.displayRange[0],
    max: catalog.displayRange[1],
    colortable: catalog.colortable,
  }
}
