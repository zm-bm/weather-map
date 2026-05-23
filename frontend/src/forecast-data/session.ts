import type { WeatherMapConfig } from '../config'
import { loadForecastData } from './load'
import { prefetchForecastData } from './prefetch'
import { createForecastDataRequest, type ForecastDataRequest } from './request'
import type { ForecastDataKind } from './slices'
import type { ForecastDataTarget } from './target'
import type {
  ForecastDataOptions,
  ForecastDataWindows,
  LoadedForecastData,
} from './types'
import { setForecastDataWindow } from './windows'

type CreateLoadJobArgs = {
  target: ForecastDataTarget
  config: WeatherMapConfig
  signal: AbortSignal
  retryToken: number
  options?: Partial<ForecastDataOptions>
}

type PrefetchArgs = {
  target: ForecastDataTarget
  config: WeatherMapConfig
  signal: AbortSignal
  options?: Partial<ForecastDataOptions>
  aheadHourCount: number
  concurrency: number
}

type LoadJob = {
  key: string
  selectedValidTimeMs: number
  shouldClearProbeFrame: boolean
  load: () => Promise<LoadedForecastData>
  commit: (data: LoadedForecastData) => void
}

type DataKeyMap = Partial<Record<ForecastDataKind, string>>

type CommittedLoadedForecastData = {
  dataKeys: DataKeyMap
  probeDataKey: string | null
  loadedData: LoadedForecastData
}

type SessionMemory = {
  reusableWindowsFor: (request: ForecastDataRequest) => ForecastDataWindows
  shouldClearProbeField: (request: ForecastDataRequest) => boolean
  commit: (request: ForecastDataRequest, data: LoadedForecastData) => void
  reset: () => void
}

export type ForecastDataSession = {
  createLoadJob: (args: CreateLoadJobArgs) => LoadJob
  prefetch: (args: PrefetchArgs) => Promise<void>
  reset: () => void
}

export function createForecastDataSession(): ForecastDataSession {
  const memory = createSessionMemory()

  return {
    createLoadJob(args) {
      const request = createForecastDataRequest(args)
      return {
        key: request.requestKey,
        selectedValidTimeMs: request.selectedValidTimeMs,
        shouldClearProbeFrame: memory.shouldClearProbeField(request),
        load: () => loadForecastData({
          request,
          previousWindows: memory.reusableWindowsFor(request),
        }),
        commit(data) {
          memory.commit(request, data)
        },
      }
    },
    prefetch(args) {
      const request = createForecastDataRequest({
        target: args.target,
        config: args.config,
        signal: args.signal,
        retryToken: 0,
        options: args.options,
      })
      return prefetchForecastData({
        request,
        aheadHourCount: args.aheadHourCount,
        concurrency: args.concurrency,
        signal: args.signal,
      })
    },
    reset() {
      memory.reset()
    },
  }
}

function createSessionMemory(): SessionMemory {
  let committed: CommittedLoadedForecastData | null = null

  return {
    reusableWindowsFor(request) {
      if (committed == null) return {}

      const reusableWindows: ForecastDataWindows = {}
      for (const load of request.loads) {
        if (committed.dataKeys[load.id] !== load.key) continue
        const window = committed.loadedData.windows[load.id]
        if (window == null) continue
        setForecastDataWindow(reusableWindows, load.id, window)
      }
      return reusableWindows
    },
    shouldClearProbeField(request) {
      return committed != null && committed.probeDataKey !== probeDataKey(request)
    },
    commit(request, data) {
      committed = {
        dataKeys: dataKeysFor(request),
        probeDataKey: probeDataKey(request),
        loadedData: data,
      }
    },
    reset() {
      committed = null
    },
  }
}

function dataKeysFor(request: ForecastDataRequest): DataKeyMap {
  const dataKeys: DataKeyMap = {}
  for (const load of request.loads) {
    dataKeys[load.id] = load.key
  }
  return dataKeys
}

function probeDataKey(request: ForecastDataRequest): string | null {
  return request.loads.find((load) => load.probeField != null)?.probeField?.key ?? null
}
