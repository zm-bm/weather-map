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

export const PASCALS_PER_HECTOPASCAL = 100.0

export const PRESSURE_CONTOUR_CONSTANTS_GLSL = `
const float PASCALS_PER_HECTOPASCAL = ${PASCALS_PER_HECTOPASCAL.toFixed(1)};
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
`

export const PRESSURE_CONTOUR_STYLE_GLSL = `
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

vec4 pressureContourColor(float pressureHpa) {
  float pressureDerivativeHpa = fwidth(pressureHpa);
  float distanceHpa = contourPhaseDistanceHpa(pressureHpa);
  float haloAlpha = contourPhaseBandAlpha(distanceHpa, pressureDerivativeHpa, HALO_HALF_WIDTH_PX) * HALO_ALPHA;
  float mainAlpha = contourPhaseBandAlpha(distanceHpa, pressureDerivativeHpa, MAIN_HALF_WIDTH_PX) * MAIN_ALPHA;
  float alpha = max(haloAlpha, mainAlpha);
  if (alpha <= 0.001) return vec4(0.0);

  vec3 color = mix(HALO_COLOR, MAIN_COLOR, smoothstep(0.0, MAIN_ALPHA, mainAlpha));
  return vec4(color, alpha);
}
`

export const PRESSURE_SMOOTHING_GLSL = `
float pressureKernelWeight(int offsetX, int offsetY) {
  if (offsetX == 0 && offsetY == 0) return SMOOTHING_CENTER_WEIGHT;
  if (offsetX == 0 || offsetY == 0) return SMOOTHING_AXIS_WEIGHT;
  return SMOOTHING_CORNER_WEIGHT;
}

float pressureMissingValue() {
  return uintBitsToFloat(0x7fc00000u);
}
`
