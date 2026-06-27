import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { normalizeError } from '@/core/abort'
import {
  applyWindows,
  configureProfile,
  reconcileProfile,
} from './registry'
import {
  type ForecastRenderProfile,
} from './profile'
import type { ForecastWindows } from '@/forecast/frames'
import type { ForecastRenderSettings } from '@/forecast/settings/settings'

export type ForecastRenderHost = {
  version: number
  apply: (windows: ForecastWindows) => void
}

type UseForecastRenderHostArgs = {
  map: MapLibreMap | null
  profile: ForecastRenderProfile
  renderSettings: ForecastRenderSettings
}

export function useForecastRenderHost({
  map,
  profile,
  renderSettings,
}: UseForecastRenderHostArgs): ForecastRenderHost | null {
  const [renderHost, setRenderHost] = useState<ForecastRenderHost | null>(null)
  const versionRef = useRef(0)
  const installedRef = useRef<{
    map: MapLibreMap
    profileKey: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const publishRenderHost = (host: ForecastRenderHost | null) => {
      queueMicrotask(() => {
        if (!cancelled) setRenderHost(host)
      })
    }

    if (!map) {
      installedRef.current = null
      versionRef.current = 0
      publishRenderHost(null)
      return () => {
        cancelled = true
      }
    }

    const profileKey = createProfileKey(profile)
    const needsReconcile = !(
      installedRef.current?.map === map &&
      installedRef.current.profileKey === profileKey
    )

    if (needsReconcile) {
      try {
        reconcileProfile(map, profile, renderSettings)
        configureProfile(map, profile, renderSettings)
      } catch (error) {
        console.error('[forecast-render] renderer update failed', normalizeError(error))
        return
      }

      const version = versionRef.current + 1
      versionRef.current = version
      installedRef.current = { map, profileKey }
      publishRenderHost({
        version,
        apply: (windows) => applyWindows(map, profile, windows),
      })
      return () => {
        cancelled = true
      }
    }

    try {
      configureProfile(map, profile, renderSettings)
    } catch (error) {
      console.error('[forecast-render] renderer update failed', normalizeError(error))
    }

    return () => {
      cancelled = true
    }
  }, [map, profile, renderSettings])

  return renderHost
}

function createProfileKey(profile: ForecastRenderProfile): string {
  return profile.layerIds.join(',')
}
