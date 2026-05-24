import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import {
  DEFAULT_FORECAST_SETTINGS,
  ForecastSettingsProvider,
  useForecastSettings,
} from './index'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ForecastSettingsProvider>
      {children}
    </ForecastSettingsProvider>
  )
}

describe('ForecastSettingsProvider', () => {
  it('exposes default settings', () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('updates each setting group independently', () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    act(() => {
      result.current.actions.updateField({ colorSamplingMode: 'interpolated' })
      result.current.actions.updateParticles({
        enabled: false,
        clearTrailsOnViewChange: false,
      })
      result.current.actions.updatePressureContours({ enabled: true })
    })

    expect(result.current.settings).toEqual(expect.objectContaining({
      field: expect.objectContaining({ colorSamplingMode: 'interpolated' }),
      particles: expect.objectContaining({
        enabled: false,
        clearTrailsOnViewChange: false,
      }),
      pressureContours: { enabled: true },
    }))
  })
})
