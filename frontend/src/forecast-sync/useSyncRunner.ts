import { useEffect, useRef } from 'react'

import { isAbortError, normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastDataPlan,
  createForecastDataMemory,
  loadForecastData,
} from '../forecast-data'
import type { ForecastRenderHost } from '../forecast-render'
import { forecastFieldDataStore } from '../forecast-probe'
import type { StartupState, ForecastSyncTarget } from './types'

type UseSyncRunnerArgs = {
  renderHost: ForecastRenderHost | null
  config: WeatherMapConfig
  target: ForecastSyncTarget | null
  startup: StartupState
}

type RunnerDecision =
  | { kind: 'disabled' }
  | { kind: 'blocked' }
  | { kind: 'pending' }
  | { kind: 'run'; renderHost: ForecastRenderHost; target: ForecastSyncTarget }

type ActiveRequest = {
  key: string
  controller: AbortController
}

type RunnerMachine = {
  prepare: (args: {
    isBlocked: boolean
    renderHost: ForecastRenderHost | null
    target: ForecastSyncTarget | null
  }) => RunnerDecision
  reset: () => void
  abort: () => void
  isApplied: (requestKey: string) => boolean
  isActive: (requestKey: string) => boolean
  start: (requestKey: string) => ActiveRequest
  isCurrent: (request: ActiveRequest) => boolean
  markApplied: (request: ActiveRequest) => void
  finish: (request: ActiveRequest) => void
}

export function useSyncRunner({
  renderHost,
  config,
  target,
  startup,
}: UseSyncRunnerArgs): void {
  const {
    isBlocked,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
  } = startup

  const machineRef = useRef<RunnerMachine | null>(null)
  if (machineRef.current == null) {
    machineRef.current = createRunnerMachine()
  }
  const dataMemoryRef = useRef<ReturnType<typeof createForecastDataMemory> | null>(null)
  if (dataMemoryRef.current == null) {
    dataMemoryRef.current = createForecastDataMemory()
  }

  useEffect(() => {
    const machine = machineRef.current
    if (machine == null) return

    const decision = machine.prepare({
      isBlocked,
      renderHost,
      target,
    })

    switch (decision.kind) {
      case 'disabled':
        dataMemoryRef.current?.reset()
        forecastFieldDataStore.clear()
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

    const { renderHost: activeRenderHost, target: syncTarget } = decision
    const {
      selectedValidTimeMs,
      requestKey,
      sync,
    } = syncTarget
    const renderRequestKey = `${activeRenderHost.version}:${requestKey}`
    const dataMemory = dataMemoryRef.current
    if (dataMemory == null) return

    if (machine.isApplied(renderRequestKey)) {
      machine.abort()
      return
    }
    if (machine.isActive(renderRequestKey)) return

    const activeRequest = machine.start(renderRequestKey)
    const dataPlan = createForecastDataPlan({
      target: syncTarget,
      artifacts: createArtifactLoader({
        config,
        activeRun: syncTarget.activeRun,
        signal: activeRequest.controller.signal,
      }),
    })

    if (dataMemory.shouldClearFieldProbe(dataPlan)) {
      forecastFieldDataStore.clear()
    }

    handlePending()
    sync.onRequestStart(selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const renderData = await loadForecastData({
          plan: dataPlan,
          previousWindows: dataMemory.reusableWindowsFor(dataPlan),
        })

        if (isRequestStale(machine, activeRequest)) return
        activeRenderHost.apply(renderData)
        if (isRequestStale(machine, activeRequest)) return

        forecastFieldDataStore.publish(renderData.field)
        dataMemory.commit(dataPlan, renderData)
        machine.markApplied(activeRequest)
        sync.onRequestApplied(selectedValidTimeMs)
        handleApplied()
      } catch (error: unknown) {
        if (isRequestStale(machine, activeRequest)) return
        const normalizedError = normalizeError(error)
        if (isAbortError(normalizedError)) return
        sync.onRequestError(selectedValidTimeMs, normalizedError)
        handleError(normalizedError)
      } finally {
        machine.finish(activeRequest)
      }
    }

    void runRequest()
  }, [
    config,
    handleApplied,
    handleDisabled,
    handleError,
    handlePending,
    isBlocked,
    renderHost,
    target,
  ])
}

function createRunnerMachine(): RunnerMachine {
  let lastAppliedKey: string | null = null
  let active: ActiveRequest | null = null

  const machine: RunnerMachine = {
    prepare({ isBlocked, renderHost, target }) {
      if (target == null) {
        machine.reset()
        return { kind: 'disabled' }
      }
      if (isBlocked) {
        machine.abort()
        return { kind: 'blocked' }
      }
      if (renderHost == null) {
        machine.abort()
        return { kind: 'pending' }
      }

      return { kind: 'run', renderHost, target }
    },
    reset() {
      active?.controller.abort()
      active = null
      lastAppliedKey = null
    },
    abort() {
      active?.controller.abort()
      active = null
    },
    isApplied(requestKey) {
      return lastAppliedKey === requestKey
    },
    isActive(requestKey) {
      return active?.key === requestKey
    },
    start(requestKey) {
      active?.controller.abort()
      const request = {
        key: requestKey,
        controller: new AbortController(),
      }
      active = request
      return request
    },
    isCurrent(request) {
      return active === request && !request.controller.signal.aborted
    },
    markApplied(request) {
      if (active !== request) return
      lastAppliedKey = request.key
    },
    finish(request) {
      if (active !== request) return
      active = null
    },
  }

  return machine
}

function isRequestStale(
  machine: RunnerMachine,
  request: ActiveRequest,
): boolean {
  return !machine.isCurrent(request)
}
