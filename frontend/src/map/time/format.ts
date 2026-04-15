import { cycleMs, validTimeMs } from './core'

const LOCAL_DATE_TIME_WITH_ZONE = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const LOCAL_DATE_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

const LOCAL_TICK_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

const LOCAL_SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

function parseCycle(cycle: string | null | undefined): Date | null {
  const epochMs = cycleMs(cycle)
  if (epochMs == null) return null
  return new Date(epochMs)
}

function parseValidTime(cycle: string | null | undefined, forecastHour: string): Date | null {
  const epochMs = validTimeMs(cycle, forecastHour)
  if (epochMs == null) return null
  return new Date(epochMs)
}

export function cycleLabel(cycle: string | null | undefined): string | null {
  const date = parseCycle(cycle)
  if (!date) return null

  return `Run ${LOCAL_DATE_TIME_WITH_ZONE.format(date)}`
}

export function validLabel(cycle: string | null | undefined, forecastHour: string): string | null {
  const valid = parseValidTime(cycle, forecastHour)
  if (!valid) return null
  return LOCAL_DATE_TIME.format(valid)
}

export function tickLabel(cycle: string | null | undefined, forecastHour: string): string | null {
  const valid = parseValidTime(cycle, forecastHour)
  if (!valid) return null
  return LOCAL_TICK_TIME.format(valid)
}

export function shortTickLabel(cycle: string | null | undefined, forecastHour: string): string | null {
  const valid = parseValidTime(cycle, forecastHour)
  if (!valid) return null
  return LOCAL_SHORT_TIME.format(valid)
}
