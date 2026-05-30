import { ENCODED_GRID_GLSL } from '../../../encodedGrid'

export const CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp isampler2DArray;

in vec2 v_mercator;
out vec4 outColor;

uniform isampler2DArray u_encoded_tex_lower;
uniform isampler2DArray u_encoded_tex_upper;
uniform vec2 u_grid_size;
uniform float u_time_mix;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_scale;
uniform float u_offset;
uniform float u_opacity;
uniform float u_zoom;
uniform vec3 u_low_cloud_color;
uniform vec3 u_middle_cloud_color;
uniform vec3 u_high_cloud_color;

${ENCODED_GRID_GLSL}

vec4 sampleCloudDecks(float sampleGridX, float sampleGridY, float nx, float ny, float mixValue) {
  EncodedGridLocation location = encodedGridLocationAt(sampleGridX, sampleGridY, vec2(nx, ny));

  EncodedSample low = sampleLinearClampedTemporalLayer(
    u_encoded_tex_lower,
    u_encoded_tex_upper,
    0,
    location,
    1,
    -128,
    u_scale / 100.0,
    u_offset / 100.0,
    0.0,
    1.0,
    mixValue
  );
  EncodedSample middle = sampleLinearClampedTemporalLayer(
    u_encoded_tex_lower,
    u_encoded_tex_upper,
    1,
    location,
    1,
    -128,
    u_scale / 100.0,
    u_offset / 100.0,
    0.0,
    1.0,
    mixValue
  );
  EncodedSample high = sampleLinearClampedTemporalLayer(
    u_encoded_tex_lower,
    u_encoded_tex_upper,
    2,
    location,
    1,
    -128,
    u_scale / 100.0,
    u_offset / 100.0,
    0.0,
    1.0,
    mixValue
  );

  return vec4(
    low.value * low.valid,
    middle.value * middle.valid,
    high.value * high.valid,
    low.valid + middle.valid + high.valid
  );
}

float hashCloudNoise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float smoothCloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - (2.0 * f));

  float a = hashCloudNoise(i);
  float b = hashCloudNoise(i + vec2(1.0, 0.0));
  float c = hashCloudNoise(i + vec2(0.0, 1.0));
  float d = hashCloudNoise(i + vec2(1.0, 1.0));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float cloudTextureNoise(vec2 lonLat, float zoom) {
  float scale = mix(0.42, 1.18, smoothstep(1.5, 6.0, zoom));
  float broad = smoothCloudNoise(vec2(lonLat.x * scale, lonLat.y * scale * 1.65));
  float fine = smoothCloudNoise(vec2((lonLat.x * scale * 2.9) + 37.0, (lonLat.y * scale * 3.4) - 19.0));
  return ((broad - 0.5) * 0.018) + ((fine - 0.5) * 0.008);
}

float cloudOpacityMax(float zoom) {
  return mix(0.60, 0.70, smoothstep(1.5, 6.0, zoom));
}

float derivedCloudCoverage(float lowCover, float middleCover, float highCover) {
  return 1.0 - ((1.0 - lowCover) * (1.0 - middleCover) * (1.0 - highCover));
}

float cloudDensityFromDecks(vec3 decks) {
  float coverage = derivedCloudCoverage(decks.x, decks.y, decks.z);
  return clamp((coverage * 0.68) + (decks.y * 0.18) + (decks.x * 0.09) + (decks.z * 0.07), 0.0, 1.0);
}

float cloudLuminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float cloudReliefShade(float gridX, float gridY, float nx, float ny, float mixValue, vec3 decks) {
  float sampleStep = mix(2.2, 1.0, smoothstep(2.0, 5.8, u_zoom));
  float centerDensity = cloudDensityFromDecks(decks);
  float eastDensity = cloudDensityFromDecks(sampleCloudDecks(gridX + sampleStep, gridY, nx, ny, mixValue).xyz);
  float southDensity = cloudDensityFromDecks(sampleCloudDecks(gridX, gridY + sampleStep, nx, ny, mixValue).xyz);
  float dx = eastDensity - centerDensity;
  float dy = southDensity - centerDensity;
  return clamp((-dx * 0.74) + (dy * 0.44), -0.16, 0.18);
}

vec4 windyGrayscaleCloud(vec3 decks, float coverage, float reliefShade, float texture, float zoom) {
  float lowCover = decks.x;
  float middleCover = decks.y;
  float highCover = decks.z;
  float strongestDeck = max(max(lowCover, middleCover), highCover);

  float coverageBody = smoothstep(0.08, 0.96, coverage);
  float lowShadow = smoothstep(0.10, 0.88, lowCover);
  float middleBody = smoothstep(0.08, 0.86, middleCover);
  float highVeil = smoothstep(0.08, 0.80, highCover);

  float lowTone = cloudLuminance(u_low_cloud_color);
  float middleTone = cloudLuminance(u_middle_cloud_color);
  float highTone = cloudLuminance(u_high_cloud_color);

  float gray = mix(middleTone, highTone, coverageBody);
  gray -= lowShadow * (1.0 - (middleBody * 0.34)) * 0.23;
  gray -= middleBody * (1.0 - (highVeil * 0.48)) * 0.085;
  gray += highVeil * (1.0 - lowShadow * 0.42) * 0.11;
  gray += reliefShade * smoothstep(0.16, 0.86, coverage);
  gray += texture;
  gray = clamp(gray, lowTone, 1.0);

  vec3 tint = mix(u_middle_cloud_color, u_high_cloud_color, coverageBody);
  tint = mix(tint, u_low_cloud_color, lowShadow * (1.0 - middleBody * 0.34) * 0.35);
  vec3 color = clamp(tint * (gray / max(0.001, cloudLuminance(tint))), 0.0, 1.0);

  float alpha = smoothstep(0.09, 0.88, coverage) *
    mix(0.62, 1.0, smoothstep(0.18, 0.82, strongestDeck)) *
    cloudOpacityMax(zoom);

  return vec4(color, clamp(alpha, 0.0, 0.70));
}

void main() {
  float nx = u_grid_size.x;
  float ny = u_grid_size.y;
  if (nx < 2.0 || ny < 2.0 || u_opacity <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  EncodedGridLocation location = encodedGridLocationForMercator(v_mercator, u_grid_size, u_lon0, u_lat0, u_dx, u_dy);

  float mixValue = clamp(u_time_mix, 0.0, 1.0);
  vec4 cloudDecks = sampleCloudDecks(location.gridX, location.gridY, nx, ny, mixValue);
  if (cloudDecks.w <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  vec3 decks = cloudDecks.xyz;
  float coverage = derivedCloudCoverage(decks.x, decks.y, decks.z);
  float textureMask = smoothstep(0.14, 0.82, coverage);
  float texture = cloudTextureNoise(vec2(location.lon, location.lat), u_zoom) * textureMask;
  float relief = cloudReliefShade(location.gridX, location.gridY, nx, ny, mixValue, decks);
  vec4 cloud = windyGrayscaleCloud(decks, coverage, relief, texture, u_zoom);
  if (cloud.a <= 0.001) {
    outColor = vec4(0.0);
    return;
  }

  outColor = vec4(cloud.rgb, cloud.a * u_opacity);
}
`
