import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { isAbortError, normalizeError } from '../abort'
import type { WeatherMapConfig } from '../config'
import { scalarLayerAdapter } from '../map/scalar'
import { vectorLayerAdapter } from '../map/vector'
import type { FrameSyncRequest } from '../state/frameSyncTypes'
import type { StartupSyncState } from './useStartupSyncState'

const LAYER_ADAPTERS = [scalarLayerAdapter, vectorLayerAdapter] as const

type UseFrameSyncRunnerArgs = {
  getMap: () => MapLibreMap | null
  mapReadyVersion: number
  config: WeatherMapConfig
  syncRequest: FrameSyncRequest | null
  syncState: StartupSyncState
}

type RunnerDecision =
  | { kind: 'disabled' }
  | { kind: 'blocked' }
  | { kind: 'pending' }
  | { kind: 'run'; map: MapLibreMap; request: FrameSyncRequest }

type ActiveRequest = {
  key: string
  controller: AbortController
}

type RunnerMachine = {
  prepare: (args: {
    isStartupBlocked: boolean
    getMap: () => MapLibreMap | null
    mapReadyVersion: number
    syncRequest: FrameSyncRequest | null
  }) => RunnerDecision
  reset: () => void
  abort: () => void
  isApplied: (syncKey: string) => boolean
  isActive: (syncKey: string) => boolean
  start: (syncKey: string) => ActiveRequest
  isCurrent: (request: ActiveRequest) => boolean
  markApplied: (request: ActiveRequest) => void
  finish: (request: ActiveRequest) => void
}

export function useFrameSyncRunner({
  getMap,
  mapReadyVersion,
  config,
  syncRequest,
  syncState,
}: UseFrameSyncRunnerArgs): void {
  const {
    isStartupBlocked,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
  } = syncState

  const machineRef = useRef<RunnerMachine | null>(null)
  if (machineRef.current == null) {
    machineRef.current = createRunnerMachine()
  }

  useEffect(() => {
    const machine = machineRef.current
    if (machine == null) return

    const decision = machine.prepare({
      isStartupBlocked,
      getMap,
      mapReadyVersion,
      syncRequest,
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

    const { map, request } = decision
    const {
      manifest,
      activeScalar,
      activeVector,
      activeHourIndex,
      hourToken,
      syncKey,
      sync,
    } = request

    if (machine.isApplied(syncKey)) return
    if (machine.isActive(syncKey)) return

    const activeRequest = machine.start(syncKey)
    handlePending()
    sync.onRequestStart?.(activeHourIndex)

    const runRequest = async () => {
      try {
        await Promise.all(
          LAYER_ADAPTERS.map((adapter) => adapter.applySync({
            map,
            config,
            manifest,
            hourToken,
            activeScalar,
            activeVector,
            signal: activeRequest.controller.signal,
          }))
        )

        if (isRequestStale(machine, activeRequest)) return
        machine.markApplied(activeRequest)
        sync.onRequestApplied?.(activeHourIndex)
        handleApplied()
      } catch (error: unknown) {
        if (isRequestStale(machine, activeRequest)) return
        const normalizedError = normalizeError(error)
        if (isAbortError(normalizedError)) return
        sync.onRequestError?.(activeHourIndex, normalizedError)
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
    isStartupBlocked,
    mapReadyVersion,
    syncRequest,
  ])
}

function createRunnerMachine(): RunnerMachine {
  let lastAppliedKey: string | null = null
  let active: ActiveRequest | null = null

  const machine: RunnerMachine = {
    prepare({ isStartupBlocked, getMap, mapReadyVersion, syncRequest }) {
      if (syncRequest == null) {
        machine.reset()
        return { kind: 'disabled' }
      }
      if (isStartupBlocked) {
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

      return { kind: 'run', map, request: syncRequest }
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
    isApplied(syncKey) {
      return lastAppliedKey === syncKey
    },
    isActive(syncKey) {
      return active?.key === syncKey
    },
    start(syncKey) {
      active?.controller.abort()
      const request = {
        key: syncKey,
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
