import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  DEFAULT_FORECAST_SETTINGS,
  type ForecastSettings,
  type ForecastSettingsActions,
  type ForecastSettingsValue,
  type ParticleSettings,
  type PressureContourSettings,
  type RasterRenderSettings,
  type UnitSettings,
} from './settings'
import { ForecastSettingsContext } from './ForecastSettingsContext'

export function ForecastSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ForecastSettings>(() => ({
    ...DEFAULT_FORECAST_SETTINGS,
  }))

  const updateRaster = useCallback((patch: Partial<RasterRenderSettings>) => {
    setSettings((current) => {
      const raster = applySettingsPatch(current.raster, patch)
      if (raster === current.raster) return current
      return {
        ...current,
        raster,
      }
    })
  }, [])

  const updateParticles = useCallback((patch: Partial<ParticleSettings>) => {
    setSettings((current) => {
      const particles = applySettingsPatch(current.particles, patch)
      if (particles === current.particles) return current
      return {
        ...current,
        particles,
      }
    })
  }, [])

  const updatePressureContours = useCallback((patch: Partial<PressureContourSettings>) => {
    setSettings((current) => {
      const pressureContours = applySettingsPatch(current.pressureContours, patch)
      if (pressureContours === current.pressureContours) return current
      return {
        ...current,
        pressureContours,
      }
    })
  }, [])

  const updateUnits = useCallback((patch: Partial<UnitSettings>) => {
    setSettings((current) => {
      const units = applySettingsPatch(current.units, patch)
      if (units === current.units) return current
      return {
        ...current,
        units,
      }
    })
  }, [])

  const toggleUnitSystem = useCallback(() => {
    setSettings((current) => ({
      ...current,
      units: {
        system: current.units.system === 'imperial' ? 'metric' : 'imperial',
      },
    }))
  }, [])

  const actions = useMemo<ForecastSettingsActions>(() => ({
    updateRaster,
    updateParticles,
    updatePressureContours,
    updateUnits,
    toggleUnitSystem,
  }), [
    toggleUnitSystem,
    updateRaster,
    updateParticles,
    updatePressureContours,
    updateUnits,
  ])

  const value = useMemo<ForecastSettingsValue>(() => ({
    settings,
    actions,
  }), [actions, settings])

  return (
    <ForecastSettingsContext.Provider value={value}>
      {children}
    </ForecastSettingsContext.Provider>
  )
}

function applySettingsPatch<TSettings extends object>(
  current: TSettings,
  patch: Partial<TSettings>
): TSettings {
  let didChange = false
  const next = { ...current }

  for (const key of Object.keys(patch) as (keyof TSettings)[]) {
    const nextValue = patch[key]
    if (current[key] === nextValue) continue
    next[key] = nextValue as TSettings[keyof TSettings]
    didChange = true
  }

  return didChange ? next : current
}
