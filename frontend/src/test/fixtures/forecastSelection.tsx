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
import { ForecastTimeProvider } from '@/forecast/time'
import {
  getDefaultAvailableParticleLayerId,
  getDefaultRasterLayerId,
} from '@/forecast/catalog'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '@/forecast/selection'
import { ForecastSettingsProvider } from '@/forecast/settings'
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
          selectedLayerId: null,
          selectedParticleLayerId: null,
          ...shared,
        }
      : {
          activeRun,
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
    onActiveModelChange?: (modelId: ForecastModelId) => void
  } = 'gfs'
) {
  const activeModelId = typeof options === 'string'
    ? options
    : options.activeModelId ?? 'gfs'
  const activeRun = createActiveRunFixture(manifest, activeModelId)
  return render(
    <MemoryRouter initialEntries={['/?layer=temperature']}>
      <ForecastSettingsProvider>
        <ForecastSelectionProvider
          activeRun={activeRun}
          modelOptions={typeof options === 'string' ? [{
            id: activeModelId,
            label: activeRun.label,
          }] : options.modelOptions ?? [{
            id: activeModelId,
            label: activeRun.label,
          }]}
          onActiveModelChange={typeof options === 'string'
            ? undefined
            : options.onActiveModelChange}
        >
          <ForecastTimeProvider activeRun={activeRun}>
            {ui}
          </ForecastTimeProvider>
        </ForecastSelectionProvider>
      </ForecastSettingsProvider>
    </MemoryRouter>
  )
}
