float pressureKernelWeight(int offsetX, int offsetY) {
  if (offsetX == 0 && offsetY == 0) return SMOOTHING_CENTER_WEIGHT;
  if (offsetX == 0 || offsetY == 0) return SMOOTHING_AXIS_WEIGHT;
  return SMOOTHING_CORNER_WEIGHT;
}

float pressureMissingValue() {
  return uintBitsToFloat(0x7fc00000u);
}
