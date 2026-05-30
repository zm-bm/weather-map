import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import {
  getForecastRasterLayer,
  type ForecastRasterLayer,
} from '@/forecast/catalog'
import {
  samplePaletteColor,
} from '@/forecast/display/palette'
import {
  LegendPanelView,
  type LegendRasterBandDisplay,
} from './LegendPanelView'

export default function LegendPanel() {
  const { selectedLayerId } = useLoadedForecastSelectionContext()
  const {
    settings,
    actions,
  } = useForecastSettings()
  if (selectedLayerId == null) return null

  const layer = getForecastRasterLayer(selectedLayerId)
  if (layer == null) return null

  return (
    <LegendPanelView
      display={{
        id: layer.id,
        label: layer.display.label,
        profile: layer.display,
        rasterBands: rasterBandDisplays(layer),
      }}
      unitSystem={settings.units.system}
      onCycleUnits={actions.toggleUnitSystem}
    />
  )
}

function rasterBandDisplays(layer: ForecastRasterLayer): LegendRasterBandDisplay[] {
  return layer.source.bands.map((band) => {
    const palette = layer.display.kind === 'cloud-layers'
      ? layer.display.bandPalettes[band.id]
      : layer.display.palette
    if (!palette) {
      throw new Error(`Display profile ${layer.display.label} has no palette for band ${band.id}`)
    }
    return {
      id: band.id,
      color: samplePaletteColor(palette.stops, 100, 'interpolated'),
    }
  })
}
