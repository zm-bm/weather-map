# Forecast UI Design Principles

This is a direction reference, not a task backlog. Use it to keep future UI
changes aligned with the current product feel.

## Product Direction

Build a map-first forecast workstation with this app's classic Weather Channel
character. The weather layer owns the screen. Controls should feel attached to
edges, temporary, and task-specific.

Use mature weather-map products as a reference for map dominance, sparse chrome,
product labels, and direct map interaction without copying any brand or exact
layout.

## Visual Character

- Keep the modern CRT treatment: fine scanlines, dark glass surfaces, restrained
  borders, and subtle broadcast-weather texture.
- Preserve Star4000 typography, compact uppercase labels, amber active states,
  and the Weather Map / Forecast Workstation voice.
- Avoid heavy bevels, saturated panel fills, oversized shadows, and dashboard
  card layouts that compete with the map.
- Let weather colors, contours, particles, labels, and legends provide the main
  visual energy.

## Screen Hierarchy

- The map is the primary surface.
- Weather Maps is the primary layer browser.
- The timeline is persistent but should stay visually docked and secondary to
  the map.
- The right rail should remain compact, icon-first, and quiet when inactive.
- Source/model controls should feel like provenance for the current forecast,
  not a separate configuration area.

## Weather Product Context

- Prefer weather-product language over raw data labels where the UI interprets
  values for the user.
- Selected and searched point readouts should surface the active field, value,
  category/status, valid time, and source/location details without becoming a
  full panel.
- Legends should stay close to the map and explain the current field with as
  little chrome as possible.
- Basemap labels should remain subordinate to weather labels and overlays.

## Interaction Model

- Temporary panels should open from the control that owns them and stay anchored
  near that trigger.
- Mobile panels should avoid the bottom timeline and remain scrollable inside
  the available map area.
- Controls should expose curated user-facing choices, not renderer internals.
- Keep workflows direct: choose a map, inspect a point, change display options,
  scrub time, or change source without navigating away from the map.

## Loading, Empty, And Error States

- Normal loading should be compact, anchored, and map-native.
- Blocking errors should be visually stronger than loading and provide direct
  recovery actions.
- Empty or unavailable field states should appear near the chrome that owns the
  missing field or action.
- Error copy should name the failed product area, then give the next useful
  action.

## Implementation Guardrails

- Prefer CSS/layout changes before new state or abstractions.
- Preserve forecast data flow, renderer behavior, settings persistence, and
  controller APIs unless the task explicitly changes them.
- Keep UI changes compact and understandable.
- Verify touched components with focused tests, run the frontend build, and
  inspect desktop plus 390px mobile views for layout regressions.
