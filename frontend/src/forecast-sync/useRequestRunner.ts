import { useEffect, useRef } from 'react'

import { isAbortError, normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastDataRequest,
  createForecastDataMemory,
  loadForecastData,
} from '../forecast-data'
import type {
  FieldInterpolationWindowData,
  ForecastDataOptions,
} from '../forecast-data'
import type { ForecastDataTarget } from '../forecast-data-targets'
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
  dataOptions: ForecastDataOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export function useRequestRunner({
  renderHost,
  config,
  target,
  syncCallbacks,
  startup,
  dataOptions,
  onProbeFrameChange,
}: UseRequestRunnerArgs): void {
  const {
    isBlocked,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
    retryToken,
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
    const requestController = new AbortController()
    const dataRequest = createForecastDataRequest({
      target: dataTarget,
      artifacts: createArtifactLoader({
        config,
        activeRun: dataTarget.activeRun,
        signal: requestController.signal,
      }),
      retryToken,
      options: dataOptions,
    })
    const {
      selectedValidTimeMs,
      requestKey,
    } = dataRequest
    const renderRequestKey = `${activeRenderHost.version}:${requestKey}`
    const dataMemory = dataMemoryRef.current
    if (dataMemory == null) {
      requestController.abort()
      return
    }

    if (requestTracker.isApplied(renderRequestKey)) {
      requestController.abort()
      requestTracker.abort()
      return
    }
    if (requestTracker.isActive(renderRequestKey)) {
      requestController.abort()
      return
    }

    const activeRequest = requestTracker.start(renderRequestKey, requestController)

    if (dataMemory.shouldClearProbeField(dataRequest)) {
      onProbeFrameChangeRef.current?.(null)
    }

    handlePending()
    syncCallbacksRef.current.onRequestStart(selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const loadedData = await loadForecastData({
          request: dataRequest,
          previousWindows: dataMemory.reusableWindowsFor(dataRequest),
        })

        if (isRequestStale(requestTracker, activeRequest)) return
        activeRenderHost.apply(loadedData)
        if (isRequestStale(requestTracker, activeRequest)) return

        onProbeFrameChangeRef.current?.(loadedData.probeField ?? null)
        dataMemory.commit(dataRequest, loadedData)
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
    dataOptions,
    renderHost,
    retryToken,
    target,
  ])
}

function isRequestStale(
  requestTracker: RequestTracker,
  request: ActiveRequest,
): boolean {
  return !requestTracker.isCurrent(request)
}
