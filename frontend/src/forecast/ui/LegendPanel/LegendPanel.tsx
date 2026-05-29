import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import {
  getForecastRasterLayer,
  getForecastRasterLayerArtifact,
  type ForecastRasterLayer,
} from '@/forecast/catalog'
import type { ActiveForecastRun } from '@/forecast/manifest'
import {
  getRasterPalette,
  samplePaletteColor,
} from '@/forecast/palette'
import {
  canToggleUnitSystem,
  getUnitDisplay,
  getUnitOptionForSystem,
} from '@/forecast/units'
import {
  LegendPanelView,
  type LegendPanelDisplay,
  type LegendRasterBandDisplay,
} from './LegendPanelView'

export default function LegendPanel() {
  const { activeRun, selectedLayerId } = useLoadedForecastSelectionContext()
  const {
    settings,
    actions,
  } = useForecastSettings()
  if (selectedLayerId == null) return null

  const layer = getForecastRasterLayer(selectedLayerId)
  if (layer == null) return null

  const display = createLegendPanelDisplay(layer, activeRun)
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
      colorSamplingMode={settings.raster.colorSamplingMode}
      canCycleUnits={canCycleUnits}
      onCycleUnits={handleCycleUnits}
    />
  )
}

function createLegendPanelDisplay(
  layer: ForecastRasterLayer,
  activeRun: ActiveForecastRun,
): LegendPanelDisplay {
  const sourceMeta = getForecastRasterLayerArtifact(activeRun, layer)
  const paletteId = layer.source.bands[0].paletteId
  const palette = getRasterPalette(paletteId)

  return {
    id: layer.id,
    label: layer.display.label,
    units: sourceMeta?.units ?? '',
    parameter: layer.display.parameter ?? sourceMeta?.parameter ?? '',
    min: layer.display.range.min,
    max: layer.display.range.max,
    paletteId,
    unitBehavior: layer.display.unitBehavior,
    legendScale: layer.display.legendScale,
    stops: palette.stops,
    rasterBands: rasterBandDisplays(layer),
  }
}

function rasterBandDisplays(layer: ForecastRasterLayer): LegendRasterBandDisplay[] {
  return layer.source.bands.map((band) => ({
    id: band.id,
    paletteId: band.paletteId,
    color: samplePaletteColor(getRasterPalette(band.paletteId).stops, 100, 'interpolated'),
  }))
}
