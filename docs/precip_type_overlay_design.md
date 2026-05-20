# Precipitation Intensity + Type Overlay Design

Goal: render one clean precipitation layer where **precipitation intensity** controls the base color ramp, while **snow / winter-mix type** controls repeating glyph overlays.

This avoids trying to encode rain, snow, and mix only through color tinting, which tends to become hard to read.

Current implementation status: GFS and ICON publish a staged
`precip_type_surface` artifact with `snow_frac` and `mix_frac` components. The
frontend still renders `precipitation_rate` as simple intensity only; glyph
overlays are future work.

---

## Core Rendering Model

Use a common normalized product for all weather models:

```ts
type NormalizedPrecipOverlay = {
  width: number;
  height: number;

  // Liquid-water-equivalent precipitation rate.
  intensityMmHr: Uint16Array;

  // Overlay channels, encoded 0..255.
  snowFrac: Uint8Array;
  mixFrac: Uint8Array;
};
```

Interpretation:

```ts
const snow = snowFrac / 255;
const mix = mixFrac / 255;
const rain = Math.max(0, 1 - snow - mix);
```

Recommended visual mapping:

| Field | Render Behavior |
|---|---|
| `intensityMmHr` | base precipitation color ramp |
| `snowFrac` | snow glyph density / opacity |
| `mixFrac` | winter-mix glyph density / opacity |
| rain | implicit default when precip exists but snow/mix overlays are weak |

The base ramp should answer: **how much precipitation is falling?**  
The glyph overlay should answer: **what kind of precipitation is it?**

---

## Why Not Store Hard Categories?

Avoid using only:

```txt
0 = rain
1 = snow
2 = mix
```

Hard categorical fields create blocky, cliff-like boundaries, especially on coarse model grids.

Prefer soft overlay fields:

```txt
snowFrac = 0.0 .. 1.0
mixFrac  = 0.0 .. 1.0
```

Then sample these fields linearly in the shader and apply soft thresholds:

```glsl
float snowMask = smoothstep(0.35, 0.65, snowFrac);
float mixMask  = smoothstep(0.35, 0.65, mixFrac);
```

This gives smoother, more legible type transitions.

---

## Total Intensity

Use **liquid-water-equivalent precipitation rate** as the single intensity value.

For rate fields in `kg m^-2 s^-1`:

```ts
const intensityMmHr = rateKgM2S * 3600;
```

Reason:

```txt
1 kg/m² water = 1 mm liquid water equivalent
```

For accumulated fields:

```ts
const intensityMmHr = accumulatedMm / accumulationWindowHours;
```

Do not add separate rain/snow components on top of an already-total precipitation rate. Normalize each model into `intensityMmHr`, then render all models the same way.

---

# GFS Implementation

## Recommended Inputs

Use:

```txt
PRATE  = total precipitation rate
CPOFP  = percent frozen precipitation
CRAIN  = categorical rain
CSNOW  = categorical snow
CFRZR  = categorical freezing rain
CICEP  = categorical ice pellets
```

## Intensity

Use `PRATE` as total precipitation intensity:

```ts
const intensityMmHr = prateKgM2S * 3600;
```

`PRATE` is already total liquid-water-equivalent precipitation rate. Do not add snow/rain components to it.

## Type Encoding

Use `CPOFP` plus the categorical fields to produce soft overlay masks:

```ts
const frozenFrac = clamp(cpofp / 100, 0, 1);

let snowFrac = 0;
let mixFrac = 0;

if (intensityMmHr < 0.05) {
  snowFrac = 0;
  mixFrac = 0;
} else if (cfrzr || cicep) {
  // Freezing rain / ice pellets / sleet-like signal.
  mixFrac = 1;
} else if (csnow && crain) {
  // Explicit mixed rain + snow signal.
  mixFrac = 0.75;
  snowFrac = 0.25;
} else if (csnow) {
  snowFrac = 1;
} else if (crain) {
  snowFrac = 0;
  mixFrac = 0;
} else {
  // Fallback if categorical fields are missing or ambiguous.
  snowFrac = smoothstep(0.55, 0.85, frozenFrac);
  mixFrac = smoothBand(frozenFrac, 0.25, 0.75);
}

snowFrac = clamp(snowFrac, 0, 1);
mixFrac = clamp(mixFrac, 0, 1 - snowFrac);
```

