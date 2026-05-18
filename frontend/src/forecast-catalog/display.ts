import type {
  ActiveForecastRun,
  LayerColortableStop,
} from '../forecast-manifest'
import { getActiveRunArtifact } from '../forecast-manifest'
import {
  getLayerSpec,
  layerSourceArtifactId,
  layerSourceExpectedArtifactKind,
  type LegendScaleId,
  type LayerId,
  type LayerSpec,
  type UnitBehaviorId,
} from './layer'

export type LayerMeta = {
  id: string
  label: string
  units: string
  parameter: string
  min: number
  max: number
  paletteId: string
  unitBehavior: UnitBehaviorId
  legendScale: LegendScaleId
  colortable: LayerColortableStop[]
}

type LayerStyleEntry = {
  colortable: LayerColortableStop[]
}

const fahrenheitToCelsius = (value: number) => ((value - 32) * 5) / 9

const TEMPERATURE_COLORTABLE: LayerColortableStop[] = [
  [fahrenheitToCelsius(120), 61, 2, 22],
  [fahrenheitToCelsius(115), 86, 12, 37],
  [fahrenheitToCelsius(110), 110, 21, 49],
  [fahrenheitToCelsius(105), 135, 32, 62],
  [fahrenheitToCelsius(100), 159, 41, 76],
  [fahrenheitToCelsius(95), 175, 77, 76],
  [fahrenheitToCelsius(90), 190, 112, 76],
  [fahrenheitToCelsius(85), 195, 138, 83],
  [fahrenheitToCelsius(80), 193, 157, 97],
  [fahrenheitToCelsius(75), 194, 171, 117],
  [fahrenheitToCelsius(70), 171, 168, 125],
  [fahrenheitToCelsius(65), 135, 154, 132],
  [fahrenheitToCelsius(60), 100, 141, 137],
  [fahrenheitToCelsius(55), 67, 129, 144],
  [fahrenheitToCelsius(50), 40, 117, 147],
  [fahrenheitToCelsius(45), 39, 103, 138],
  [fahrenheitToCelsius(40), 38, 92, 130],
  [fahrenheitToCelsius(35), 37, 79, 119],
  [fahrenheitToCelsius(30), 38, 67, 111],
  [fahrenheitToCelsius(25), 47, 71, 117],
  [fahrenheitToCelsius(20), 57, 81, 127],
  [fahrenheitToCelsius(15), 65, 92, 135],
  [fahrenheitToCelsius(10), 77, 101, 145],
  [fahrenheitToCelsius(5), 86, 113, 156],
  [fahrenheitToCelsius(0), 96, 123, 166],
  [fahrenheitToCelsius(-5), 117, 145, 185],
  [fahrenheitToCelsius(-10), 127, 155, 195],
  [fahrenheitToCelsius(-15), 138, 164, 205],
  [fahrenheitToCelsius(-20), 147, 177, 215],
  [fahrenheitToCelsius(-25), 156, 184, 223],
  [fahrenheitToCelsius(-30), 167, 191, 227],
  [fahrenheitToCelsius(-35), 175, 198, 230],
  [fahrenheitToCelsius(-40), 184, 205, 234],
  [fahrenheitToCelsius(-45), 192, 212, 237],
  [fahrenheitToCelsius(-50), 203, 219, 244],
]

