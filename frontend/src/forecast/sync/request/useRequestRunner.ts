import { useEffect, useMemo } from 'react'

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
  onFieldLoadingChange?: (isLoading: boolean) => void
}

export function useRequestRunner({
  renderHost,
  config,
  plan,
  syncCallbacks,
  initialSync,
  syncSession,
  onProbeFrameChange,
  onFieldLoadingChange,
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

  useEffect(() => {
    return () => {
      requestTracker.reset()
      syncSession.reset()
      onFieldLoadingChange?.(false)
    }
  }, [onFieldLoadingChange, requestTracker, syncSession])

  useEffect(() => {
    if (plan == null) {
      requestTracker.reset()
      syncSession.reset()
      onProbeFrameChange?.(null)
      onFieldLoadingChange?.(false)
      handleDisabled()
      return
    }
    if (isBlocked) {
      requestTracker.abortActive()
      onFieldLoadingChange?.(false)
      return
    }
    if (renderHost == null) {
      requestTracker.abortActive()
      onFieldLoadingChange?.(false)
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
    onFieldLoadingChange?.(true)

    if (loadJob.shouldClearProbeFrame) {
      onProbeFrameChange?.(null)
    }

    handlePending()
    syncCallbacks.onRequestStart(loadJob.selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const windows = await loadJob.load()

        if (!requestTracker.isCurrent(activeRequest)) return
        renderHost.apply(windows)
        if (!requestTracker.isCurrent(activeRequest)) return

        onProbeFrameChange?.(windows.raster ?? null)
        loadJob.commit(windows)
        requestTracker.markApplied(activeRequest)
        syncCallbacks.onRequestApplied(loadJob.selectedValidTimeMs)
        handleApplied()
      } catch (error: unknown) {
        if (!requestTracker.isCurrent(activeRequest)) return
        const normalizedError = normalizeError(error)
        if (isAbortError(normalizedError)) return
        syncCallbacks.onRequestError(loadJob.selectedValidTimeMs, normalizedError)
        handleError(normalizedError)
      } finally {
        if (requestTracker.isCurrent(activeRequest)) {
          requestTracker.finish(activeRequest)
          onFieldLoadingChange?.(false)
        }
      }
    }

    void runRequest()
    return () => {
      if (!requestTracker.isCurrent(activeRequest)) return
      activeRequest.controller.abort()
      requestTracker.finish(activeRequest)
      onFieldLoadingChange?.(false)
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
    onFieldLoadingChange,
    onProbeFrameChange,
    syncCallbacks,
  ])
}
