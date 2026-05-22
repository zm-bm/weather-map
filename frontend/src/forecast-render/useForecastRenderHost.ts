import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { normalizeError } from '../abort'
import {
  applyForecastRenderProfileData,
  configureForecastRenderers,
  reconcileForecastRenderers,
} from './host'
import {
  type ForecastRenderHost,
  type ForecastRenderProfile,
} from './types'
import type { ForecastRenderSettings } from '../forecast-settings/settings'

type UseForecastRenderHostArgs = {
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
  profile: ForecastRenderProfile
  renderSettings: ForecastRenderSettings
}

export function useForecastRenderHost({
  getMap,
  mapReadyVersion,
  profile,
  renderSettings,
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
    const shouldReconcile = !(
      installedRef.current?.map === map &&
      installedRef.current.mapReadyVersion === mapReadyVersion &&
      installedRef.current.profileVersionKey === profileVersionKey
    )

    try {
      if (shouldReconcile) {
        reconcileForecastRenderers(map, profile, renderSettings)
      }
      configureForecastRenderers(map, profile, renderSettings)
    } catch (error) {
      console.error('[forecast-render] renderer update failed', normalizeError(error))
    } finally {
      if (shouldReconcile) {
        installedRef.current = { map, mapReadyVersion, profileVersionKey }
        setRenderHost((current) => ({
          version: (current?.version ?? 0) + 1,
          apply: (data) => applyForecastRenderProfileData(map, profile, data),
        }))
      }
    }
  }, [getMap, mapReadyVersion, profile, renderSettings])

  return renderHost
}

function createProfileVersionKey(profile: ForecastRenderProfile): string {
  return profile.rendererIds.join(',')
}
