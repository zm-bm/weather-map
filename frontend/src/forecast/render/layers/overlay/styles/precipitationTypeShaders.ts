import {
  OVERLAY_LATTICE_VISIBILITY_MAX,
  OVERLAY_LATTICE_VISIBILITY_MIN,
  OVERLAY_MASK_MAX,
  OVERLAY_MASK_MIN,
  OVERLAY_MAX_PATTERN_TILE_PIXELS,
  OVERLAY_MAX_PATTERN_ZOOM,
  OVERLAY_MIN_PATTERN_TILE_PIXELS,
  OVERLAY_MIN_PATTERN_ZOOM,
  OVERLAY_MIX_ALPHA,
  OVERLAY_SNOW_ALPHA,
  OVERLAY_SYMBOL_COLOR_RGB,
} from './precipitationTypeConstants'
import { ENCODED_GRID_GLSL } from '../../../encodedGrid'

export const OVERLAY_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp isampler2DArray;

in vec2 v_mercator;
out vec4 outColor;

uniform isampler2DArray u_encoded_tex_lower;
uniform isampler2DArray u_encoded_tex_upper;
uniform vec2 u_grid_size;
uniform float u_time_mix;
uniform int u_has_nodata;
uniform int u_nodata;
uniform float u_scale;
uniform float u_offset;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_world_size;
uniform float u_pattern_opacity;

const float MIN_PATTERN_ZOOM = ${OVERLAY_MIN_PATTERN_ZOOM.toFixed(1)};
const float MAX_PATTERN_ZOOM = ${OVERLAY_MAX_PATTERN_ZOOM.toFixed(1)};
const float MIN_PATTERN_TILE_SIZE = ${OVERLAY_MIN_PATTERN_TILE_PIXELS.toFixed(1)};
const float MAX_PATTERN_TILE_SIZE = ${OVERLAY_MAX_PATTERN_TILE_PIXELS.toFixed(1)};
const float TYPE_MASK_MIN = ${OVERLAY_MASK_MIN.toFixed(2)};
const float TYPE_MASK_MAX = ${OVERLAY_MASK_MAX.toFixed(2)};
const float LATTICE_VISIBILITY_MIN = ${OVERLAY_LATTICE_VISIBILITY_MIN.toFixed(2)};
const float LATTICE_VISIBILITY_MAX = ${OVERLAY_LATTICE_VISIBILITY_MAX.toFixed(2)};
const float SNOW_ALPHA = ${OVERLAY_SNOW_ALPHA.toFixed(2)};
const float MIX_ALPHA = ${OVERLAY_MIX_ALPHA.toFixed(2)};
const vec3 SYMBOL_COLOR = vec3(${OVERLAY_SYMBOL_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});

${ENCODED_GRID_GLSL}

EncodedSample sampleComponent(int componentIndex, EncodedGridLocation location, float mixValue) {
  return sampleLinearClampedTemporalLayer(
    u_encoded_tex_lower,
    u_encoded_tex_upper,
    componentIndex,
    location,
    u_has_nodata,
    u_nodata,
    u_scale,
    u_offset,
    0.0,
    1.0,
    mixValue
  );
}

float lineSegment(vec2 p, vec2 a, vec2 b, float radius) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - (ba * h));
  float aa = max(fwidth(d), 0.75);
  return 1.0 - smoothstep(radius, radius + aa, d);
}

vec2 patternCoordinates(vec2 mercator) {
  return vec2(encodedWrapRepeat(mercator.x, 1.0), mercator.y) * u_world_size;
}

float patternZoom() {
  return log2(max(u_world_size, 1.0) / 512.0);
}

float patternTileSize() {
  float t = clamp((patternZoom() - MIN_PATTERN_ZOOM) / max(1e-6, MAX_PATTERN_ZOOM - MIN_PATTERN_ZOOM), 0.0, 1.0);
  return mix(MIN_PATTERN_TILE_SIZE, MAX_PATTERN_TILE_SIZE, t);
}

vec2 patternTile(vec2 patternPx, float tileSize, vec2 offset) {
  return mod(patternPx + offset, tileSize) - (tileSize * 0.5);
}

vec2 patternTileId(vec2 patternPx, float tileSize, vec2 offset) {
  return floor((patternPx + offset) / tileSize);
}

