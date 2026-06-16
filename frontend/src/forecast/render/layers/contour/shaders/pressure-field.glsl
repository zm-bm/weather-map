struct PressureFieldSample {
  float pressureHpa;
  float coverage;
  float valid;
};

struct PressureFieldCell {
  PressureFieldSample s00;
  PressureFieldSample s10;
  PressureFieldSample s01;
  PressureFieldSample s11;
  float valid;
};

PressureFieldSample pressureFieldMissing() {
  return PressureFieldSample(0.0, 0.0, 0.0);
}

PressureFieldSample pressureFieldValue(float pressureHpa, float coverage) {
  return PressureFieldSample(pressureHpa, coverage, 1.0);
}

PressureFieldCell pressureFieldCellMissing() {
  PressureFieldSample missing = pressureFieldMissing();
  return PressureFieldCell(missing, missing, missing, missing, 0.0);
}

PressureFieldCell pressureFieldCellValue(
  PressureFieldSample s00,
  PressureFieldSample s10,
  PressureFieldSample s01,
  PressureFieldSample s11
) {
  return PressureFieldCell(s00, s10, s01, s11, 1.0);
}

PressureFieldSample samplePressureFieldTexel(sampler2D pressureTex, int x, int y) {
  vec2 field = texelFetch(pressureTex, ivec2(x, y), 0).rg;
  if (isnan(field.r) || isnan(field.g) || field.g < MIN_CONTOUR_COVERAGE) {
    return pressureFieldMissing();
  }

  return pressureFieldValue(field.r, field.g);
}

PressureFieldCell samplePressureFieldCell(sampler2D pressureTex, EncodedGridLocation location) {
  if (location.valid <= 0.0) return pressureFieldCellMissing();

  PressureFieldSample s00 = samplePressureFieldTexel(pressureTex, location.x0, location.y0);
  PressureFieldSample s10 = samplePressureFieldTexel(pressureTex, location.x1, location.y0);
  PressureFieldSample s01 = samplePressureFieldTexel(pressureTex, location.x0, location.y1);
  PressureFieldSample s11 = samplePressureFieldTexel(pressureTex, location.x1, location.y1);
  if (s00.valid <= 0.0 || s10.valid <= 0.0 || s01.valid <= 0.0 || s11.valid <= 0.0) {
    return pressureFieldCellMissing();
  }

  return pressureFieldCellValue(s00, s10, s01, s11);
}

PressureFieldSample blendPressureFieldSamples(
  PressureFieldSample lower,
  PressureFieldSample upper,
  float mixValue
) {
  if (mixValue <= 0.0) return lower;
  if (mixValue >= 1.0) return upper;
  if (lower.valid <= 0.0 || upper.valid <= 0.0) return pressureFieldMissing();

  return pressureFieldValue(
    mix(lower.pressureHpa, upper.pressureHpa, mixValue),
    min(lower.coverage, upper.coverage)
  );
}

PressureFieldCell blendPressureFieldCells(
  PressureFieldCell lower,
  PressureFieldCell upper,
  float mixValue
) {
  if (mixValue <= 0.0) return lower;
  if (mixValue >= 1.0) return upper;
  if (lower.valid <= 0.0 || upper.valid <= 0.0) return pressureFieldCellMissing();

  PressureFieldSample s00 = blendPressureFieldSamples(lower.s00, upper.s00, mixValue);
  PressureFieldSample s10 = blendPressureFieldSamples(lower.s10, upper.s10, mixValue);
  PressureFieldSample s01 = blendPressureFieldSamples(lower.s01, upper.s01, mixValue);
  PressureFieldSample s11 = blendPressureFieldSamples(lower.s11, upper.s11, mixValue);
  if (s00.valid <= 0.0 || s10.valid <= 0.0 || s01.valid <= 0.0 || s11.valid <= 0.0) {
    return pressureFieldCellMissing();
  }

  return pressureFieldCellValue(s00, s10, s01, s11);
}

float pressureCellMinHpa(PressureFieldCell cell) {
  return min(min(cell.s00.pressureHpa, cell.s10.pressureHpa), min(cell.s01.pressureHpa, cell.s11.pressureHpa));
}

float pressureCellMaxHpa(PressureFieldCell cell) {
  return max(max(cell.s00.pressureHpa, cell.s10.pressureHpa), max(cell.s01.pressureHpa, cell.s11.pressureHpa));
}

float firstContourLevelForCell(float cellMinHpa) {
  return ceil((cellMinHpa - CONTOUR_EDGE_EPSILON_HPA) / CONTOUR_INTERVAL_HPA) * CONTOUR_INTERVAL_HPA;
}

bool pressureCellCanContour(float cellMinHpa, float cellMaxHpa) {
  return cellMaxHpa - cellMinHpa > CONTOUR_EDGE_EPSILON_HPA;
}
