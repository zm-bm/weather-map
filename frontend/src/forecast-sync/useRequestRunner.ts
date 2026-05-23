import { useEffect, useRef } from 'react'

import { isAbortError, normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastDataPlan,
  createForecastDataMemory,
  loadForecastData,
} from '../forecast-data'
import type { FieldInterpolationWindowData, ForecastDataTarget } from '../forecast-data'
import type { ForecastRenderHost } from '../forecast-render'
import type { ForecastTimeSyncCallbacks } from '../forecast-time'
import { createRequestTracker, type ActiveRequest, type RequestTracker } from './requestTracker'
import type { StartupController } from './useStartupController'

type UseRequestRunnerArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  target: ForecastDataTarget | null
  syncCallbacks: ForecastTimeSyncCallbacks
  startup: StartupController
  pressureContoursEnabled?: boolean
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export function useRequestRunner({
  renderHost,
  config,
  target,
  syncCallbacks,
  startup,
  pressureContoursEnabled = true,
  onProbeFrameChange,
}: UseRequestRunnerArgs): void {
  const {
    isBlocked,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
  } = startup

  const requestTrackerRef = useRef<RequestTracker | null>(null)
  if (requestTrackerRef.current == null) {
    requestTrackerRef.current = createRequestTracker()
  }
  const dataMemoryRef = useRef<ReturnType<typeof createForecastDataMemory> | null>(null)
  if (dataMemoryRef.current == null) {
    dataMemoryRef.current = createForecastDataMemory()
  }
  const onProbeFrameChangeRef = useRef(onProbeFrameChange)
  onProbeFrameChangeRef.current = onProbeFrameChange
  const syncCallbacksRef = useRef(syncCallbacks)
  syncCallbacksRef.current = syncCallbacks

  useEffect(() => {
    return () => {
      requestTrackerRef.current?.reset()
      dataMemoryRef.current?.reset()
    }
  }, [])

  useEffect(() => {
    const requestTracker = requestTrackerRef.current
    if (requestTracker == null) return

    const decision = requestTracker.prepare({
      isBlocked,
      renderHost,
      target,
    })

    switch (decision.kind) {
      case 'disabled':
        dataMemoryRef.current?.reset()
        onProbeFrameChangeRef.current?.(null)
        handleDisabled()
        return
      case 'blocked':
        return
      case 'pending':
        handlePending()
        return
      case 'run':
        break
    }

    const { renderHost: activeRenderHost, target: dataTarget } = decision
    const {
      selectedValidTimeMs,
      requestKey,
    } = dataTarget
    const contourStateKey = pressureContoursEnabled ? 'contours:on' : 'contours:off'
    const renderRequestKey = `${activeRenderHost.version}:${contourStateKey}:${requestKey}`
    const dataMemory = dataMemoryRef.current
    if (dataMemory == null) return

    if (requestTracker.isApplied(renderRequestKey)) {
      requestTracker.abort()
      return
    }
    if (requestTracker.isActive(renderRequestKey)) return

    const activeRequest = requestTracker.start(renderRequestKey)
    const dataPlan = createForecastDataPlan({
      target: dataTarget,
      artifacts: createArtifactLoader({
        config,
        activeRun: dataTarget.activeRun,
        signal: activeRequest.controller.signal,
      }),
      pressureContoursEnabled,
    })

    if (dataMemory.shouldClearFieldProbe(dataPlan)) {
      onProbeFrameChangeRef.current?.(null)
    }

    handlePending()
    syncCallbacksRef.current.onRequestStart(selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const renderData = await loadForecastData({
          plan: dataPlan,
          previousWindows: dataMemory.reusableWindowsFor(dataPlan),
        })

        if (isRequestStale(requestTracker, activeRequest)) return
        activeRenderHost.apply(renderData)
        if (isRequestStale(requestTracker, activeRequest)) return

        onProbeFrameChangeRef.current?.(renderData.probeField ?? null)
        dataMemory.commit(dataPlan, renderData)
        requestTracker.markApplied(activeRequest)
        syncCallbacksRef.current.onRequestApplied(selectedValidTimeMs)
        handleApplied()
      } catch (error: unknown) {
        if (isRequestStale(requestTracker, activeRequest)) return
        const normalizedError = normalizeError(error)
        if (isAbortError(normalizedError)) return
        syncCallbacksRef.current.onRequestError(selectedValidTimeMs, normalizedError)
        handleError(normalizedError)
      } finally {
        requestTracker.finish(activeRequest)
      }
    }

    void runRequest()
    return () => {
      if (!requestTracker.isCurrent(activeRequest)) return
      activeRequest.controller.abort()
      requestTracker.finish(activeRequest)
    }
  }, [
    config,
    handleApplied,
    handleDisabled,
    handleError,
    handlePending,
    isBlocked,
    pressureContoursEnabled,
    renderHost,
    target,
  ])
}

function isRequestStale(
  requestTracker: RequestTracker,
  request: ActiveRequest,
): boolean {
  return !requestTracker.isCurrent(request)
}
