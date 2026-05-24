import {
  PRESSURE_CONTOUR_HALO_ALPHA,
  PRESSURE_CONTOUR_HALO_COLOR_RGB,
  PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_INTERVAL_HPA,
  PRESSURE_CONTOUR_MAIN_ALPHA,
  PRESSURE_CONTOUR_MAIN_COLOR_RGB,
  PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS,
} from '../constants'

export const PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 v_mercator;
out vec4 outColor;

uniform sampler2D u_pressure_tex_lower;
uniform sampler2D u_pressure_tex_upper;
uniform vec2 u_grid_size;
uniform float u_time_mix;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;

const float CONTOUR_INTERVAL_HPA = ${PRESSURE_CONTOUR_INTERVAL_HPA.toFixed(1)};
const float MAIN_HALF_WIDTH_PX = ${PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX.toFixed(2)};
const float HALO_HALF_WIDTH_PX = ${PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX.toFixed(2)};
const float MAIN_ALPHA = ${PRESSURE_CONTOUR_MAIN_ALPHA.toFixed(2)};
const float HALO_ALPHA = ${PRESSURE_CONTOUR_HALO_ALPHA.toFixed(2)};
const float SMOOTHING_CORNER_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[0].toFixed(1)};
const float SMOOTHING_AXIS_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[1].toFixed(1)};
const float SMOOTHING_CENTER_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[4].toFixed(1)};
const vec3 MAIN_COLOR = vec3(${PRESSURE_CONTOUR_MAIN_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});
const vec3 HALO_COLOR = vec3(${PRESSURE_CONTOUR_HALO_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});

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

vec2 samplePressureTexel(sampler2D pressureTex, int x, int y) {
  float value = texelFetch(pressureTex, ivec2(x, y), 0).r;
  if (isnan(value)) {
    return vec2(0.0, 0.0);
  }
  return vec2(value, 1.0);
}

vec2 blendPressureSample(vec2 lower, vec2 upper, float mixValue) {
  if (lower.y <= 0.0 && upper.y <= 0.0) return vec2(0.0, 0.0);
  return lower.y <= 0.0
    ? vec2(upper.x, 1.0)
    : (upper.y <= 0.0 ? vec2(lower.x, 1.0) : vec2(mix(lower.x, upper.x, mixValue), 1.0));
}

vec2 samplePressureBilinear(sampler2D pressureTex, float gridX, float gridY, float nx, float ny) {
  float wrappedX = wrapRepeat(gridX, nx);
  float clampedY = clamp(gridY, 0.0, ny - 1.0);
  int x0 = int(floor(wrappedX));
  int y0 = int(floor(clampedY));
  int x1 = int(wrapRepeat(float(x0 + 1), nx));
  int y1 = min(y0 + 1, int(ny) - 1);

  float tx = fract(wrappedX);
  float ty = fract(clampedY);
  float w00 = (1.0 - tx) * (1.0 - ty);
  float w10 = tx * (1.0 - ty);
  float w01 = (1.0 - tx) * ty;
  float w11 = tx * ty;

  vec2 s00 = samplePressureTexel(pressureTex, x0, y0);
  vec2 s10 = samplePressureTexel(pressureTex, x1, y0);
  vec2 s01 = samplePressureTexel(pressureTex, x0, y1);
  vec2 s11 = samplePressureTexel(pressureTex, x1, y1);

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

  return vec2(value, 1.0);
}

vec2 sampleInterpolatedPressure(float gridX, float gridY, float nx, float ny, float mixValue) {
  return blendPressureSample(
    samplePressureBilinear(u_pressure_tex_lower, gridX, gridY, nx, ny),
    samplePressureBilinear(u_pressure_tex_upper, gridX, gridY, nx, ny),
    mixValue
  );
}

float kernelWeight(float offsetX, float offsetY) {
  bool centerX = abs(offsetX) < 0.5;
  bool centerY = abs(offsetY) < 0.5;
  if (centerX && centerY) return SMOOTHING_CENTER_WEIGHT;
  if (centerX || centerY) return SMOOTHING_AXIS_WEIGHT;
  return SMOOTHING_CORNER_WEIGHT;
}

vec2 sampleSmoothedPressureHpa(float gridX, float gridY, float nx, float ny, float mixValue) {
  vec2 center = sampleInterpolatedPressure(gridX, gridY, nx, ny, mixValue);
  if (center.y <= 0.0) return vec2(0.0, 0.0);

  float weightedPressureHpa = 0.0;
  float totalWeight = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float offsetX = float(x);
      float offsetY = float(y);
      vec2 pressureSample = sampleInterpolatedPressure(gridX + offsetX, gridY + offsetY, nx, ny, mixValue);
      if (pressureSample.y <= 0.0) continue;

      float weight = kernelWeight(offsetX, offsetY);
      weightedPressureHpa += pressureSample.x * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0.0) return vec2(0.0, 0.0);
  return vec2(weightedPressureHpa / totalWeight, 1.0);
}

float contourPhaseDistanceHpa(float pressureHpa) {
  float phase = mod(pressureHpa, CONTOUR_INTERVAL_HPA);
  return min(phase, CONTOUR_INTERVAL_HPA - phase);
}

float contourPhaseBandAlpha(float distanceHpa, float pressureDerivativeHpa, float halfWidthPx) {
  if (pressureDerivativeHpa <= 1e-5) return 0.0;
  float derivative = max(pressureDerivativeHpa, 1e-4);
  float inner = derivative * halfWidthPx;
  float outer = derivative * (halfWidthPx + 1.0);
  return 1.0 - smoothstep(inner, outer, distanceHpa);
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

  float mixValue = clamp(u_time_mix, 0.0, 1.0);
  vec2 pressureSample = sampleSmoothedPressureHpa(gridX, gridY, nx, ny, mixValue);
  if (pressureSample.y <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  float pressureHpa = pressureSample.x;
  float pressureDerivativeHpa = fwidth(pressureHpa);
  float distanceHpa = contourPhaseDistanceHpa(pressureHpa);
  float haloAlpha = contourPhaseBandAlpha(distanceHpa, pressureDerivativeHpa, HALO_HALF_WIDTH_PX) * HALO_ALPHA;
  float mainAlpha = contourPhaseBandAlpha(distanceHpa, pressureDerivativeHpa, MAIN_HALF_WIDTH_PX) * MAIN_ALPHA;
  float alpha = max(haloAlpha, mainAlpha);

  if (alpha <= 0.001) {
    outColor = vec4(0.0);
    return;
  }

  vec3 color = mix(HALO_COLOR, MAIN_COLOR, smoothstep(0.0, MAIN_ALPHA, mainAlpha));
  outColor = vec4(color, alpha);
}
`
