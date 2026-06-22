import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import {
  searchBasemapPlaces,
  type PlaceSearchResult,
} from '@/forecast/place-probes'
import {
  formatMapCoordinates,
  type MapPoint,
} from '../mapPoint'
import { useDismissablePanel } from '../useDismissablePanel'

export type PlaceSearchButtonProps = {
  map: MapLibreMap | null
  isOpen: boolean
  onPlaceSelect?: (point: MapPoint) => void
  onOpenChange: (isOpen: boolean) => void
}

const PLACE_SEARCH_ZOOM = 6

export default function PlaceSearchButton({
  map,
  isOpen,
  onPlaceSelect,
  onOpenChange,
}: PlaceSearchButtonProps) {
  const inputId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const results = isOpen ? searchBasemapPlaces(map, query) : []
  const hasSearchQuery = query.trim().length >= 2
  const showEmptySearchResult = hasSearchQuery && results.length === 0
  const showSearchHint = !hasSearchQuery
  const closePanel = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  useEffect(() => {
    if (!isOpen) return
    inputRef.current?.focus()
  }, [isOpen])

  useDismissablePanel(isOpen, rootRef, closePanel)

  const handleToggle = () => {
    if (!map) return
    onOpenChange(!isOpen)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const firstResult = results[0]
    if (firstResult != null) {
      selectPlace(firstResult)
    }
  }

  const selectPlace = (place: PlaceSearchResult) => {
    if (!map) return

    onPlaceSelect?.({ lon: place.lon, lat: place.lat })
    map.flyTo({
      center: [place.lon, place.lat],
      zoom: Math.max(readMapZoom(map) ?? PLACE_SEARCH_ZOOM, PLACE_SEARCH_ZOOM),
      essential: true,
    })
    setQuery('')
    onOpenChange(false)
  }

  return (
    <div ref={rootRef} className="map-control-group map-control-search">
      <button
        type="button"
        className="map-control-button map-control-button--search"
        title="Search places"
        aria-label="Search places"
        aria-pressed={isOpen}
        aria-expanded={isOpen}
        disabled={map == null}
        onClick={handleToggle}
      >
        <span className="map-control-icon map-control-icon--search" />
      </button>
      {isOpen ? (
        <form
          className="map-control-search-panel"
          role="search"
          aria-label="Search places"
          onSubmit={handleSubmit}
        >
          <div className="map-control-search-header">
            <label className="map-control-search-label wm-display-caps" htmlFor={inputId}>
              Find Place
            </label>
            <button
              type="button"
              className="map-control-search-close"
              aria-label="Close place search"
              onClick={closePanel}
            >
              <span className="map-control-search-close-icon" aria-hidden="true" />
            </button>
          </div>
          <input
            ref={inputRef}
            id={inputId}
            className="map-control-search-input"
            type="search"
            name="map-place-search"
            placeholder="City or place"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {hasSearchQuery && results.length > 0 ? (
            <div className="map-control-search-subhead wm-mono-caps">Results</div>
          ) : null}
          <div
            className="map-control-search-results"
            aria-label="Place results"
          >
            {results.map((place) => (
              <button
                key={place.id}
                type="button"
                className="map-control-search-result"
                onClick={() => selectPlace(place)}
              >
                <span className="map-control-search-result__mark" aria-hidden="true" />
                <span className="map-control-search-result__copy">
                  <span className="map-control-search-result__name">{place.name}</span>
                  <span className="map-control-search-result__coord">
                    {formatPlaceSearchContext(place)}
                  </span>
                </span>
              </button>
            ))}
            {showSearchHint ? (
              <div className="map-control-search-empty wm-mono-caps">Type to search map places</div>
            ) : null}
            {showEmptySearchResult ? (
              <div className="map-control-search-empty wm-mono-caps">No place matches</div>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}

function readMapZoom(map: MapLibreMap): number | null {
  try {
    const zoom = map.getZoom()
    return Number.isFinite(zoom) ? zoom : null
  } catch {
    return null
  }
}

function formatPlaceSearchContext(place: PlaceSearchResult): string {
  const coordinateLabel = formatMapCoordinates(place.lat, place.lon)
  return place.localName && place.localName !== place.name
    ? `${place.localName} / ${coordinateLabel}`
    : coordinateLabel
}
