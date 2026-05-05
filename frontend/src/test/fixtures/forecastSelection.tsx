import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { CycleManifest } from '../../manifest'
import {
  asScalarProductId,
  asVectorProductId,
} from '../../manifest'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '../../forecast-selection'
import type { UnitSystem } from '../../units'


type ForecastSelectionContextOptions = Partial<{
  activeScalar: string
  activeVector: string
  unitSystem: UnitSystem
}>

export function createForecastSelectionContextValue(
  manifest: CycleManifest | null,
  options: ForecastSelectionContextOptions = {}
): ForecastSelectionContextValue {
  const shared = {
    unitSystem: options.unitSystem ?? ('imperial' as UnitSystem),
    setActiveScalar: vi.fn(),
    setActiveVector: vi.fn(),
    setUnitSystem: vi.fn(),
    toggleUnitSystem: vi.fn(),
  }

  return (
    manifest == null
      ? {
          manifest: null,
          groups: [],
          products: null,
          activeScalar: null,
          activeVector: null,
          ...shared,
        }
      : {
          manifest,
          groups: manifest.groups,
          products: manifest.products,
          activeScalar: options.activeScalar
            ? asScalarProductId(options.activeScalar)
            : manifest.productsByLayerId.scalar?.[0] ?? null,
          activeVector: options.activeVector
            ? asVectorProductId(options.activeVector)
            : manifest.productsByLayerId.vector?.[0] ?? null,
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
