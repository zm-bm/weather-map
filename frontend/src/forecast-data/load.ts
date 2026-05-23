import { isAbortError } from '../abort'
import type { ForecastDataRequest } from './request'
import type {
  ForecastDataKind,
  ForecastDataLoad,
  ForecastDataTimeSlices,
  LoadedInterpolationWindow,
} from '../forecast-data-loaders'
import type {
  FieldInterpolationWindowData,
  ForecastDataWindows,
  LoadedForecastData,
  PreviousForecastDataWindows,
} from './types'
import { setForecastDataWindow } from './windows'
import { loadInterpolationWindow } from './interpolationWindow'

type LoadForecastDataArgs = {
  request: ForecastDataRequest
  previousWindows?: PreviousForecastDataWindows
}

type LoadedData<K extends ForecastDataKind = ForecastDataKind> = {
  load: ForecastDataLoad<K>
  window: LoadedInterpolationWindow<ForecastDataTimeSlices[K]> | null
}

export async function loadForecastData(args: LoadForecastDataArgs): Promise<LoadedForecastData> {
  const loadedWindows = await Promise.all(
    args.request.loads.map((load) => loadDataWindow({
      request: args.request,
      load,
      previousWindow: previousDataWindow(args.previousWindows, load),
    }))
  )
  const windows = dataWindowsFromLoadedData(loadedWindows)

  return {
    windows,
    probeField: probeFieldFromLoadedData(loadedWindows),
  }
}

async function loadDataWindow<K extends ForecastDataKind>(args: {
  request: ForecastDataRequest
  load: ForecastDataLoad<K>
  previousWindow: LoadedInterpolationWindow<ForecastDataTimeSlices[K]> | null
}): Promise<LoadedData<K>> {
  try {
    const window = await loadInterpolationWindow<ForecastDataTimeSlices[K]>({
      selection: args.request,
      previousWindow: args.previousWindow,
      loadTimeSlice: args.load.loadTimeSlice,
    })
    return {
      load: args.load,
      window,
    }
  } catch (error) {
    if (isAbortError(error) || args.load.failurePolicy === 'required') throw error
    return {
      load: args.load,
      window: null,
    }
  }
}

function previousDataWindow<K extends ForecastDataKind>(
  previousWindows: PreviousForecastDataWindows | undefined,
  load: ForecastDataLoad<K>
): LoadedInterpolationWindow<ForecastDataTimeSlices[K]> | null {
  return (previousWindows?.[load.id] ?? null) as LoadedInterpolationWindow<ForecastDataTimeSlices[K]> | null
}

function dataWindowsFromLoadedData(
  loadedWindows: readonly LoadedData[]
): ForecastDataWindows {
  const windows: ForecastDataWindows = {}
  for (const loadedWindow of loadedWindows) {
    if (loadedWindow.window == null) continue
    setForecastDataWindow(windows, loadedWindow.load.id, loadedWindow.window)
  }
  return windows
}

function probeFieldFromLoadedData(
  loadedWindows: readonly LoadedData[]
): FieldInterpolationWindowData | null {
  for (const loadedWindow of loadedWindows) {
    const probeField = probeFieldFromLoadedWindow(loadedWindow)
    if (probeField != null) return probeField
  }
  return null
}

function probeFieldFromLoadedWindow<K extends ForecastDataKind>(
  loadedWindow: LoadedData<K>
): FieldInterpolationWindowData | null {
  const { load, window } = loadedWindow
  if (window == null || load.toProbeField == null) return null
  return load.toProbeField(window)
}
