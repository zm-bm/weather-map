import { ENCODED_GRID_GLSL } from '../../../encodedGrid'
import {
  PRESSURE_CONTOUR_CONSTANTS_GLSL,
  PRESSURE_CONTOUR_STYLE_GLSL,
  PRESSURE_SMOOTHING_GLSL,
} from './constants'

export const PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE = `#version 300 es
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
uniform int u_x_wrap;
uniform int u_y_mode;

${PRESSURE_CONTOUR_CONSTANTS_GLSL}
${ENCODED_GRID_GLSL}
${PRESSURE_SMOOTHING_GLSL}
${PRESSURE_CONTOUR_STYLE_GLSL}

EncodedSample sampleInterpolatedRawPressureHpa(float gridX, float gridY, float mixValue) {
  EncodedGridLocation location = encodedGridLocationAt(gridX, gridY, u_grid_size, u_x_wrap, u_y_mode);
  EncodedSample pressurePa = sampleLinearTemporalLayer(
    u_encoded_tex_lower,
    u_encoded_tex_upper,
    0,
    location,
    u_has_nodata,
    u_nodata,
    u_scale,
    u_offset,
    mixValue
  );
  if (pressurePa.valid <= 0.0) return encodedMissing();
  return encodedValue(pressurePa.value / PASCALS_PER_HECTOPASCAL);
}

EncodedSample sampleSmoothedRawPressureHpa(float gridX, float gridY, float mixValue) {
  EncodedSample center = sampleInterpolatedRawPressureHpa(gridX, gridY, mixValue);
  if (center.valid <= 0.0) return encodedMissing();

  float weightedPressureHpa = 0.0;
  float totalWeight = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      EncodedSample pressureSample = sampleInterpolatedRawPressureHpa(gridX + float(x), gridY + float(y), mixValue);
      if (pressureSample.valid <= 0.0) continue;

      float weight = pressureKernelWeight(x, y);
      weightedPressureHpa += pressureSample.value * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0.0) return encodedMissing();
  return encodedValue(weightedPressureHpa / totalWeight);
}

void main() {
  if (u_grid_size.x < 2.0 || u_grid_size.y < 2.0) {
    outColor = vec4(0.0);
    return;
  }

  EncodedGridLocation location = encodedGridLocationForMercator(
    v_mercator,
    u_grid_size,
    u_lon0,
    u_lat0,
    u_dx,
    u_dy,
    u_x_wrap,
    u_y_mode
  );
  EncodedSample pressureSample = sampleSmoothedRawPressureHpa(location.gridX, location.gridY, clamp(u_time_mix, 0.0, 1.0));
  if (pressureSample.valid <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  outColor = pressureContourColor(pressureSample.value);
}
`
