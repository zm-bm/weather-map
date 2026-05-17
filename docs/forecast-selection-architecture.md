# Forecast Selection Architecture

Plan for moving Weather Map to a layer-first forecast selection model.

## Goal

Users should choose the weather concept they want to see first, then choose or inherit a compatible forecast model. Forecast models should describe data availability; they should not define the product's layer taxonomy.

## User Story

As a Weather Map user, I want to browse stable forecast categories such as Temperature, Precipitation, and Sky & Visibility, choose a layer such as Visibility or Accumulated Precipitation, and have the app select or suggest a model that can provide it.

If my current model cannot provide the selected layer, the app should explain that clearly and offer a compatible model when one exists.

## UX Shape

The selection flow should be:

1. Select a canonical layer group.
2. Select a canonical layer within that group.
3. Select, keep, or auto-resolve a compatible model.

Recommended control order:

```text
Layer group -> Layer -> Model/source
```

The UI should render the canonical groups and layers from the forecast layer catalog, independent of the active model. Model support should appear as availability state, not as missing product choices.

Examples:

- If `visibility` is selected and ICON does not support it, keep `visibility` selected and show that ICON is unavailable for this layer.
- If GFS supports `visibility`, offer GFS as the compatible source.
- If `accumulated_precipitation` is selected and only ICON supports it, suggest or switch to ICON according to the chosen product behavior.
- If no model supports a layer, keep the layer visible but disabled or marked unavailable.

## Product Principles

1. The forecast layer catalog defines user-facing choices: `group_id`, `layer_id`, labels, display defaults, and layer semantics.
2. Forecast model manifests define data availability for a specific model run.
3. Model mapping bridges canonical layers to model-provided artifacts.
4. A model can limit availability, but it should not remove canonical groups or rename canonical layers.
5. User intent should be preserved across model changes whenever possible.
6. Fallbacks should be explicit. The app should not silently replace a selected layer with an unrelated default because the selected model changed.

## Rough Architecture Changes

### 1. Keep the canonical catalog as the primary UI source

`config/forecast_catalog.json` should remain the source of truth for canonical groups, layers, particle layers, labels, display metadata, and frontend source recipes.

The forecast panel should render from this catalog first, then apply model availability annotations.

### 2. Keep cycle manifests artifact-centric

The current cycle manifest shape is directionally correct and should stay focused on one model run's renderable payload inventory:

- model and run identity
- valid times
- artifact IDs actually published for that cycle
- artifact grids, encodings, units, components, and temporal metadata
- frame payload paths, byte lengths, and checksums

Do not turn the cycle manifest into a product catalog. It should not own canonical groups, user-facing layer labels, or layer selection taxonomy.

Small version links may be useful later, for example `catalogVersion`, `artifactRegistryVersion`, or `availabilityIndexVersion`, but the core manifest should remain an artifact/run contract.

### 3. Add a model-layer availability index

Introduce a lightweight availability contract that answers questions such as:

- Which models support this `layer_id`?
- Which layers does this `model_id` currently support?
- Is support native, frontend-derived, ETL-derived, composite, or unavailable?
- Which artifact IDs are required to satisfy this layer for this model?
- Which latest manifest should be loaded after a model is selected?

The index is the long-term replacement for using the active model manifest as the only source of selectable groups/layers.

Suggested shape:

```json
{
  "schema": "weather-map-model-layer-availability-index",
  "schemaVersion": 1,
  "generatedAt": "2026-05-16T00:00:00Z",
  "catalogVersion": "forecast-catalog-v1",
  "models": {
    "gfs": {
      "label": "GFS",
      "latestCycle": "2026051606",
      "latestManifestPath": "manifests/gfs/latest.json"
    },
    "icon": {
      "label": "ICON",
      "latestCycle": "2026051606",
      "latestManifestPath": "manifests/icon/latest.json"
    }
  },
  "layers": {
    "visibility": {
      "models": {
        "gfs": {
          "state": "available",
          "support": "native",
          "requiredArtifacts": ["visibility_surface"]
        },
        "icon": {
          "state": "unsupported",
          "support": "unavailable",
          "requiredArtifacts": []
        }
      }
    }
  }
}
```

This file should be data-driven, not hand-rolled. Generate it at publish time, after ETL has produced and validated the latest successful manifests for each model.

Publish it beside the model manifests:

```text
/manifests/availability-index.json
/manifests/gfs/latest.json
/manifests/icon/latest.json
```

The generator should use source-controlled inputs plus successful ETL output:

- the canonical frontend layer source recipes
- the artifact registry
- per-model artifact/workload configuration
- the latest successful cycle manifests

For each canonical layer/model pair, the generator should classify support from both configured capability and current manifest contents:

- `available`: model is configured to support the layer and the latest manifest contains the required artifacts
- `unsupported`: model is not configured to support the layer
- `temporarily_unavailable`: model is configured to support the layer, but the latest successful manifest is missing required artifacts

Optional artifacts should be recorded but should not block layer availability.

In short: source-controlled inputs, generated deploy artifact. The frontend reads the published index; developers should not manually edit it to change product behavior.

### 4. Treat model selection as source resolution

Model selection should become a resolution step for the selected layer, not the parent of layer selection.

The app should be able to resolve:

```text
selected layer + preferred model -> active model decision
```

Possible outcomes:

- preferred model supports the layer: keep it
- preferred model does not support the layer, another model does: suggest or switch
- no model supports the layer: show unavailable state

### 5. Preserve separate selection state

Selection state should represent independent user intent:

```text
activeGroupId
selectedLayerId
selectedParticleLayerId
activeModelId
selectedCycle
```

`activeGroupId` is browsing state. `selectedLayerId` is the product choice. `activeModelId` is the selected data source. None of these should be collapsed into a manifest-filtered layer list.

### 6. Use manifests for run-specific validation

A model-layer availability index can say a model generally supports a layer. The loaded cycle manifest should still validate that the required artifacts exist for the active run before rendering.

If the index and manifest disagree, the manifest wins for rendering, and the UI should surface the layer as temporarily unavailable for that cycle.

## Target Behavior

The app should support these states cleanly:

| State | Expected behavior |
| --- | --- |
| Layer supported by active model | Render normally. |
| Layer unsupported by active model but supported elsewhere | Keep layer selected; show compatible model option. |
| Layer unsupported by every model | Keep catalog entry visible but unavailable. |
| Model changed while selected layer is unsupported | Preserve selected layer; show unavailable/switch prompt. |
| Cycle manifest missing required artifact | Treat as run-specific unavailable state. |

## Documentation Ownership

Keep the existing doc split:

- `forecast-layer-registry.md`: canonical user-facing groups and layers.
- `forecast-artifact-registry.md`: ETL artifact definitions.
- `forecast-model-mapping.md`: how each model supports each canonical layer.
- this document: selection UX and architectural direction.

## Acceptance Criteria

The long-term refactor is complete when:

1. The forecast panel renders canonical groups and layers independently of the active model manifest.
2. Model availability is shown as annotation, disabled state, suggestion, or source choice.
3. Changing models does not silently replace the selected layer with a model-specific fallback.
4. The app can answer layer-to-model compatibility without loading every full model manifest.
5. The loaded manifest is used for final run-specific render validation, not for defining the product catalog.
