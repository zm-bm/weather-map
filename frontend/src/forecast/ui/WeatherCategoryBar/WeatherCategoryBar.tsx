import { Fragment, useEffect, useId } from 'react'
import {
  WiBarometer,
  WiCloudy,
  WiHumidity,
  WiRain,
  WiStrongWind,
  WiThermometer,
  WiThunderstorm,
} from 'react-icons/wi'

import {
  forecastRasterLayerLabel,
  FORECAST_RASTER_LAYER_GROUPS,
  FORECAST_RASTER_LAYER_GROUPS_BY_ID,
  FORECAST_RASTER_LAYERS_BY_ID,
  resolveRenderableRasterLayer,
  type ForecastRasterLayerGroup,
} from '@/forecast/catalog'
import {
  getActiveRunLayerAvailability,
  hasAnyAvailableDatasetForLayer,
  type Manifest,
} from '@/forecast/manifest'
import { useLoadedForecastSelectionContext } from '@/forecast/selection'

type WeatherCategoryBarProps = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export default function WeatherCategoryBar({
  isOpen: isMenuOpen,
  onOpenChange,
}: WeatherCategoryBarProps) {
  const {
    activeRun,
    selectedLayerId,
    setSelectedLayer,
  } = useLoadedForecastSelectionContext()
  const categoryListId = useId()
  const selectedLayer = selectedLayerId == null
    ? null
    : FORECAST_RASTER_LAYERS_BY_ID[selectedLayerId]
  const selectedGroupId = selectedLayer?.groupId ?? null
  const selectedGroup = selectedGroupId == null
    ? null
    : FORECAST_RASTER_LAYER_GROUPS_BY_ID[selectedGroupId] ?? null
  const activeFieldIds = selectedGroup?.rasterLayerIds.filter((layerId) => (
    hasAnyAvailableDatasetForLayer(activeRun.manifest, layerId)
  )) ?? []
  const selectedCategoryLabel = selectedGroup?.label ?? 'Weather'
  const selectedCategorySummaryLabel = compactCategoryLabel(selectedCategoryLabel)
  const selectedFieldLabel = selectedLayer == null
    ? 'Select field'
    : forecastRasterLayerLabel(selectedLayer)
  const selectedLayerAvailability = getActiveRunLayerAvailability(activeRun, selectedLayerId)
  const selectedLayerIsRenderable = resolveRenderableRasterLayer(activeRun, selectedLayerId) != null
  const showUnavailableMessage = selectedLayer != null && (
    selectedLayerAvailability?.state === 'temporarily_unavailable' ||
    selectedLayerAvailability?.state === 'unsupported' ||
    !selectedLayerIsRenderable
  )
  const unavailableCopy = selectedLayer == null
    ? null
    : fieldAvailabilityCopy(forecastRasterLayerLabel(selectedLayer), activeRun.label, selectedLayerAvailability?.state)

  useEffect(() => {
    if (!isMenuOpen) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isMenuOpen, onOpenChange])

  return (
    <section
      className={`weather-category-bar${isMenuOpen ? ' weather-category-bar--open' : ' weather-category-bar--collapsed'}`}
      aria-label="Weather maps"
    >
      <button
        type="button"
        className="weather-category-bar__toggle"
        aria-expanded={isMenuOpen}
        aria-controls={categoryListId}
        aria-label="Weather maps"
        onClick={() => onOpenChange(!isMenuOpen)}
      >
        <span className="weather-category-bar__toggle-icon" aria-hidden="true">
          <WeatherGroupIcon groupId={selectedGroupId ?? ''} />
        </span>
        <span className="weather-category-bar__summary">
          <span className="weather-category-bar__summary-field">{selectedFieldLabel}</span>
          <span className="weather-category-bar__summary-category">
            {selectedCategorySummaryLabel}
          </span>
        </span>
        <span className="weather-category-bar__chevron" aria-hidden="true" />
      </button>

      {showUnavailableMessage && unavailableCopy ? (
        <div
          className="weather-category-bar__availability"
          role="status"
          aria-label={`${selectedFieldLabel} availability`}
        >
          <span className="weather-category-bar__availability-signal" aria-hidden="true" />
          <span className="weather-category-bar__availability-status wm-mono-caps">
            {unavailableCopy.status}
          </span>
          <span className="weather-category-bar__availability-detail">
            {unavailableCopy.detail}
          </span>
        </div>
      ) : null}

      <div id={categoryListId} className="weather-category-bar__categories">
        {FORECAST_RASTER_LAYER_GROUPS.map((group) => {
          const availableFieldIds = availableLayerIdsForGroup(activeRun.manifest, group)
          const targetLayerId = availableFieldIds[0] ?? null
          const isActive = selectedGroupId === group.id

          return (
            <Fragment key={group.id}>
              <button
                type="button"
                className={`weather-category-bar__button${isActive ? ' weather-category-bar__button--active' : ''}`}
                aria-label={targetLayerId == null ? `${group.label}, unavailable` : group.label}
                aria-pressed={isActive}
                disabled={targetLayerId == null}
                onClick={() => {
                  if (targetLayerId != null) {
                    setSelectedLayer(targetLayerId)
                  }
                }}
              >
                <span className="weather-category-bar__button-icon" aria-hidden="true">
                  <WeatherGroupIcon groupId={group.id} />
                </span>
                <span className="weather-category-bar__button-text">
                  <span className="weather-category-bar__label">
                    {compactCategoryLabel(group.label)}
                  </span>
                </span>
                {targetLayerId == null ? (
                  <span className="weather-category-bar__state" aria-hidden="true">No data</span>
                ) : null}
              </button>

              {isActive && activeFieldIds.length > 1 ? (
                <div className="weather-category-bar__fields" aria-label={`${selectedGroup?.label ?? 'Weather'} fields`}>
                  {activeFieldIds.map((layerId) => {
                    const layer = FORECAST_RASTER_LAYERS_BY_ID[layerId]
                    const label = layer == null ? String(layerId) : forecastRasterLayerLabel(layer)
                    const isActiveField = selectedLayerId === layerId

                    return (
                      <button
                        key={layerId}
                        type="button"
                        className={`weather-category-bar__field${isActiveField ? ' weather-category-bar__field--active' : ''}`}
                        aria-label={`Field: ${label}`}
                        aria-pressed={isActiveField}
                        onClick={() => {
                          setSelectedLayer(layerId)
                        }}
                      >
                        <span className="weather-category-bar__field-label">{label}</span>
                        {isActiveField ? (
                          <span className="weather-category-bar__field-check" aria-hidden="true" />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}

function availableLayerIdsForGroup(manifest: Manifest, group: ForecastRasterLayerGroup): string[] {
  return group.rasterLayerIds.filter((layerId) => (
    hasAnyAvailableDatasetForLayer(manifest, layerId)
  ))
}

function fieldAvailabilityCopy(
  fieldLabel: string,
  sourceLabel: string,
  state: string | undefined
): { status: string; detail: string } {
  if (state === 'unsupported') {
    return {
      status: 'Source Not Supported',
      detail: `${sourceLabel} does not carry ${fieldLabel}. Choose another weather map or source.`,
    }
  }

  return {
    status: 'No Current Field',
    detail: `${fieldLabel} is missing from this ${sourceLabel} cycle.`,
  }
}

function WeatherGroupIcon({ groupId }: { groupId: string }) {
  switch (groupId) {
    case 'temperature':
      return <WiThermometer focusable="false" />
    case 'humidity':
      return <WiHumidity focusable="false" />
    case 'wind_pressure':
      return <WiStrongWind focusable="false" />
    case 'precipitation':
      return <WiRain focusable="false" />
    case 'clouds_visibility':
      return <WiCloudy focusable="false" />
    case 'radar_storms':
      return <WiThunderstorm focusable="false" />
    default:
      return <WiBarometer focusable="false" />
  }
}

function compactCategoryLabel(label: string): string {
  switch (label) {
    case 'Wind & Pressure':
      return 'Wind/Pres'
    default:
      return label
  }
}
