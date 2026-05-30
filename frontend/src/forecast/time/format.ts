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

const LOCAL_SCALE_TICK_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
})

const LOCAL_SCALE_TICK_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

const LOCAL_SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const UTC_CYCLE_RUN_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function parseCycle(cycle: string | null | undefined): Date | null {
  if (!cycle || !/^\d{10}$/.test(cycle)) return null

  const year = Number.parseInt(cycle.slice(0, 4), 10)
  const month = Number.parseInt(cycle.slice(4, 6), 10) - 1
  const day = Number.parseInt(cycle.slice(6, 8), 10)
  const hour = Number.parseInt(cycle.slice(8, 10), 10)

  return new Date(Date.UTC(year, month, day, hour))
}

function parseTimestamp(value: number | null | undefined): Date | null {
  if (!Number.isFinite(value)) return null
  return new Date(value as number)
}

export function formatCycleRunTimeLabel(cycle: string | null | undefined): string | null {
  const date = parseCycle(cycle)
  if (!date) return null

  const hour = date.getUTCHours().toString().padStart(2, '0')
  return `${UTC_CYCLE_RUN_DATE.format(date)}, ${hour}Z`
}

export function formatValidTimeLabel(validTimeMsValue: number | null | undefined): string | null {
  const valid = parseTimestamp(validTimeMsValue)
  if (!valid) return null
  return LOCAL_DATE_TIME.format(valid)
}

export function formatValidTimeTickLabel(validTimeMsValue: number | null | undefined): string | null {
  const valid = parseTimestamp(validTimeMsValue)
  if (!valid) return null
  return LOCAL_TICK_TIME.format(valid)
}

export function formatValidTimeScaleLabel(validTimeMsValue: number | null | undefined): string | null {
  const valid = parseTimestamp(validTimeMsValue)
  if (!valid) return null
  if (
    valid.getHours() === 0
    && valid.getMinutes() === 0
    && valid.getSeconds() === 0
    && valid.getMilliseconds() === 0
  ) {
    return LOCAL_SCALE_TICK_DATE.format(valid)
  }
  return LOCAL_SCALE_TICK_TIME.format(valid)
}

export function formatShortValidTimeLabel(validTimeMsValue: number | null | undefined): string | null {
  const valid = parseTimestamp(validTimeMsValue)
  if (!valid) return null
  return LOCAL_SHORT_TIME.format(valid)
}
