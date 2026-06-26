# Forecast UI Design Principles

## Product Direction

Build a map-first forecast workstation with this app's classic Weather Channel
character. Weather data owns the screen; controls stay edge-attached, compact,
and task-specific.

Use mature weather-map products as reference for map dominance, sparse chrome,
product labels, and direct map interaction without copying brand or exact
layout.

## Visual Character

- Keep the modern CRT treatment: fine scanlines, dark glass surfaces,
  restrained borders, and subtle broadcast-weather texture.
- Preserve Star4000 typography, compact uppercase labels, amber active states,
  and the Weather Map / Forecast Workstation voice.
- Avoid heavy bevels, saturated panel fills, oversized shadows, and dashboard
  card layouts.
- Let weather colors, contours, particles, labels, and legends provide the main
  visual energy.

## Layout and Controls

- Keep the map primary.
- Keep Weather Maps as the primary layer browser.
- Keep the timeline docked and secondary to the map.
- Keep the right rail compact, icon-first, and quiet when inactive.
- Treat source/model controls as provenance for the current forecast, not a
  separate configuration area.
- Open temporary panels from the control that owns them and anchor them near
  that trigger.
- On mobile, avoid the bottom timeline and keep panels scrollable inside the
  map area.
- Expose curated user-facing choices, not renderer internals.

## Weather Context

- Prefer weather-product language over raw data labels when the UI interprets
  values for the user.
- Point readouts should show the active field, value, category/status, valid
  time, and source/location without becoming full panels.
- Keep legends close to the map with as little chrome as possible.
- Keep basemap labels subordinate to weather labels and overlays.

## States and Guardrails

- Keep normal loading compact, anchored, and map-native.
- Put empty or unavailable field states near the control or field that owns the
  missing action.
- Make blocking errors stronger than loading; name the failed product area and
  give the next useful action.
- Prefer CSS/layout changes before new state or abstractions.
- Preserve forecast data flow, renderer behavior, settings persistence, and
  controller APIs unless the task explicitly changes them.
- Verify touched components with focused tests, the frontend build, and
  desktop plus 390px mobile layout checks.
