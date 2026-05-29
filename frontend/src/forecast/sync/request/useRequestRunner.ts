import { useEffect, useMemo, useRef } from 'react'

import { isAbortError, normalizeError } from '@/core/abort'
import type { WeatherMapConfig } from '@/core/config'
import type { ProbeWindow } from '@/forecast/frames'
import type { ForecastRenderHost } from '@/forecast/render'
import type { ForecastTimeSyncCallbacks } from '@/forecast/time'
import { createRequestTracker } from './requestTracker'
import type { InitialSyncController } from './initialSync'
import type { ForecastSyncSession } from '../load/session'
import type { ForecastSyncPlan } from '../plan'

type UseRequestRunnerArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  plan: ForecastSyncPlan | null
  syncCallbacks: ForecastTimeSyncCallbacks
  initialSync: InitialSyncController
  syncSession: ForecastSyncSession
  onProbeFrameChange?: (frame: ProbeWindow | null) => void
}

export function useRequestRunner({
  renderHost,
  config,
  plan,
  syncCallbacks,
  initialSync,
  syncSession,
  onProbeFrameChange,
}: UseRequestRunnerArgs): void {
  const {
    isBlocked,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
    retryToken,
  } = initialSync

  const requestTracker = useMemo(() => createRequestTracker(), [])
  const onProbeFrameChangeRef = useRef(onProbeFrameChange)
  onProbeFrameChangeRef.current = onProbeFrameChange
  const syncCallbacksRef = useRef(syncCallbacks)
  syncCallbacksRef.current = syncCallbacks

  useEffect(() => {
    return () => {
      requestTracker.reset()
      syncSession.reset()
    }
  }, [requestTracker, syncSession])

  useEffect(() => {
    if (plan == null) {
      requestTracker.reset()
      syncSession.reset()
      onProbeFrameChangeRef.current?.(null)
      handleDisabled()
      return
    }
    if (isBlocked) {
      requestTracker.abortActive()
      return
    }
    if (renderHost == null) {
      requestTracker.abortActive()
      handlePending()
      return
    }

    const requestController = new AbortController()
    const loadJob = syncSession.createLoadJob({
      plan,
      config,
      signal: requestController.signal,
      retryToken,
    })
    const renderRequestKey = `${renderHost.version}:${loadJob.key}`

    const activeRequest = requestTracker.begin(renderRequestKey, requestController)
    if (activeRequest == null) return

    if (loadJob.shouldClearProbeFrame) {
      onProbeFrameChangeRef.current?.(null)
    }

    handlePending()
    syncCallbacksRef.current.onRequestStart(loadJob.selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const windows = await loadJob.load()

        if (!requestTracker.isCurrent(activeRequest)) return
        renderHost.apply(windows)
        if (!requestTracker.isCurrent(activeRequest)) return

        onProbeFrameChangeRef.current?.(windows.raster ?? null)
        loadJob.commit(windows)
        requestTracker.markApplied(activeRequest)
        syncCallbacksRef.current.onRequestApplied(loadJob.selectedValidTimeMs)
        handleApplied()
      } catch (error: unknown) {
        if (!requestTracker.isCurrent(activeRequest)) return
        const normalizedError = normalizeError(error)
        if (isAbortError(normalizedError)) return
        syncCallbacksRef.current.onRequestError(loadJob.selectedValidTimeMs, normalizedError)
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
    requestTracker,
    syncSession,
    renderHost,
    retryToken,
    plan,
  ])
}
