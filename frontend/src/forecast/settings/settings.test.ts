import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FORECAST_SETTINGS,
  particleSizeSettingsForRatio,
  particleTrailFadeFromLength,
  particleTrailLengthFromFade,
} from './settings'

describe('forecast settings helpers', () => {
  it('defaults global overlays to wind on and pressure contours off', () => {
    expect(DEFAULT_FORECAST_SETTINGS.particles.enabled).toBe(true)
    expect(DEFAULT_FORECAST_SETTINGS.pressureContours.enabled).toBe(false)
  })

  it('maps the default trail fade to the expected display length', () => {
    expect(particleTrailLengthFromFade(DEFAULT_FORECAST_SETTINGS.particles.trailFade)).toBe(8)
  })

  it('maps trail length controls to bounded trail fade values', () => {
    expect(particleTrailFadeFromLength(1)).toBe(0.94)
    expect(particleTrailFadeFromLength(5)).toBe(0.963111)
    expect(particleTrailFadeFromLength(10)).toBe(0.992)
  })

  it('maps particle size ratios from default dot sizes', () => {
    expect(particleSizeSettingsForRatio(1.25)).toEqual({
      dotMinPx: 1.875,
      dotMaxPx: 3.5,
    })
  })
})
