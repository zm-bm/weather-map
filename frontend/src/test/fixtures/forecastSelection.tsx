import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import {
  activeForecastRunForModel,
  type ForecastModelOption,
  modelOptionsFromManifest,
  type ForecastModelId,
  type Manifest,
} from '@/forecast/manifest'
import {
  getDefaultAvailableParticleLayerId,
  getDefaultRasterLayerId,
} from '@/forecast/catalog'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '@/forecast/selection'
import { ACTIVE_MODEL_STORAGE_KEY } from '@/forecast/selection/activeModelPersistence'
import { ForecastSettingsProvider } from '@/forecast/settings'
import ForecastSelectionFixtureTimeProvider from './ForecastSelectionFixtureTimeProvider'
import { createActiveRunFixture } from './manifest'

type ForecastSelectionContextOptions = Partial<{
  selectedLayerId: string
  selectedParticleLayerId: string
}>

export function createForecastSelectionContextValue(
  manifest: Manifest | null,
  options: ForecastSelectionContextOptions = {},
  activeModelId: ForecastModelId | null = 'gfs',
): ForecastSelectionContextValue {
  const activeRun = activeForecastRunForModel(manifest, activeModelId)
  const shared = {
    modelOptions: modelOptionsFromManifest(manifest),
    setActiveModel: vi.fn(),
    setSelectedLayer: vi.fn(),
    setSelectedParticleLayer: vi.fn(),
  }
  const selectedLayerId = options.selectedLayerId
    ? options.selectedLayerId
    : getDefaultRasterLayerId()

  return (
    activeRun == null
      ? {
          activeRun: null,
          activeModelId: null,
          selectedLayerId: null,
          selectedParticleLayerId: null,
          ...shared,
        }
      : {
          activeRun,
          activeModelId: activeRun.modelId,
          selectedLayerId,
          selectedParticleLayerId: options.selectedParticleLayerId ?? getDefaultAvailableParticleLayerId(activeRun),
          ...shared,
        }
  ) satisfies ForecastSelectionContextValue
}

export function renderWithForecastSelection(
  ui: ReactNode,
  manifest: Manifest,
  options: ForecastModelId | {
    activeModelId?: ForecastModelId
    modelOptions?: readonly ForecastModelOption[]
  } = 'gfs'
) {
  const activeModelId = typeof options === 'string'
    ? options
    : options.activeModelId ?? 'gfs'
  const activeRun = createActiveRunFixture(manifest, activeModelId)
  localStorage.setItem(ACTIVE_MODEL_STORAGE_KEY, activeModelId)
  return render(
    <MemoryRouter initialEntries={['/?layer=temperature']}>
      <ForecastSettingsProvider>
        <ForecastSelectionProvider
          manifest={manifest}
          modelOptions={typeof options === 'string' ? [{
            id: activeModelId,
            label: activeRun.label,
          }] : options.modelOptions ?? [{
            id: activeModelId,
            label: activeRun.label,
          }]}
        >
          <ForecastSelectionFixtureTimeProvider>
            {ui}
          </ForecastSelectionFixtureTimeProvider>
        </ForecastSelectionProvider>
      </ForecastSettingsProvider>
    </MemoryRouter>
  )
}
