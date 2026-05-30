import {
  samplePaletteColor,
  type PaletteColorStop,
} from '@/forecast/display/palette'
import {
  formatUnitLegendValue,
  toNative,
  type GradientUnitOption,
  type LegendLabel,
} from '@/forecast/display/units'

export type LegendTick = {
  value: number
  positionPct: number
  label: string
}

const LEGEND_EDGE_PADDING_PCT = 6
const LEGEND_LABEL_SPAN_PCT = 100 - (LEGEND_EDGE_PADDING_PCT * 2)

export function getLegendTicks(
  option: GradientUnitOption,
): LegendTick[] {
  const labels = option.legendLabels
  assertLegendLabels(labels, option)
  const intervalCount = Math.max(1, labels.length - 1)

  return labels.map((value, index) => ({
    value: legendLabelValue(value),
    positionPct: legendLabelPositionPct(index, intervalCount),
    label: legendLabelText(value, option),
  }))
}

export function toLegendContinuousGradient(
  stops: readonly PaletteColorStop[],
  option: GradientUnitOption,
  direction = 'to top',
): string {
  const labels = option.legendLabels
  assertLegendLabels(labels, option)
  const intervalCount = Math.max(1, labels.length - 1)
  const labelStops = labels
    .map((value, index) => {
      const color = samplePaletteColor(stops, toNative(legendLabelValue(value), option), 'interpolated')
      return {
        color: legendColor(...color),
        positionPct: legendLabelPositionPct(index, intervalCount),
      }
    })
  const gradientStops = [
    gradientStop(labelStops[0].color, 0),
    ...labelStops.map((stop) => gradientStop(stop.color, stop.positionPct)),
    gradientStop(labelStops[labelStops.length - 1].color, 100),
  ].join(', ')

  return `linear-gradient(${direction}, ${gradientStops})`
}

function assertLegendLabels(
  labels: readonly LegendLabel[],
  option: GradientUnitOption,
): void {
  if (labels.length < 2) {
    throw new Error(`Missing legend labels for unit option ${option.id}`)
  }
}

function legendLabelValue(label: LegendLabel): number {
  return typeof label === 'number' ? label : label.value
}

function legendLabelText(label: LegendLabel, option: GradientUnitOption): string {
  return typeof label === 'number' ? formatUnitLegendValue(label, option) : label.label
}

function legendLabelPositionPct(index: number, intervalCount: number): number {
  return LEGEND_EDGE_PADDING_PCT + ((index / intervalCount) * LEGEND_LABEL_SPAN_PCT)
}

function gradientStop(color: string, positionPct: number): string {
  return `${color} ${positionPct.toFixed(1)}%`
}

function legendColor(r: number, g: number, b: number, a: number): string {
  if (a >= 255) return `rgb(${r} ${g} ${b})`
  return `rgb(${r} ${g} ${b} / ${Number((a / 255).toFixed(3))})`
}
