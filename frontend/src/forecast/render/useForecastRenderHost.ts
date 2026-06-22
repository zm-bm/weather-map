import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
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
  const hostStore = useMemo(() => createHostStore(), [])
  const renderHost = useSyncExternalStore(
    hostStore.subscribe,
    hostStore.getSnapshot,
    hostStore.getSnapshot,
  )
  const installedRef = useRef<{
    map: MapLibreMap
    profileKey: string
  } | null>(null)

  useEffect(() => {
    if (!map) {
      installedRef.current = null
      hostStore.publish(null)
      return
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

      installedRef.current = { map, profileKey }
      hostStore.publish({
        version: (hostStore.getSnapshot()?.version ?? 0) + 1,
        apply: (windows) => applyWindows(map, profile, windows),
      })
      return
    }

    try {
      configureProfile(map, profile, renderSettings)
    } catch (error) {
      console.error('[forecast-render] renderer update failed', normalizeError(error))
    }
  }, [map, profile, hostStore, renderSettings])

  return renderHost
}

function createProfileKey(profile: ForecastRenderProfile): string {
  return profile.layerIds.join(',')
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
