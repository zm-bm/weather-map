import { useCallback, useId, useRef } from 'react'

import {
  getForecastRasterLayer,
} from '@/forecast/catalog'
import {
  getActiveRunArtifact,
  getActiveRunLayerAvailability,
  type ActiveForecastRun,
  type ManifestArtifactSpec,
} from '@/forecast/manifest'
import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { formatCycleRunTimeLabel } from '@/forecast/time'
import { useDismissablePanel } from '../useDismissablePanel'

export type MapInfoButtonProps = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

type DatasetInfo = {
  provider?: string
  cadence: string
  source: string
}

const DATASET_INFO: Record<string, DatasetInfo> = {
  gfs: {
    provider: 'NOAA/NCEP',
    cadence: 'Every 6 hours.',
    source: 'GFS forecast guidance from NOAA/NCEP',
  },
  icon: {
    provider: 'DWD',
    cadence: 'Every 6 hours.',
    source: 'ICON forecast guidance from DWD',
  },
  mrms: {
    provider: 'NOAA MRMS',
    cadence: 'As radar analyses update.',
    source: 'NOAA MRMS radar analysis products',
  },
}

const LAYER_INFO: Record<string, string> = {
  temperature: 'near-surface air temperature',
  apparent_temperature: 'apparent temperature, estimating how conditions feel after humidity and wind effects',
  dew_point: 'near-surface dew point and moisture',
  relative_humidity: 'near-surface relative humidity',
  wind_speed: 'sustained wind speed near 10 meters above ground',
  wind_gust: 'forecast peak gust potential near the surface',
  air_pressure: 'mean sea-level pressure patterns',
  precipitation_rate: 'current or forecast precipitation intensity',
  accumulated_precipitation: 'total precipitation accumulated over the field interval',
  cloud_layers: 'low, middle, and high cloud-cover fractions',
  cloud_cover: 'total cloud cover through the atmospheric column',
  composite_reflectivity: 'forecast composite radar reflectivity proxy values',
  observed_radar_composite_reflectivity: 'observed radar composite reflectivity',
}

const PROJECT_URL = 'https://github.com/zm-bm/weather-map'

export default function MapInfoButton({
  isOpen,
  onOpenChange,
}: MapInfoButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const closePanel = useCallback(() => onOpenChange(false), [onOpenChange])

  useDismissablePanel(isOpen, rootRef, closePanel)

  return (
    <div ref={rootRef} className="map-control-group map-control-info" aria-label="Map information controls">
      <button
        type="button"
        className="map-control-button map-control-button--info"
        title="Map information"
        aria-label="Map information"
        aria-pressed={isOpen}
        aria-expanded={isOpen}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span className="map-control-icon map-control-icon--info" />
      </button>
      {isOpen ? <MapInfoPanel onClose={closePanel} /> : null}
    </div>
  )
}

function MapInfoPanel({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const {
    activeRun,
    selectedLayerId,
  } = useLoadedForecastSelectionContext()
  const layer = getForecastRasterLayer(selectedLayerId)
  const availability = getActiveRunLayerAvailability(activeRun, selectedLayerId)
  const artifact = availability?.required_artifacts[0]
    ? getActiveRunArtifact(activeRun, availability.required_artifacts[0])
    : null
  const dataset = DATASET_INFO[activeRun.datasetId] ?? fallbackDatasetInfo(activeRun)
  const layerLabel = layer?.label ?? selectedLayerId ?? 'Selected layer'
  const sourceLabel = dataset.provider ? `${activeRun.label} / ${dataset.provider}` : activeRun.label
  const rows = [
    { label: 'Layer', value: layerLabel },
    { label: 'Source', value: sourceLabel },
    { label: 'Cycle', value: formatCycleRunTimeLabel(activeRun.latest.run.cycle) ?? activeRun.latest.run.cycle },
    { label: 'Updated', value: formatLocalDateTime(activeRun.latest.run.generated_at) },
    { label: 'Updates', value: artifactIntervalLabel(artifact) ?? dataset.cadence },
  ]
  const layerDescription = layer?.id ? LAYER_INFO[layer.id] ?? 'the selected weather field' : 'the selected weather field'

  return (
    <section
      className="map-control-info-panel"
      role="dialog"
      aria-labelledby={titleId}
    >
      <div className="map-control-info-header">
        <strong id={titleId} className="map-control-info-title">About</strong>
        <button
          type="button"
          className="map-control-info-close"
          aria-label="Close data information"
          onClick={onClose}
        >
          <span className="map-control-info-close-icon" aria-hidden="true" />
        </button>
      </div>

      <p className="map-control-info-copy">
        Weather Map is a map-first viewer for public weather datasets rendered
        with custom WebGL layers.{' '}
        <a href={PROJECT_URL} target="_blank" rel="noreferrer">GitHub project</a>
      </p>

      <dl className="map-control-info-summary">
        {rows.map((row) => (
          <div className="map-control-info-row" key={row.label}>
            <dt className="wm-mono-caps">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <p className="map-control-info-copy">
        {layerLabel} maps show {layerDescription} from {dataset.source}.
      </p>
      <p className="map-control-info-note">
        Data may be modified, interpolated, regridded, reformatted, visualized,
        combined with overlays, or otherwise derived. It is not official provider
        output; accuracy, completeness, availability, and suitability are not
        guaranteed.
      </p>
    </section>
  )
}

function fallbackDatasetInfo(activeRun: ActiveForecastRun): DatasetInfo {
  return {
    cadence: 'When a completed run is available.',
    source: `${activeRun.label} data`,
  }
}

function artifactIntervalLabel(artifact: ManifestArtifactSpec | null): string | null {
  const hours = artifact?.source_interval_hours
  if (!Number.isFinite(hours)) return null
  return hours === 1 ? 'Source interval is 1 hour.' : `Source interval is ${hours} hours.`
}

function formatLocalDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return LOCAL_DATE_TIME.format(date)
}

const LOCAL_DATE_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
