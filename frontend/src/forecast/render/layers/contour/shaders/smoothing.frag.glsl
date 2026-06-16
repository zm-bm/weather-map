#version 300 es
precision highp float;
precision highp int;
precision highp isampler2DArray;

out float outPressureHpa;

uniform isampler2DArray u_encoded_tex;
uniform vec2 u_grid_size;
uniform int u_has_nodata;
uniform int u_nodata;
uniform float u_scale;
uniform float u_offset;
uniform int u_x_wrap;
uniform int u_y_mode;

#pragma weather-map include pressure-contour-constants
#pragma weather-map include encoded-grid
#pragma weather-map include pressure-smoothing

EncodedSample samplePressureCellHpa(int x, int y) {
  EncodedGridLocation location = encodedGridLocationAt(float(x), float(y), u_grid_size, u_x_wrap, u_y_mode);
  if (location.valid <= 0.0) return encodedMissing();
  EncodedSample pressurePa = sampleLinearLayer(
    u_encoded_tex,
    0,
    location.nearestX,
    location.nearestY,
    u_has_nodata,
    u_nodata,
    u_scale,
    u_offset
  );
  if (pressurePa.valid <= 0.0) return encodedMissing();
  return encodedValue(pressurePa.value / PASCALS_PER_HECTOPASCAL);
}

void main() {
  int centerX = int(gl_FragCoord.x);
  int centerY = int(gl_FragCoord.y);
  EncodedSample center = samplePressureCellHpa(centerX, centerY);
  if (center.valid <= 0.0) {
    outPressureHpa = pressureMissingValue();
    return;
  }

  float weightedPressureHpa = 0.0;
  float totalWeight = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      EncodedSample pressureSample = samplePressureCellHpa(centerX + x, centerY + y);
      if (pressureSample.valid <= 0.0) continue;

      float weight = pressureKernelWeight(x, y);
      weightedPressureHpa += pressureSample.value * weight;
      totalWeight += weight;
    }
  }

  outPressureHpa = totalWeight > 0.0
    ? weightedPressureHpa / totalWeight
    : pressureMissingValue();
}
