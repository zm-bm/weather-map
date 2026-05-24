import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import {
  activeForecastRunForModel,
  getLayerModelAvailability,
  modelOptionsFromManifest,
  type ForecastModelId,
  type Manifest,
} from '@/forecast/manifest'
import { ForecastTimeProvider } from '@/forecast/time'
import {
  asParticleLayerId,
  asLayerId,
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
} from '@/forecast/catalog'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '@/forecast/selection'
import type { UnitSystem } from '@/forecast/units'
import { createActiveRunFixture } from './manifest'


type ForecastSelectionContextOptions = Partial<{
  selectedLayerId: string
  selectedParticleLayerId: string
  unitSystem: UnitSystem
}>

export function createForecastSelectionContextValue(
  manifest: Manifest | null,
  options: ForecastSelectionContextOptions = {},
  activeModelId: ForecastModelId | null = 'gfs',
): ForecastSelectionContextValue {
  const activeRun = activeForecastRunForModel(manifest, activeModelId)
  const shared = {
    modelOptions: modelOptionsFromManifest(manifest),
    unitSystem: options.unitSystem ?? ('imperial' as UnitSystem),
    setActiveModel: vi.fn(),
    setSelectedLayerGroup: vi.fn(),
    setSelectedLayer: vi.fn(),
    setSelectedParticleLayer: vi.fn(),
    setUnitSystem: vi.fn(),
    toggleUnitSystem: vi.fn(),
  }
  const particleLayers = activeRun == null ? null : getAvailableParticleLayers(activeRun)
  const defaultParticleLayer = particleLayers == null ? null : getDefaultParticleLayer(particleLayers)
  const selectedLayerId = options.selectedLayerId
    ? asLayerId(options.selectedLayerId)
    : FORECAST_LAYER_GROUPS[0]?.defaultLayer ?? null
  const selectedLayerAvailability =
    activeRun != null && selectedLayerId != null
      ? getLayerModelAvailability(activeRun.manifest, selectedLayerId, activeRun.modelId)
      : null
  const selectedLayerIsRenderable = selectedLayerAvailability?.state === 'available'
  const selectedLayerGroupId = selectedLayerId == null
    ? null
    : FORECAST_LAYER_GROUPS.find((group) => group.layers.includes(selectedLayerId))?.id ?? null

  return (
    activeRun == null
      ? {
          activeRun: null,
          groups: [],
          layers: null,
          particleLayers: null,
          selectedLayerGroupId: null,
          selectedLayerId: null,
          selectedLayerAvailability: null,
          selectedLayerIsRenderable: false,
          selectedParticleLayerId: null,
          ...shared,
        }
      : {
          activeRun,
          groups: [...FORECAST_LAYER_GROUPS],
          layers: FORECAST_LAYERS_BY_ID,
          particleLayers: particleLayers!,
          selectedLayerGroupId,
          selectedLayerId,
          selectedLayerAvailability,
          selectedLayerIsRenderable,
          selectedParticleLayerId: options.selectedParticleLayerId
            ? asParticleLayerId(options.selectedParticleLayerId)
            : defaultParticleLayer,
          ...shared,
        }
  ) satisfies ForecastSelectionContextValue
}

export function renderWithForecastSelection(
  ui: ReactNode,
  manifest: Manifest,
  activeModelId: ForecastModelId = 'gfs'
) {
  const activeRun = createActiveRunFixture(manifest, activeModelId)
  return render(
    <ForecastSelectionProvider
      activeRun={activeRun}
      modelOptions={[{
        id: activeModelId,
        label: activeRun.label,
      }]}
    >
      <ForecastTimeProvider activeRun={activeRun}>
        {ui}
      </ForecastTimeProvider>
    </ForecastSelectionProvider>
  )
}
