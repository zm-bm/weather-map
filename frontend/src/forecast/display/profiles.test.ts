import { describe, expect, it } from 'vitest'

import {
  DISPLAY_PROFILE_IDS,
  FORECAST_DISPLAY_PROFILES,
  isDisplayProfileId,
} from './profiles'
import {
  fromNative,
  toNative,
} from './units'

describe('forecast display profiles', () => {
  it('defines a valid resolved display profile for every id', () => {
    expect(DISPLAY_PROFILE_IDS.length).toBeGreaterThan(0)

    for (const profileId of DISPLAY_PROFILE_IDS) {
      const profile = FORECAST_DISPLAY_PROFILES[profileId]

      expect(isDisplayProfileId(profileId)).toBe(true)
      expect(profile.label).toBeTruthy()
      expect(profile.range.max).toBeGreaterThan(profile.range.min)
      expect(profile.units.options.length).toBeGreaterThan(0)

      if (profile.kind === 'gradient') {
        expect(profile.palette.stops.length).toBeGreaterThan(0)
        for (const option of profile.units.options) {
          expect(option.legendLabels.length).toBeGreaterThanOrEqual(2)
        }
      } else {
        expect(Object.keys(profile.bandPalettes)).toEqual(['low', 'middle', 'high'])
      }
    }
  })

  it('resolves gradient and cloud palettes directly from display profiles', () => {
    expect(FORECAST_DISPLAY_PROFILES.temperature.kind).toBe('gradient')
    if (FORECAST_DISPLAY_PROFILES.temperature.kind !== 'gradient') {
      throw new Error('temperature should use a gradient display')
    }
    expect(FORECAST_DISPLAY_PROFILES.temperature.palette.id)
      .toBe('temperature.air.c.v1')

    expect(FORECAST_DISPLAY_PROFILES['cloud-layers'].kind).toBe('cloud-layers')
    if (FORECAST_DISPLAY_PROFILES['cloud-layers'].kind !== 'cloud-layers') {
      throw new Error('cloud-layers should use a cloud display')
    }
    expect(FORECAST_DISPLAY_PROFILES['cloud-layers'].bandPalettes.middle.id)
      .toBe('cloud.layers.middle.v1')
  })

  it('uses the refreshed reflectivity palette, labels, and display range across radar profiles', () => {
    const reflectivityProfileIds = [
      'composite-reflectivity',
      'observed-radar-base-reflectivity',
      'observed-radar-composite-reflectivity',
    ] as const

    for (const profileId of reflectivityProfileIds) {
      const profile = FORECAST_DISPLAY_PROFILES[profileId]
      if (profile.kind !== 'gradient') {
        throw new Error(`${profileId} should use a gradient display`)
      }
      expect(profile.palette.id).toBe('radar.reflectivity.dbz.v2')
      expect(profile.range).toEqual({ min: -35, max: 75 })
      expect(profile.units.options).toEqual([expect.objectContaining({
        id: 'dbz',
        legendLabels: [-35, -25, -15, -5, 5, 15, 25, 35, 45, 55, 65, 75],
      })])
    }
  })

  it('round-trips display units through native values', () => {
    for (const profile of Object.values(FORECAST_DISPLAY_PROFILES)) {
      for (const option of profile.units.options) {
        const displayedValue = fromNative(10, option)
        expect(toNative(displayedValue, option)).toBeCloseTo(10)
      }
    }
  })
})
