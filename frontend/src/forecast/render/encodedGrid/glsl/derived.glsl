EncodedSample sampleWindSpeedCell(isampler2DArray textureArray, int x, int y, int hasNodata, int nodata, float scale, float offset) {
  EncodedSample u = sampleLinearLayer(textureArray, 0, x, y, hasNodata, nodata, scale, offset);
  EncodedSample v = sampleLinearLayer(textureArray, 1, x, y, hasNodata, nodata, scale, offset);
  if (u.valid <= 0.0 || v.valid <= 0.0) return encodedMissing();
  return encodedValue(length(vec2(u.value, v.value)));
}

EncodedSample sampleWindSpeedBilinearLayer(isampler2DArray textureArray, EncodedGridLocation location, int hasNodata, int nodata, float scale, float offset) {
  if (location.valid <= 0.0) return encodedMissing();
  return weightedEncodedSample(
    sampleWindSpeedCell(textureArray, location.x0, location.y0, hasNodata, nodata, scale, offset),
    sampleWindSpeedCell(textureArray, location.x1, location.y0, hasNodata, nodata, scale, offset),
    sampleWindSpeedCell(textureArray, location.x0, location.y1, hasNodata, nodata, scale, offset),
    sampleWindSpeedCell(textureArray, location.x1, location.y1, hasNodata, nodata, scale, offset),
    location.w00,
    location.w10,
    location.w01,
    location.w11
  );
}

EncodedSample sampleWindSpeedNearestLayer(isampler2DArray textureArray, EncodedGridLocation location, vec2 gridSize, int hasNodata, int nodata, float scale, float offset) {
  if (location.valid <= 0.0) return encodedMissing();
  return sampleWindSpeedCell(
    textureArray,
    nearestGridX(location, gridSize),
    nearestGridY(location, gridSize),
    hasNodata,
    nodata,
    scale,
    offset
  );
}

EncodedSample sampleWindSpeedTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, EncodedGridLocation location, int hasNodata, int nodata, float scale, float offset, float mixValue) {
  return blendEncodedSamples(
    sampleWindSpeedBilinearLayer(lowerTextureArray, location, hasNodata, nodata, scale, offset),
    sampleWindSpeedBilinearLayer(upperTextureArray, location, hasNodata, nodata, scale, offset),
    clamp(mixValue, 0.0, 1.0)
  );
}

EncodedSample sampleWindSpeedNearestTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, EncodedGridLocation location, vec2 gridSize, int hasNodata, int nodata, float scale, float offset, float mixValue) {
  return blendEncodedSamples(
    sampleWindSpeedNearestLayer(lowerTextureArray, location, gridSize, hasNodata, nodata, scale, offset),
    sampleWindSpeedNearestLayer(upperTextureArray, location, gridSize, hasNodata, nodata, scale, offset),
    clamp(mixValue, 0.0, 1.0)
  );
}
