import {
  FIELD_OVERLAY_LATTICE_VISIBILITY_MAX,
  FIELD_OVERLAY_LATTICE_VISIBILITY_MIN,
  FIELD_OVERLAY_MASK_MAX,
  FIELD_OVERLAY_MASK_MIN,
  FIELD_OVERLAY_MAX_PATTERN_TILE_PIXELS,
  FIELD_OVERLAY_MAX_PATTERN_ZOOM,
  FIELD_OVERLAY_MIN_PATTERN_TILE_PIXELS,
  FIELD_OVERLAY_MIN_PATTERN_ZOOM,
  FIELD_OVERLAY_MIX_ALPHA,
  FIELD_OVERLAY_SNOW_ALPHA,
  FIELD_OVERLAY_SYMBOL_COLOR_RGB,
} from './constants'

export const FIELD_OVERLAY_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 v_mercator;
out vec4 outColor;

uniform sampler2D u_snow_tex;
uniform sampler2D u_snow_tex_upper;
uniform sampler2D u_mix_tex;
uniform sampler2D u_mix_tex_upper;
uniform vec2 u_grid_size;
uniform float u_time_mix;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_world_size;
uniform float u_pattern_opacity;

const float MIN_PATTERN_ZOOM = ${FIELD_OVERLAY_MIN_PATTERN_ZOOM.toFixed(1)};
const float MAX_PATTERN_ZOOM = ${FIELD_OVERLAY_MAX_PATTERN_ZOOM.toFixed(1)};
const float MIN_PATTERN_TILE_SIZE = ${FIELD_OVERLAY_MIN_PATTERN_TILE_PIXELS.toFixed(1)};
const float MAX_PATTERN_TILE_SIZE = ${FIELD_OVERLAY_MAX_PATTERN_TILE_PIXELS.toFixed(1)};
const float TYPE_MASK_MIN = ${FIELD_OVERLAY_MASK_MIN.toFixed(2)};
const float TYPE_MASK_MAX = ${FIELD_OVERLAY_MASK_MAX.toFixed(2)};
const float LATTICE_VISIBILITY_MIN = ${FIELD_OVERLAY_LATTICE_VISIBILITY_MIN.toFixed(2)};
const float LATTICE_VISIBILITY_MAX = ${FIELD_OVERLAY_LATTICE_VISIBILITY_MAX.toFixed(2)};
const float SNOW_ALPHA = ${FIELD_OVERLAY_SNOW_ALPHA.toFixed(2)};
const float MIX_ALPHA = ${FIELD_OVERLAY_MIX_ALPHA.toFixed(2)};
const vec3 SYMBOL_COLOR = vec3(${FIELD_OVERLAY_SYMBOL_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});

float mercatorYToLatitude(float y) {
  float normalized = (0.5 - y) * (2.0 * 3.14159265358979323846);
  float latitudeRad = 2.0 * atan(exp(normalized)) - (3.14159265358979323846 * 0.5);
  return latitudeRad * 180.0 / 3.14159265358979323846;
}

float wrapRepeat(float value, float span) {
  if (span <= 0.0) return value;
  float wrapped = mod(value, span);
  return wrapped < 0.0 ? wrapped + span : wrapped;
}

vec2 sampleDecoded(sampler2D componentTex, int x, int y) {
  float value = texelFetch(componentTex, ivec2(x, y), 0).r;
  if (isnan(value)) {
    return vec2(0.0, 0.0);
  }
  return vec2(value, 1.0);
}

vec2 sampleComponent(sampler2D componentTex, int x0, int y0, int x1, int y1, float w00, float w10, float w01, float w11) {
  vec2 s00 = sampleDecoded(componentTex, x0, y0);
  vec2 s10 = sampleDecoded(componentTex, x1, y0);
  vec2 s01 = sampleDecoded(componentTex, x0, y1);
  vec2 s11 = sampleDecoded(componentTex, x1, y1);

  float totalWeight =
    w00 * s00.y +
    w10 * s10.y +
    w01 * s01.y +
    w11 * s11.y;

  if (totalWeight <= 0.0) {
    return vec2(0.0, 0.0);
  }

  float value =
    (w00 * s00.x * s00.y +
      w10 * s10.x * s10.y +
      w01 * s01.x * s01.y +
      w11 * s11.x * s11.y) / totalWeight;

  return vec2(clamp(value, 0.0, 1.0), 1.0);
}

float blendComponent(vec2 lower, vec2 upper, float mixValue) {
  return lower.y <= 0.0
    ? upper.x
    : (upper.y <= 0.0 ? lower.x : mix(lower.x, upper.x, mixValue));
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
  return vec2(wrapRepeat(mercator.x, 1.0), mercator.y) * u_world_size;
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

  float lon = v_mercator.x * 360.0 - 180.0;
  float lat = mercatorYToLatitude(v_mercator.y);
  float gridX = wrapRepeat((lon - u_lon0) / u_dx, nx);
  float gridY = clamp((lat - u_lat0) / u_dy, 0.0, ny - 1.0);

  int x0 = int(floor(gridX));
  int y0 = int(floor(gridY));
  int x1 = int(wrapRepeat(float(x0 + 1), nx));
  int y1 = min(y0 + 1, int(ny) - 1);

  float tx = fract(gridX);
  float ty = fract(gridY);
  float w00 = (1.0 - tx) * (1.0 - ty);
  float w10 = tx * (1.0 - ty);
  float w01 = (1.0 - tx) * ty;
  float w11 = tx * ty;
  float mixValue = clamp(u_time_mix, 0.0, 1.0);

  vec2 snowLower = sampleComponent(u_snow_tex, x0, y0, x1, y1, w00, w10, w01, w11);
  vec2 snowUpper = sampleComponent(u_snow_tex_upper, x0, y0, x1, y1, w00, w10, w01, w11);
  vec2 mixLower = sampleComponent(u_mix_tex, x0, y0, x1, y1, w00, w10, w01, w11);
  vec2 mixUpper = sampleComponent(u_mix_tex_upper, x0, y0, x1, y1, w00, w10, w01, w11);

  if (snowLower.y <= 0.0 && snowUpper.y <= 0.0 && mixLower.y <= 0.0 && mixUpper.y <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  float snowFrac = blendComponent(snowLower, snowUpper, mixValue);
  float mixFrac = blendComponent(mixLower, mixUpper, mixValue);
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
