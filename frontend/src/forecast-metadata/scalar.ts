import type {
  LayerColortableStop,
  ManifestProductSpec,
} from '../manifest'

export type ScalarMeta = {
  id: string
  label: string
  units: string
  parameter: string
  min: number
  max: number
  paletteId: string
  colortable: LayerColortableStop[]
  legendKind?: 'cloud_layers'
  cloudLayerSwatches?: CloudLayerLegendSwatch[]
}

type ScalarStyleEntry = {
  colortable: LayerColortableStop[]
  legendKind?: 'cloud_layers'
  cloudLayerSwatches?: CloudLayerLegendSwatch[]
}

export type CloudLayerLegendSwatch = {
  id: 'low' | 'medium' | 'high'
  label: string
  color: string
}

const TEMPERATURE_COLORTABLE: LayerColortableStop[] = [
  [50, 61, 2, 22],
  [47.5, 86, 12, 37],
  [44.7, 110, 21, 49],
  [41.9, 135, 32, 62],
  [39.2, 159, 41, 76],
  [36.4, 175, 77, 76],
  [33.6, 190, 112, 76],
  [30.8, 195, 138, 83],
  [28.1, 193, 157, 97],
  [25.3, 194, 171, 117],
  [22.5, 171, 168, 125],
  [19.7, 135, 154, 132],
  [16.9, 100, 141, 137],
  [14.2, 67, 129, 144],
  [11.4, 40, 117, 147],
  [8.6, 39, 103, 138],
  [5.8, 38, 92, 130],
  [3.1, 37, 79, 119],
  [0.3, 38, 67, 111],
  [-2.5, 47, 71, 117],
  [-5.3, 57, 81, 127],
  [-8.1, 65, 92, 135],
  [-10.8, 77, 101, 145],
  [-13.6, 86, 113, 156],
  [-16.4, 96, 123, 166],
  [-19.2, 117, 145, 185],
  [-21.9, 127, 155, 195],
  [-24.7, 138, 164, 205],
  [-27.5, 147, 177, 215],
  [-30.3, 156, 184, 223],
  [-33.1, 167, 191, 227],
  [-35.8, 175, 198, 230],
  [-38.6, 184, 205, 234],
  [-41.4, 192, 212, 237],
  [-45.0, 203, 219, 244],
]

