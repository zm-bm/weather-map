import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { CycleManifest } from '../../manifest'
import {
  asScalarVariableId,
  asVectorVariableId,
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
          cycle: null,
          scalarVariables: [],
          vectorVariables: [],
          variableMeta: null,
          activeScalar: null,
          activeVector: null,
          ...shared,
        }
      : {
          manifest,
          cycle: manifest.cycle,
          scalarVariables: manifest.scalarVariables,
          vectorVariables: manifest.vectorVariables,
          variableMeta: manifest.variableMeta,
          activeScalar: options.activeScalar
            ? asScalarVariableId(options.activeScalar)
            : manifest.scalarVariables[0],
          activeVector: options.activeVector
            ? asVectorVariableId(options.activeVector)
            : manifest.vectorVariables[0],
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
