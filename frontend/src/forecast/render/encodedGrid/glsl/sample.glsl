struct EncodedSample {
  float value;
  float valid;
};

float decodeLinearStored(int stored, float scale, float offset) {
  return (float(stored) * scale) + offset;
}

float decodeTempCStored(int stored) {
  int idx = stored + 127;
  if (idx <= 54) return -35.0 + (float(idx) * 0.5);
  if (idx <= 222) return -7.75 + (float(idx - 55) * 0.25);
  return 34.5 + (float(idx - 223) * 0.5);
}

EncodedSample encodedValue(float value) {
  return EncodedSample(value, 1.0);
}

EncodedSample encodedMissing() {
  return EncodedSample(0.0, 0.0);
}

bool encodedIsMissing(int stored, int hasNodata, int nodata) {
  return hasNodata != 0 && stored == nodata;
}

EncodedSample blendEncodedSamples(EncodedSample lower, EncodedSample upper, float mixValue) {
  if (lower.valid <= 0.0 && upper.valid <= 0.0) return encodedMissing();
  if (lower.valid <= 0.0) return upper;
  if (upper.valid <= 0.0) return lower;
  return encodedValue(mix(lower.value, upper.value, mixValue));
}

EncodedSample weightedEncodedSample(EncodedSample s00, EncodedSample s10, EncodedSample s01, EncodedSample s11, float w00, float w10, float w01, float w11) {
  float totalWeight =
    w00 * s00.valid +
    w10 * s10.valid +
    w01 * s01.valid +
    w11 * s11.valid;

  if (totalWeight <= 0.0) return encodedMissing();

  float value =
    (w00 * s00.value * s00.valid +
      w10 * s10.value * s10.valid +
      w01 * s01.value * s01.valid +
      w11 * s11.value * s11.valid) / totalWeight;

  return encodedValue(value);
}

EncodedSample clampEncodedSample(EncodedSample sampleValue, float minValue, float maxValue) {
  return EncodedSample(clamp(sampleValue.value, minValue, maxValue), sampleValue.valid);
}
