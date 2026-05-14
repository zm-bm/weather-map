import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { CycleManifest } from '../../manifest'
import {
  asParticleLayerId,
  asLayerId,
  getAvailableGroups,
  getAvailableLayers,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
} from '../../forecast-catalog'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '../../forecast-selection'
import type { UnitSystem } from '../../units'


type ForecastSelectionContextOptions = Partial<{
  selectedLayerId: string
  selectedParticleLayerId: string
  unitSystem: UnitSystem
}>

export function createForecastSelectionContextValue(
  manifest: CycleManifest | null,
  options: ForecastSelectionContextOptions = {}
): ForecastSelectionContextValue {
  const shared = {
    unitSystem: options.unitSystem ?? ('imperial' as UnitSystem),
    setSelectedLayer: vi.fn(),
    setSelectedParticleLayer: vi.fn(),
    setUnitSystem: vi.fn(),
    toggleUnitSystem: vi.fn(),
  }
  const layers = manifest == null ? null : getAvailableLayers(manifest)
  const groups = layers == null ? [] : getAvailableGroups(layers)
  const particleLayers = manifest == null ? null : getAvailableParticleLayers(manifest)
  const defaultParticleLayer = particleLayers == null ? null : getDefaultParticleLayer(particleLayers)

  return (
    manifest == null
      ? {
          manifest: null,
          groups: [],
          layers: null,
          particleLayers: null,
          selectedLayerId: null,
          selectedParticleLayerId: null,
          ...shared,
        }
      : {
          manifest,
          groups,
          layers: layers!,
          particleLayers: particleLayers!,
          selectedLayerId: options.selectedLayerId
            ? asLayerId(options.selectedLayerId)
            : groups[0]?.defaultLayer ?? null,
          selectedParticleLayerId: options.selectedParticleLayerId
            ? asParticleLayerId(options.selectedParticleLayerId)
            : defaultParticleLayer,
          ...shared,
        }
  ) satisfies ForecastSelectionContextValue
}

export function renderWithForecastSelection(
  ui: ReactNode,
  manifest: CycleManifest
) {
  return render(
    <ForecastSelectionProvider manifest={manifest}>
      {ui}
    </ForecastSelectionProvider>
  )
}
