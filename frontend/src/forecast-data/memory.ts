import type { ForecastDataRequest } from './request'
import type {
  ForecastDataKind,
} from '../forecast-data-loaders'
import type {
  ForecastDataWindows,
  LoadedForecastData,
  PreviousForecastDataWindows,
} from './types'
import { setForecastDataWindow } from './windows'

type DataKeyMap = Partial<Record<ForecastDataKind, string>>

type CommittedLoadedForecastData = {
  dataKeys: DataKeyMap
  probeDataKey: string | null
  loadedData: LoadedForecastData
}

type ForecastDataMemory = {
  reusableWindowsFor: (request: ForecastDataRequest) => PreviousForecastDataWindows
  shouldClearProbeField: (request: ForecastDataRequest) => boolean
  commit: (request: ForecastDataRequest, data: LoadedForecastData) => void
  reset: () => void
}

export function createForecastDataMemory(): ForecastDataMemory {
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
  return request.loads.find((load) => load.toProbeField != null)?.key ?? null
}
