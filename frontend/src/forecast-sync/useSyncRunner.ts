import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { isAbortError, normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { syncableForecastLayers } from '../forecast-layers'
import type { StartupState, SyncRequest } from './types'

const SYNCABLE_FORECAST_LAYERS = syncableForecastLayers

type UseSyncRunnerArgs = {
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
  config: WeatherMapConfig
  request: SyncRequest | null
  startup: StartupState
}

type RunnerDecision =
  | { kind: 'disabled' }
  | { kind: 'blocked' }
  | { kind: 'pending' }
  | { kind: 'run'; map: MapLibreMap; request: SyncRequest }

type ActiveRequest = {
  key: string
  controller: AbortController
}

type RunnerMachine = {
  prepare: (args: {
    isBlocked: boolean
    getMap: () => MapLibreMap | null
    mapReadyVersion: number
    request: SyncRequest | null
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
  request,
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

  useEffect(() => {
    const machine = machineRef.current
    if (machine == null) return

    const decision = machine.prepare({
      isBlocked,
      getMap,
      mapReadyVersion,
      request,
    })

    switch (decision.kind) {
      case 'disabled':
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

    const { map, request: syncRequest } = decision
    const {
      manifest,
      activeScalar,
      activeVector,
      selectedValidTimeMs,
      lowerHourToken,
      upperHourToken,
      mix,
      requestKey,
      sync,
    } = syncRequest

    if (machine.isApplied(requestKey)) return
    if (machine.isActive(requestKey)) return

    const activeRequest = machine.start(requestKey)
    handlePending()
    sync.onRequestStart(selectedValidTimeMs)

    const runRequest = async () => {
      try {
        await Promise.all(
          SYNCABLE_FORECAST_LAYERS.map((layer) => layer.applySync({
            map,
            config,
            manifest,
            selectedValidTimeMs,
            lowerHourToken,
            upperHourToken,
            mix,
            activeScalar,
            activeVector,
            signal: activeRequest.controller.signal,
          }))
        )

        if (isRequestStale(machine, activeRequest)) return
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
    request,
  ])
}

function createRunnerMachine(): RunnerMachine {
  let lastAppliedKey: string | null = null
  let active: ActiveRequest | null = null

  const machine: RunnerMachine = {
    prepare({ isBlocked, getMap, mapReadyVersion, request }) {
      if (request == null) {
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

      return { kind: 'run', map, request }
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