Helpers:

```ts
function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothBand(x: number, lo: number, hi: number) {
  return smoothstep(lo, 0.5, x) * (1 - smoothstep(0.5, hi, x));
}
```

## Notes

- `CPOFP` means **percent frozen precipitation**, not strictly percent snow.
- `CFRZR` and `CICEP` should map to winter mix, not snow.
- `CSNOW` should drive snow overlay.
- `CRAIN` is the default no-overlay case.
- The fallback based on `CPOFP` is useful when categorical fields are unavailable or noisy.

---

# ICON Implementation

## Recommended Inputs

Use native rain/snow components:

```txt
rain_gsp = large-scale rain
rain_con = convective rain
snow_gsp = large-scale snow water equivalent
snow_con = convective snow water equivalent
```

## Intensity

Compute total liquid-water-equivalent precipitation:

```ts
const rain = rainGsp + rainCon;
const snow = snowGsp + snowCon;
const total = rain + snow;
```

If fields are rates:

```ts
const intensityMmHr = totalKgM2S * 3600;
```

If fields are accumulations:

```ts
const intensityMmHr = totalAccumMm / accumulationWindowHours;
```

If loading `tot_prec`, use it as a sanity check, not necessarily as the primary source:

```ts
const expectedTotal = rainGsp + rainCon + snowGsp + snowCon;
```

## Type Encoding

Use snow share of total precipitation:

```ts
const snowRatio = total > EPS ? snow / total : 0;
```

Then produce soft overlay fields:

```ts
let snowFrac = 0;
let mixFrac = 0;

if (intensityMmHr < 0.05) {
  snowFrac = 0;
  mixFrac = 0;
} else {
  snowFrac = smoothstep(0.65, 0.95, snowRatio);
  mixFrac = smoothBand(snowRatio, 0.25, 0.75);
}

snowFrac = clamp(snowFrac, 0, 1);
mixFrac = clamp(mixFrac, 0, 1 - snowFrac);
```

## Notes

- ICON is cleaner than GFS for this because rain and snow components are available directly.
- Mixed precip can be inferred from a middle snow/rain ratio.
- The exact thresholds are visual/design choices, not meteorological absolutes.
- Check each GRIB message’s unit and accumulation interval before converting to `mm/hr`.

---

# Shader / Rendering Guidance

## Texture Encoding

One compact option:

```txt
R = encoded intensity
G = snowFrac
B = mixFrac
A = valid / precip mask
```

Or use separate textures if that fits the existing pipeline better.

## Intensity Encoding

Precipitation has a skewed distribution, so nonlinear encoding is useful:

```ts
const encodedIntensity = Math.round(
  65535 * Math.log1p(mmHr / scale) / Math.log1p(maxMmHr / scale)
);
```

Suggested display anchors:

```txt
0.05 mm/hr = visual threshold
1 mm/hr    = steady precip
5 mm/hr    = heavy
15 mm/hr   = very heavy
30+ mm/hr  = extreme
```

## Glyph Rendering

Use glyph density and/or opacity, not just a binary overlay.

Example behavior:

```txt
snowFrac = 0.25 -> sparse flakes
snowFrac = 0.80 -> dense flakes
mixFrac  = 0.25 -> sparse diagonal ticks / dots
mixFrac  = 0.80 -> dense winter-mix pattern
```

Use soft masks:

```glsl
float snowMask = smoothstep(0.35, 0.65, snowFrac);
float mixMask  = smoothstep(0.35, 0.65, mixFrac);
```

Recommended visual structure:

```txt
base color      = total precip intensity
snow overlay    = white/lavender flakes or stipple
winter mix      = magenta/rose diagonal hatch, dots, or ice ticks
rain            = no overlay; base precip ramp only
```

---

# Final Recommendation

Use this common renderer contract:

```txt
intensityMmHr -> base precipitation color ramp
snowFrac      -> snow glyph overlay
mixFrac       -> winter-mix glyph overlay
```

Model adapters:

```txt
GFS:
  intensity = PRATE
  type      = CPOFP + CRAIN/CSNOW/CFRZR/CICEP

ICON:
  intensity = rain_gsp + rain_con + snow_gsp + snow_con
  type      = snow / total ratio
```

The key design choice: **store soft overlay fields, not hard categories.**

Hard categories are fine for debugging. Soft fields are better for polished map rendering.
