import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { isAbortError, normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { createArtifactLoader } from '../forecast-artifacts'
import {
  createForecastFramePlan,
  createForecastFrameMemory,
  loadForecastFrames,
} from '../forecast-frame'
import { applyForecastFrames } from '../forecast-render'
import { forecastFieldFrameStore } from '../forecast-probe'
import type { StartupState, ForecastSyncTarget } from './types'

type UseSyncRunnerArgs = {
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
  config: WeatherMapConfig
  target: ForecastSyncTarget | null
  startup: StartupState
}

type RunnerDecision =
  | { kind: 'disabled' }
  | { kind: 'blocked' }
  | { kind: 'pending' }
  | { kind: 'run'; map: MapLibreMap; target: ForecastSyncTarget }

type ActiveRequest = {
  key: string
  controller: AbortController
}

type RunnerMachine = {
  prepare: (args: {
    isBlocked: boolean
    getMap: () => MapLibreMap | null
    mapReadyVersion: number
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
  getMap,
  mapReadyVersion,
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
  const frameMemoryRef = useRef<ReturnType<typeof createForecastFrameMemory> | null>(null)
  if (frameMemoryRef.current == null) {
    frameMemoryRef.current = createForecastFrameMemory()
  }

  useEffect(() => {
    const machine = machineRef.current
    if (machine == null) return

    const decision = machine.prepare({
      isBlocked,
      getMap,
      mapReadyVersion,
      target,
    })

    switch (decision.kind) {
      case 'disabled':
        frameMemoryRef.current?.reset()
        forecastFieldFrameStore.clear()
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

    const { map, target: syncTarget } = decision
    const {
      selectedValidTimeMs,
      requestKey,
      sync,
    } = syncTarget
    const frameMemory = frameMemoryRef.current
    if (frameMemory == null) return

    if (machine.isApplied(requestKey)) {
      machine.abort()
      return
    }
    if (machine.isActive(requestKey)) return

    const activeRequest = machine.start(requestKey)
    const framePlan = createForecastFramePlan({
      target: syncTarget,
      artifacts: createArtifactLoader({
        config,
        manifest: syncTarget.manifest,
        signal: activeRequest.controller.signal,
      }),
    })

    if (frameMemory.shouldClearFieldProbe(framePlan)) {
      forecastFieldFrameStore.clear()
    }

    handlePending()
    sync.onRequestStart(selectedValidTimeMs)

    const runRequest = async () => {
      try {
        const frames = await loadForecastFrames({
          plan: framePlan,
          previousWindows: frameMemory.reusableWindowsFor(framePlan),
        })

        if (isRequestStale(machine, activeRequest)) return
        applyForecastFrames(map, frames)
        if (isRequestStale(machine, activeRequest)) return

        forecastFieldFrameStore.publish(frames.field)
        frameMemory.commit(framePlan, frames)
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
    getMap,
    handleApplied,
    handleDisabled,
    handleError,
    handlePending,
    isBlocked,
    mapReadyVersion,
    target,
  ])
}

function createRunnerMachine(): RunnerMachine {
  let lastAppliedKey: string | null = null
  let active: ActiveRequest | null = null

  const machine: RunnerMachine = {
    prepare({ isBlocked, getMap, mapReadyVersion, target }) {
      if (target == null) {
        machine.reset()
        return { kind: 'disabled' }
      }
      if (isBlocked) {
        machine.abort()
        return { kind: 'blocked' }
      }
      if (mapReadyVersion < 1) {
        machine.abort()
        return { kind: 'pending' }
      }

      const map = getMap()
      if (!map) {
        machine.abort()
        return { kind: 'pending' }
      }

      return { kind: 'run', map, target }
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
