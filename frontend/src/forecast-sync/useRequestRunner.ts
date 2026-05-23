import { useEffect, useRef } from 'react'

import { isAbortError, normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastProductRequest,
  createForecastProductMemory,
  loadForecastProducts,
} from '../forecast-products'
import type {
  FieldInterpolationWindowData,
  ForecastProductOptions,
  ForecastProductTarget,
} from '../forecast-products'
import type { ForecastRenderHost } from '../forecast-render'
import type { ForecastTimeSyncCallbacks } from '../forecast-time'
import { createRequestTracker, type ActiveRequest, type RequestTracker } from './requestTracker'
import type { StartupController } from './useStartupController'

type UseRequestRunnerArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  target: ForecastProductTarget | null
  syncCallbacks: ForecastTimeSyncCallbacks
  startup: StartupController
  productOptions: ForecastProductOptions
  onProbeFrameChange?: (frame: FieldInterpolationWindowData | null) => void
}

export function useRequestRunner({
  renderHost,
  config,
  target,
  syncCallbacks,
  startup,
  productOptions,
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
  const productMemoryRef = useRef<ReturnType<typeof createForecastProductMemory> | null>(null)
  if (productMemoryRef.current == null) {
    productMemoryRef.current = createForecastProductMemory()
  }
  const onProbeFrameChangeRef = useRef(onProbeFrameChange)
  onProbeFrameChangeRef.current = onProbeFrameChange
  const syncCallbacksRef = useRef(syncCallbacks)
  syncCallbacksRef.current = syncCallbacks

  useEffect(() => {
    return () => {
      requestTrackerRef.current?.reset()
      productMemoryRef.current?.reset()
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
        productMemoryRef.current?.reset()
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

    const { renderHost: activeRenderHost, target: productTarget } = decision
    const requestController = new AbortController()
    const productRequest = createForecastProductRequest({
      target: productTarget,
      artifacts: createArtifactLoader({
        config,
        activeRun: productTarget.activeRun,
        signal: requestController.signal,
      }),
      retryToken,
      options: productOptions,
    })
    const {
      selectedValidTimeMs,
      requestKey,
    } = productRequest
    const renderRequestKey = `${activeRenderHost.version}:${requestKey}`
    const productMemory = productMemoryRef.current
    if (productMemory == null) {
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

    if (productMemory.shouldClearProbeField(productRequest)) {
      onProbeFrameChangeRef.current?.(null)
    }

    handlePending()
    syncCallbacksRef.current.onRequestStart(selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const loadedProducts = await loadForecastProducts({
          request: productRequest,
          previousWindows: productMemory.reusableWindowsFor(productRequest),
        })

        if (isRequestStale(requestTracker, activeRequest)) return
        activeRenderHost.apply(loadedProducts)
        if (isRequestStale(requestTracker, activeRequest)) return

        onProbeFrameChangeRef.current?.(loadedProducts.probeField ?? null)
        productMemory.commit(productRequest, loadedProducts)
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
    productOptions,
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