const SCALAR_PALETTES: Record<string, ScalarStyleEntry> = {
  'temperature.air.c.v1': {
    colortable: TEMPERATURE_COLORTABLE,
  },
  'moisture.relative_humidity.percent.v1': {
    colortable: [
      [0, 218, 192, 146],
      [10, 232, 214, 171],
      [20, 244, 234, 196],
      [30, 230, 238, 202],
      [40, 196, 232, 203],
      [50, 153, 220, 206],
      [60, 105, 201, 212],
      [70, 67, 173, 214],
      [80, 44, 141, 205],
      [90, 29, 101, 176],
      [100, 19, 72, 140],
    ],
  },
  'wind.gust.mps.v1': {
    colortable: [
      [0, 200, 210, 215],
      [4, 148, 199, 213],
      [8, 96, 185, 185],
      [12, 72, 172, 132],
      [16, 112, 184, 86],
      [20, 184, 198, 68],
      [25, 232, 182, 64],
      [30, 238, 128, 55],
      [35, 220, 74, 64],
      [45, 174, 49, 105],
      [60, 110, 42, 150],
    ],
  },
  'temperature.dewpoint.c.v1': {
    colortable: [
      [-60, 98, 81, 140],
      [-45, 95, 112, 182],
      [-30, 82, 151, 202],
      [-20, 72, 177, 194],
      [-10, 82, 190, 155],
      [0, 116, 197, 108],
      [8, 165, 203, 88],
      [14, 210, 203, 82],
      [18, 233, 178, 76],
      [22, 235, 134, 75],
      [26, 213, 88, 94],
      [30, 166, 63, 119],
      [40, 94, 53, 126],
    ],
  },
  'cloud.cover.percent.v1': {
    colortable: [
      [0, 180, 180, 180],
      [5, 170, 185, 200],
      [10, 150, 185, 210],
      [15, 135, 180, 215],
      [20, 120, 175, 220],
      [30, 110, 170, 215],
      [40, 100, 165, 210],
      [50, 90, 160, 205],
      [60, 80, 155, 200],
      [70, 75, 150, 195],
      [80, 70, 145, 190],
      [90, 65, 135, 180],
      [100, 60, 120, 170],
    ],
  },
  'cloud.layers.percent.v1': {
    legendKind: 'cloud_layers',
    cloudLayerSwatches: [
      { id: 'low', label: 'Low', color: 'rgb(110 105 89)' },
      { id: 'medium', label: 'Mid', color: 'rgb(255 240 163)' },
      { id: 'high', label: 'High', color: 'rgb(20 107 255)' },
    ],
    colortable: [
      [0, 180, 180, 180],
      [25, 120, 175, 220],
      [50, 90, 160, 205],
      [75, 72, 148, 192],
      [100, 60, 120, 170],
    ],
  },
  'pressure.msl.pa.v1': {
    colortable: [
      [98000, 70, 155, 225],
      [98400, 82, 182, 230],
      [98800, 98, 205, 228],
      [99200, 122, 220, 220],
      [99600, 155, 230, 210],
      [100000, 188, 236, 214],
      [100400, 206, 238, 220],
      [100700, 222, 236, 216],
      [101000, 238, 230, 202],
      [101300, 248, 220, 178],
      [101600, 245, 205, 155],
      [101900, 240, 188, 132],
      [102200, 234, 170, 112],
      [102500, 227, 150, 96],
      [102800, 218, 128, 82],
      [103100, 206, 108, 72],
      [103500, 188, 88, 66],
    ],
  },
  'precip.rate.mm_hr.v1': {
    colortable: [
      [0, 180, 180, 180],
      [0.15, 200, 210, 240],
      [0.3, 160, 190, 255],
      [0.45, 120, 170, 255],
      [0.75, 80, 150, 255],
      [1.5, 60, 170, 220],
      [3, 60, 200, 160],
      [4.5, 100, 220, 100],
      [7.5, 160, 230, 80],
      [12, 220, 220, 60],
      [16.5, 255, 180, 60],
      [21, 255, 120, 60],
      [25, 255, 70, 70],
      [30, 180, 40, 140],
    ],
  },
  'precip.total.mm.v1': {
    colortable: [
      [0, 180, 180, 180],
      [1, 200, 210, 240],
      [2, 160, 190, 255],
      [5, 120, 170, 255],
      [10, 60, 170, 220],
      [25, 60, 200, 160],
      [50, 160, 230, 80],
      [100, 255, 180, 60],
      [150, 255, 100, 60],
      [254, 180, 40, 140],
    ],
  },
}

export function getScalarMeta(
  variableId: string,
  metaById?: Record<string, ManifestProductSpec> | null,
): ScalarMeta {
  const sourceMeta = metaById?.[variableId]

  if (!sourceMeta) {
    throw new Error(`Missing layer metadata for ${variableId}`)
  }
  if (sourceMeta.style.layerId !== 'scalar') {
    throw new Error(`Layer metadata for ${variableId} is not scalar (got ${sourceMeta.style.layerId})`)
  }

  const style = getScalarStyle(sourceMeta)

  return {
    id: variableId,
    label: sourceMeta.label,
    units: sourceMeta.units,
    parameter: sourceMeta.parameter,
    min: sourceMeta.valueRange.min,
    max: sourceMeta.valueRange.max,
    paletteId: sourceMeta.style.paletteId,
    colortable: style.colortable,
    legendKind: style.legendKind,
    cloudLayerSwatches: style.cloudLayerSwatches,
  }
}

export function getScalarStyle(product: ManifestProductSpec): ScalarStyleEntry {
  return getScalarStyleByPaletteId(product.style.paletteId)
}

export function getScalarStyleByPaletteId(paletteId: string): ScalarStyleEntry {
  const style = SCALAR_PALETTES[paletteId]
  if (!style) {
    throw new Error(`Unknown scalar paletteId: ${paletteId}`)
  }
  return style
}
