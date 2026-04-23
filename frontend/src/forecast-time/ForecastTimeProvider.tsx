import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'

import type { CycleManifest } from '../manifest'
import {
  closestHourIndex,
  nextHourIndex,
  normalizeHourIndex,
  prevHourIndex,
} from './time'
import {
  createForecastTimeState,
  DEFAULT_BUTTON_DEBOUNCE_MS,
  DEFAULT_PLAY_MIN_INTERVAL_MS,
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
  const initialHourIndex = closestHourIndex(cycle ?? '', forecastHours)

  const [state, dispatch] = useReducer(
    reduceForecastTimeState,
    initialHourIndex,
    createForecastTimeState
  )

  const requestHour = useCallback((targetHourIndex: number) => {
    dispatch({
      type: 'requestHour',
      hourIndex: normalizeHourIndex(targetHourIndex, forecastHourCount),
      nowMs: Date.now(),
      debounceMs: DEFAULT_BUTTON_DEBOUNCE_MS,
    })
  }, [forecastHourCount])

  const requestNext = useCallback(() => {
    const referenceHourIndex = state.pendingHourIndex ?? state.targetHourIndex
    requestHour(nextHourIndex(referenceHourIndex, forecastHourCount))
  }, [forecastHourCount, requestHour, state.pendingHourIndex, state.targetHourIndex])

  const requestPrev = useCallback(() => {
    const referenceHourIndex = state.pendingHourIndex ?? state.targetHourIndex
    requestHour(prevHourIndex(referenceHourIndex, forecastHourCount))
  }, [forecastHourCount, requestHour, state.pendingHourIndex, state.targetHourIndex])

  const togglePlay = useCallback(() => {
    if (forecastHourCount <= 1) return
    dispatch({ type: 'togglePlay' })
  }, [forecastHourCount])

  const onRequestStart = useCallback((hourIndex: number) => {
    dispatch({
      type: 'requestStart',
      hourIndex: normalizeHourIndex(hourIndex, forecastHourCount),
    })
  }, [forecastHourCount])

  const onRequestApplied = useCallback((hourIndex: number) => {
    const nowMs = Date.now()
    dispatch({
      type: 'requestApplied',
      hourIndex: normalizeHourIndex(hourIndex, forecastHourCount),
      nowMs,
    })
    dispatch({
      type: 'flushPending',
      nowMs,
      debounceMs: DEFAULT_BUTTON_DEBOUNCE_MS,
    })
  }, [forecastHourCount])

  const onRequestError = useCallback(() => {
    dispatch({ type: 'requestError' })
  }, [])

  const sync = useMemo(() => ({
    onRequestStart,
    onRequestApplied,
    onRequestError,
  }), [onRequestApplied, onRequestError, onRequestStart])

  useEffect(() => {
    if (state.pendingHourIndex == null || state.pendingRetryAtMs == null) return

    const delayMs = Math.max(0, state.pendingRetryAtMs - Date.now())
    const timerId = window.setTimeout(() => {
      dispatch({
        type: 'flushPending',
        nowMs: Date.now(),
        debounceMs: DEFAULT_BUTTON_DEBOUNCE_MS,
      })
    }, delayMs)

    return () => window.clearTimeout(timerId)
  }, [state.pendingHourIndex, state.pendingRetryAtMs])

  useEffect(() => {
    if (!state.isPlaying || state.isInFlight || forecastHourCount <= 1) return
    const elapsedMs = Date.now() - state.lastAppliedAtMs
    const delayMs = Math.max(0, DEFAULT_PLAY_MIN_INTERVAL_MS - elapsedMs)

    const timerId = window.setTimeout(() => {
      dispatch({
        type: 'requestHour',
        hourIndex: nextHourIndex(state.appliedHourIndex, forecastHourCount),
        nowMs: Date.now(),
        debounceMs: DEFAULT_BUTTON_DEBOUNCE_MS,
      })
    }, delayMs)

    return () => window.clearTimeout(timerId)
  }, [
    forecastHourCount,
    state.appliedHourIndex,
    state.isInFlight,
    state.isPlaying,
    state.lastAppliedAtMs,
  ])

  const value = useMemo<ForecastTimeContextValue>(() => ({
    cycle,
    forecastHours,
    state: {
      appliedHourIndex: state.appliedHourIndex,
      targetHourIndex: state.targetHourIndex,
      pendingHourIndex: state.pendingHourIndex,
      isInFlight: state.isInFlight,
      isPlaying: state.isPlaying,
    },
    controls: {
      requestHour,
      requestNext,
      requestPrev,
      togglePlay,
    },
    sync,
  }), [
    cycle,
    forecastHours,
    requestHour,
    requestNext,
    requestPrev,
    togglePlay,
    state.appliedHourIndex,
    state.isInFlight,
    state.isPlaying,
    state.pendingHourIndex,
    state.targetHourIndex,
    sync,
  ])

  return (
    <ForecastTimeContext.Provider value={value}>
      {children}
    </ForecastTimeContext.Provider>
  )
}