float stableTileHash(vec2 tileId) {
  vec2 p = fract(tileId * vec2(0.1031, 0.11369));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float latticeVisibility(float frac, float mask) {
  return smoothstep(LATTICE_VISIBILITY_MIN, LATTICE_VISIBILITY_MAX, frac) * mask;
}

float snowflakeGlyph(vec2 p, float scale) {
  float arm = 4.8 * scale;
  float radius = 0.58 * scale;
  float glyph = 0.0;
  glyph = max(glyph, lineSegment(p, vec2(-arm, 0.0), vec2(arm, 0.0), radius));
  glyph = max(glyph, lineSegment(p, vec2(-arm * 0.5, -arm * 0.866), vec2(arm * 0.5, arm * 0.866), radius));
  glyph = max(glyph, lineSegment(p, vec2(-arm * 0.5, arm * 0.866), vec2(arm * 0.5, -arm * 0.866), radius));
  glyph = max(glyph, 1.0 - smoothstep(0.75 * scale, 1.45 * scale, length(p)));
  return clamp(glyph, 0.0, 1.0);
}

float snowLatticePattern(vec2 patternPx, float tileSize, float visibility) {
  vec2 offset = vec2(5.0, 11.0);
  vec2 tileId = patternTileId(patternPx, tileSize, offset);
  float visible = stableTileHash(tileId) < visibility ? 1.0 : 0.0;
  vec2 p = patternTile(patternPx, tileSize, offset);
  float scale = tileSize / MAX_PATTERN_TILE_SIZE;
  float glyph = snowflakeGlyph(p, scale);
  return clamp(glyph * visible, 0.0, 1.0);
}

float iceDashGlyph(vec2 p, float scale) {
  return lineSegment(p, vec2(-3.1 * scale, 3.1 * scale), vec2(3.1 * scale, -3.1 * scale), 0.82 * scale);
}

float mixGlyphPattern(vec2 patternPx, float tileSize, float visibility) {
  vec2 offset = vec2(14.0, 6.0);
  vec2 tileId = patternTileId(patternPx, tileSize, offset);
  float visible = stableTileHash(tileId) < visibility ? 1.0 : 0.0;
  vec2 p = patternTile(patternPx, tileSize, offset);
  float scale = tileSize / MAX_PATTERN_TILE_SIZE;
  float useIce = step(0.5, mod(tileId.x + tileId.y, 2.0));
  float glyph = mix(snowflakeGlyph(p, scale), iceDashGlyph(p, scale * 1.2), useIce);
  return clamp(glyph * visible, 0.0, 1.0);
}

void main() {
  float nx = u_grid_size.x;
  float ny = u_grid_size.y;
  if (nx < 2.0 || ny < 2.0) {
    outColor = vec4(0.0);
    return;
  }

  EncodedGridLocation location = encodedGridLocationForMercator(v_mercator, u_grid_size, u_lon0, u_lat0, u_dx, u_dy);
  float mixValue = clamp(u_time_mix, 0.0, 1.0);

  EncodedSample snowSample = sampleComponent(0, location, mixValue);
  EncodedSample mixSample = sampleComponent(1, location, mixValue);
  if (snowSample.valid <= 0.0 && mixSample.valid <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  float snowFrac = snowSample.value;
  float mixFrac = mixSample.value;
  float mixMask = smoothstep(TYPE_MASK_MIN, TYPE_MASK_MAX, mixFrac);
  float snowMask = smoothstep(TYPE_MASK_MIN, TYPE_MASK_MAX, snowFrac) * (1.0 - mixMask);

  vec2 patternPx = patternCoordinates(v_mercator);
  float tileSize = patternTileSize();
  float snowPattern = snowLatticePattern(patternPx, tileSize, latticeVisibility(snowFrac, snowMask)) * snowMask;
  float mixPattern = mixGlyphPattern(patternPx, tileSize, latticeVisibility(mixFrac, mixMask)) * mixMask;

  float snowAlpha = snowPattern * SNOW_ALPHA;
  float mixAlpha = mixPattern * MIX_ALPHA;
  float alpha = max(snowAlpha, mixAlpha) * clamp(u_pattern_opacity, 0.0, 1.0);
  if (alpha <= 0.001) {
    outColor = vec4(0.0);
    return;
  }

  outColor = vec4(SYMBOL_COLOR, alpha);
}
`
