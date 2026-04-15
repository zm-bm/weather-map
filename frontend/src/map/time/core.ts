export function cycleMs(cycle: string | null | undefined): number | null {
  if (!cycle || !/^\d{10}$/.test(cycle)) return null

  const year = Number.parseInt(cycle.slice(0, 4), 10)
  const month = Number.parseInt(cycle.slice(4, 6), 10) - 1
  const day = Number.parseInt(cycle.slice(6, 8), 10)
  const hour = Number.parseInt(cycle.slice(8, 10), 10)

  return Date.UTC(year, month, day, hour)
}

export function hourOffsetMs(forecastHour: string): number {
  const hours = Number.parseInt(forecastHour, 10)
  if (!Number.isFinite(hours)) return 0
  return Math.max(0, hours) * 60 * 60 * 1000
}

export function normalizeHourIndex(hourIndex: number, totalHours: number): number {
  if (!Number.isFinite(hourIndex)) return 0
  if (totalHours <= 0) return 0

  const truncated = Math.trunc(hourIndex)
  if (truncated < 0) return 0
  if (truncated >= totalHours) return totalHours - 1
  return truncated
}

export function nextHourIndex(hourIndex: number, totalHours: number): number {
  if (totalHours <= 1) return 0
  return (normalizeHourIndex(hourIndex, totalHours) + 1) % totalHours
}

export function prevHourIndex(hourIndex: number, totalHours: number): number {
  if (totalHours <= 1) return 0
  return (normalizeHourIndex(hourIndex, totalHours) - 1 + totalHours) % totalHours
}

export function hourTokenAt(forecastHours: string[], hourIndex: number): string {
  if (forecastHours.length === 0) return '000'
  const normalizedIndex = normalizeHourIndex(hourIndex, forecastHours.length)
  return forecastHours[normalizedIndex] ?? forecastHours[0] ?? '000'
}

export function validTimeMs(
  cycle: string | null | undefined,
  forecastHour: string
): number | null {
  const cycleEpochMs = cycleMs(cycle)
  if (cycleEpochMs == null) return null
  return cycleEpochMs + hourOffsetMs(forecastHour)
}

export function closestHourIndex(
  cycle: string | null | undefined,
  forecastHours: string[],
  nowMs = Date.now()
): number {
  if (forecastHours.length === 0) return 0
  const cycleEpochMs = cycleMs(cycle)
  if (cycleEpochMs == null) return 0

  let closestIndex = 0
  let closestDistanceMs = Number.POSITIVE_INFINITY

  for (let idx = 0; idx < forecastHours.length; idx += 1) {
    const validAtMs = cycleEpochMs + hourOffsetMs(forecastHours[idx])
    const distanceMs = Math.abs(validAtMs - nowMs)
    if (distanceMs < closestDistanceMs) {
      closestDistanceMs = distanceMs
      closestIndex = idx
    }
  }

  return closestIndex
}