const LAYER_PALETTES: Record<string, LayerStyleEntry> = {
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
  'precip.rate.snow.mm_hr.v1': {
    colortable: [
      [0, 180, 180, 180],
      [0.15, 226, 244, 250],
      [0.3, 202, 238, 255],
      [0.45, 172, 229, 255],
      [0.75, 136, 218, 250],
      [1.5, 96, 204, 238],
      [3, 62, 180, 222],
      [4.5, 42, 154, 200],
      [7.5, 30, 126, 176],
      [12, 22, 98, 148],
      [16.5, 16, 76, 126],
      [21, 12, 60, 108],
      [25, 10, 48, 92],
      [30, 8, 38, 76],
    ],
  },
  'precip.rate.wintry_mix.mm_hr.v1': {
    colortable: [
      [0, 180, 180, 180],
      [0.15, 220, 199, 235],
      [0.3, 204, 158, 230],
      [0.45, 189, 122, 220],
      [0.75, 168, 92, 204],
      [1.5, 143, 70, 184],
      [3, 117, 51, 158],
      [4.5, 96, 42, 138],
      [7.5, 74, 32, 112],
      [12, 58, 25, 90],
      [16.5, 46, 18, 72],
      [21, 38, 15, 60],
      [25, 30, 12, 48],
      [30, 24, 8, 38],
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
      [250, 180, 40, 140],
    ],
  },
  'snow.depth.m.v1': {
    colortable: [
      [0, 180, 180, 180],
      [0.05, 210, 230, 245],
      [0.1, 188, 220, 244],
      [0.25, 154, 199, 236],
      [0.5, 116, 174, 224],
      [1, 87, 146, 206],
      [2, 74, 112, 184],
      [3, 90, 82, 164],
      [5, 118, 60, 150],
    ],
  },
  'atmosphere.visibility.m.v1': {
    colortable: [
      [0, 120, 118, 116],
      [500, 165, 100, 90],
      [1000, 204, 128, 78],
      [2000, 222, 174, 92],
      [5000, 205, 210, 118],
      [10000, 140, 204, 170],
      [20000, 96, 172, 206],
      [50000, 72, 126, 190],
    ],
  },
  'atmosphere.freezing_level.m.v1': {
    colortable: [
      [0, 70, 118, 180],
      [500, 75, 162, 210],
      [1000, 96, 198, 190],
      [1500, 148, 214, 128],
      [2500, 220, 210, 94],
      [3500, 238, 160, 76],
      [5000, 220, 92, 86],
      [6500, 172, 72, 142],
      [8000, 112, 64, 158],
    ],
  },
  'atmosphere.precipitable_water.mm.v1': {
    colortable: [
      [0, 174, 168, 138],
      [5, 202, 199, 154],
      [10, 164, 204, 180],
      [20, 98, 186, 202],
      [30, 78, 162, 214],
      [40, 96, 184, 134],
      [50, 210, 202, 76],
      [65, 232, 132, 70],
      [80, 174, 64, 132],
    ],
  },
  'severe.cape.jkg.v1': {
    colortable: [
      [0, 174, 176, 172],
      [250, 142, 190, 118],
      [500, 198, 210, 92],
      [1000, 236, 186, 70],
      [1500, 238, 130, 64],
      [2500, 214, 76, 82],
      [3500, 176, 58, 130],
      [5000, 104, 50, 156],
    ],
  },
}

export function getLayerMeta(
  layerId: LayerId | string,
  layersById: Record<string, LayerSpec>,
  activeRun: ActiveForecastRun,
): LayerMeta {
  const layer = getLayerSpec(layerId, layersById)
  const sourceArtifactId = layerSourceArtifactId(layer.source)
  const sourceMeta = getActiveRunArtifact(activeRun, String(sourceArtifactId))
  const style = getLayerStyleByPaletteId(layer.paletteId)

  if (!sourceMeta) {
    return {
      id: String(layerId),
      label: layer.label,
      units: '',
      parameter: layer.parameter ?? '',
      min: layer.displayRange.min,
      max: layer.displayRange.max,
      paletteId: layer.paletteId,
      unitBehavior: layer.unitBehavior,
      legendScale: layer.legendScale,
      colortable: style.colortable,
    }
  }

  const expectedKind = layerSourceExpectedArtifactKind(layer.source)
  if (sourceMeta.kind !== expectedKind) {
    throw new Error(`Artifact metadata for layer ${layerId} is not ${expectedKind} (got ${sourceMeta.kind})`)
  }

  return {
    id: String(layerId),
    label: layer.label,
    units: sourceMeta.units,
    parameter: layer.parameter ?? sourceMeta.parameter,
    min: layer.displayRange.min,
    max: layer.displayRange.max,
    paletteId: layer.paletteId,
    unitBehavior: layer.unitBehavior,
    legendScale: layer.legendScale,
    colortable: style.colortable,
  }
}

export function getLayerStyleByPaletteId(paletteId: string): LayerStyleEntry {
  const style = LAYER_PALETTES[paletteId]
  if (!style) {
    throw new Error(`Unknown layer paletteId: ${paletteId}`)
  }
  return style
}
