import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { normalizeError } from '../abort'
import { applyForecastRenderProfileData, reconcileForecastRenderers } from './host'
import {
  DEFAULT_FORECAST_RENDER_PROFILE,
  type ForecastRenderHost,
  type ForecastRenderProfile,
} from './types'

type UseForecastRenderHostArgs = {
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
  profile?: ForecastRenderProfile
}

export function useForecastRenderHost({
  getMap,
  mapReadyVersion,
  profile = DEFAULT_FORECAST_RENDER_PROFILE,
}: UseForecastRenderHostArgs): ForecastRenderHost | null {
  const [renderHost, setRenderHost] = useState<ForecastRenderHost | null>(null)
  const installedRef = useRef<{
    map: MapLibreMap
    mapReadyVersion: number
    profileVersionKey: string
  } | null>(null)

  useEffect(() => {
    if (mapReadyVersion < 1) {
      installedRef.current = null
      setRenderHost(null)
      return
    }

    const map = getMap()
    if (!map) {
      installedRef.current = null
      setRenderHost(null)
      return
    }

    const profileVersionKey = createProfileVersionKey(profile)
    if (
      installedRef.current?.map === map &&
      installedRef.current.mapReadyVersion === mapReadyVersion &&
      installedRef.current.profileVersionKey === profileVersionKey
    ) {
      return
    }

    try {
      reconcileForecastRenderers(map, profile)
    } catch (error) {
      console.error('[forecast-render] renderer reconciliation failed', normalizeError(error))
    } finally {
      installedRef.current = { map, mapReadyVersion, profileVersionKey }
      setRenderHost((current) => ({
        version: (current?.version ?? 0) + 1,
        apply: (data) => applyForecastRenderProfileData(map, profile, data),
      }))
    }
  }, [getMap, mapReadyVersion, profile])

  return renderHost
}

function createProfileVersionKey(profile: ForecastRenderProfile): string {
  return `${profile.key}:${profile.rendererIds.join(',')}`
}
