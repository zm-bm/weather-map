import { useEffect, useRef } from 'react'

import { isAbortError, normalizeError } from '@/core/abort'
import type { WeatherMapConfig } from '@/core/config'
import type {
  FieldInterpolationWindowData,
  ForecastDataOptions,
  ForecastDataSession,
  ForecastDataTarget,
} from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'
import type { ForecastTimeSyncCallbacks } from '@/forecast/time'
import { createRequestTracker, type ActiveRequest, type RequestTracker } from './requestTracker'
import type { StartupController } from './useStartupController'

type UseRequestRunnerArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  target: ForecastDataTarget | null
  syncCallbacks: ForecastTimeSyncCallbacks
  startup: StartupController
  dataSession: ForecastDataSession
  dataOptions: ForecastDataOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export function useRequestRunner({
  renderHost,
  config,
  target,
  syncCallbacks,
  startup,
  dataSession,
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
  const onProbeFrameChangeRef = useRef(onProbeFrameChange)
  onProbeFrameChangeRef.current = onProbeFrameChange
  const syncCallbacksRef = useRef(syncCallbacks)
  syncCallbacksRef.current = syncCallbacks

  useEffect(() => {
    return () => {
      requestTrackerRef.current?.reset()
      dataSession.reset()
    }
  }, [dataSession])

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
        dataSession.reset()
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
    const dataJob = dataSession.createLoadJob({
      target: dataTarget,
      config,
      signal: requestController.signal,
      retryToken,
      options: dataOptions,
    })
    const renderRequestKey = `${activeRenderHost.version}:${dataJob.key}`

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

    if (dataJob.shouldClearProbeFrame) {
      onProbeFrameChangeRef.current?.(null)
    }

    handlePending()
    syncCallbacksRef.current.onRequestStart(dataJob.selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const loadedData = await dataJob.load()

        if (isRequestStale(requestTracker, activeRequest)) return
        activeRenderHost.apply(loadedData)
        if (isRequestStale(requestTracker, activeRequest)) return

        onProbeFrameChangeRef.current?.(loadedData.probeField ?? null)
        dataJob.commit(loadedData)
        requestTracker.markApplied(activeRequest)
        syncCallbacksRef.current.onRequestApplied(dataJob.selectedValidTimeMs)
        handleApplied()
      } catch (error: unknown) {
        if (isRequestStale(requestTracker, activeRequest)) return
        const normalizedError = normalizeError(error)
        if (isAbortError(normalizedError)) return
        syncCallbacksRef.current.onRequestError(dataJob.selectedValidTimeMs, normalizedError)
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
    dataSession,
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
