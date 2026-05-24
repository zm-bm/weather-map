import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { normalizeError } from '@/core/abort'
import {
  applyData,
  configureProfile,
  reconcileProfile,
} from './registry'
import {
  type ForecastRenderHost,
  type ForecastRenderProfile,
} from './types'
import type { ForecastRenderSettings } from '@/forecast/settings/settings'

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
  const hostStore = useMemo(() => createHostStore(), [])
  const renderHost = useSyncExternalStore(
    hostStore.subscribe,
    hostStore.getSnapshot,
    hostStore.getSnapshot,
  )
  const installedRef = useRef<{
    map: MapLibreMap
    mapReadyVersion: number
    profileKey: string
  } | null>(null)

  useEffect(() => {
    if (mapReadyVersion < 1) {
      installedRef.current = null
      hostStore.publish(null)
      return
    }

    const map = getMap()
    if (!map) {
      installedRef.current = null
      hostStore.publish(null)
      return
    }

    const profileKey = createProfileKey(profile)
    const needsReconcile = !(
      installedRef.current?.map === map &&
      installedRef.current.mapReadyVersion === mapReadyVersion &&
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

      installedRef.current = { map, mapReadyVersion, profileKey }
      hostStore.publish({
        version: (hostStore.getSnapshot()?.version ?? 0) + 1,
        apply: (data) => applyData(map, profile, data),
      })
      return
    }

    try {
      configureProfile(map, profile, renderSettings)
    } catch (error) {
      console.error('[forecast-render] renderer update failed', normalizeError(error))
    }
  }, [getMap, mapReadyVersion, profile, hostStore, renderSettings])

  return renderHost
}

function createProfileKey(profile: ForecastRenderProfile): string {
  return profile.rendererIds.join(',')
}

type HostStore = {
  getSnapshot: () => ForecastRenderHost | null
  publish: (host: ForecastRenderHost | null) => void
  subscribe: (listener: () => void) => () => void
}

function createHostStore(): HostStore {
  let snapshot: ForecastRenderHost | null = null
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    publish: (host) => {
      if (snapshot === host) return
      snapshot = host
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
