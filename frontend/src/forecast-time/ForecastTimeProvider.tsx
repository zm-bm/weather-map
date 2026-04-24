import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'

import type { CycleManifest } from '../manifest'
import {
  clampForecastValidTimeMs,
  initialForecastValidTimeMs,
  stepForecastValidTimeMs,
} from './time'
import {
  createForecastTimeState,
  DEFAULT_PLAY_MIN_INTERVAL_MS,
  DEFAULT_PLAY_STEP_COUNT,
  reduceForecastTimeState,
} from './state'
import { ForecastTimeContext, type ForecastTimeContextValue } from './ForecastTimeContext'

const EMPTY_FORECAST_HOURS: string[] = []

export default function ForecastTimeProvider({
  manifest,
  children,
}: {
  manifest: CycleManifest | null
  children: ReactNode
}) {
  const cycle = manifest?.cycle ?? null
  const forecastHours = manifest?.forecastHours ?? EMPTY_FORECAST_HOURS
  const forecastHourCount = forecastHours.length
  const initialTimeMs = initialForecastValidTimeMs(cycle, forecastHours)

  const [state, dispatch] = useReducer(
    reduceForecastTimeState,
    initialTimeMs,
    createForecastTimeState
  )

  const requestTime = useCallback((targetTimeMs: number) => {
    dispatch({
      type: 'requestTime',
      timeMs: clampForecastValidTimeMs(cycle, forecastHours, targetTimeMs),
    })
  }, [cycle, forecastHours])

  const requestNext = useCallback(() => {
    const referenceTimeMs = state.pendingTimeMs ?? state.targetTimeMs
    requestTime(
      stepForecastValidTimeMs(
        cycle,
        forecastHours,
        referenceTimeMs,
        1
      )
    )
  }, [cycle, forecastHours, requestTime, state.pendingTimeMs, state.targetTimeMs])

  const requestPrev = useCallback(() => {
    const referenceTimeMs = state.pendingTimeMs ?? state.targetTimeMs
    requestTime(
      stepForecastValidTimeMs(
        cycle,
        forecastHours,
        referenceTimeMs,
        -1
      )
    )
  }, [cycle, forecastHours, requestTime, state.pendingTimeMs, state.targetTimeMs])

  const togglePlay = useCallback(() => {
    if (forecastHourCount <= 1) return
    dispatch({ type: 'togglePlay' })
  }, [forecastHourCount])

  const onRequestStart = useCallback((timeMs: number) => {
    dispatch({
      type: 'requestStart',
      timeMs: clampForecastValidTimeMs(cycle, forecastHours, timeMs),
    })
  }, [cycle, forecastHours])

  const onRequestApplied = useCallback((timeMs: number) => {
    dispatch({
      type: 'requestApplied',
      timeMs: clampForecastValidTimeMs(cycle, forecastHours, timeMs),
      nowMs: Date.now(),
    })
  }, [cycle, forecastHours])

  const onRequestError = useCallback(() => {
    dispatch({ type: 'requestError' })
  }, [])

  const sync = useMemo(() => ({
    onRequestStart,
    onRequestApplied,
    onRequestError,
  }), [onRequestApplied, onRequestError, onRequestStart])

  useEffect(() => {
    if (!state.isPlaying || state.isInFlight || forecastHourCount <= 1) return
    const elapsedMs = Date.now() - state.lastAppliedAtMs
    const delayMs = Math.max(0, DEFAULT_PLAY_MIN_INTERVAL_MS - elapsedMs)

    const timerId = window.setTimeout(() => {
      dispatch({
        type: 'requestTime',
        timeMs: stepForecastValidTimeMs(
          cycle,
          forecastHours,
          state.appliedTimeMs,
          DEFAULT_PLAY_STEP_COUNT
        ),
      })
    }, delayMs)

    return () => window.clearTimeout(timerId)
  }, [
    cycle,
    forecastHours,
    forecastHourCount,
    state.appliedTimeMs,
    state.isInFlight,
    state.isPlaying,
    state.lastAppliedAtMs,
  ])

  const value = useMemo<ForecastTimeContextValue>(() => ({
    cycle,
    forecastHours,
    state: {
      appliedTimeMs: state.appliedTimeMs,
      targetTimeMs: state.targetTimeMs,
      pendingTimeMs: state.pendingTimeMs,
      isInFlight: state.isInFlight,
      isPlaying: state.isPlaying,
    },
    controls: {
      requestTime,
      requestNext,
      requestPrev,
      togglePlay,
    },
    sync,
  }), [
    cycle,
    forecastHours,
    requestTime,
    requestNext,
    requestPrev,
    togglePlay,
    state.appliedTimeMs,
    state.isInFlight,
    state.isPlaying,
    state.pendingTimeMs,
    state.targetTimeMs,
    sync,
  ])

  return (
    <ForecastTimeContext.Provider value={value}>
      {children}
    </ForecastTimeContext.Provider>
  )
}
