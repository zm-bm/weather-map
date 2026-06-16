EncodedSample sampleLinearLayer(isampler2DArray textureArray, int layer, int x, int y, int hasNodata, int nodata, float scale, float offset) {
  int stored = texelFetch(textureArray, ivec3(x, y, layer), 0).r;
  if (encodedIsMissing(stored, hasNodata, nodata)) return encodedMissing();
  return encodedValue(decodeLinearStored(stored, scale, offset));
}

EncodedSample sampleTempCLayer(isampler2DArray textureArray, int layer, int x, int y, int nodata) {
  int stored = texelFetch(textureArray, ivec3(x, y, layer), 0).r;
  if (stored == nodata) return encodedMissing();
  return encodedValue(decodeTempCStored(stored));
}

int nearestGridX(EncodedGridLocation location, vec2 gridSize) {
  return location.nearestX;
}

int nearestGridY(EncodedGridLocation location, vec2 gridSize) {
  return location.nearestY;
}

EncodedSample sampleLinearNearestLayer(isampler2DArray textureArray, int layer, EncodedGridLocation location, vec2 gridSize, int hasNodata, int nodata, float scale, float offset) {
  if (location.valid <= 0.0) return encodedMissing();
  return sampleLinearLayer(
    textureArray,
    layer,
    nearestGridX(location, gridSize),
    nearestGridY(location, gridSize),
    hasNodata,
    nodata,
    scale,
    offset
  );
}

EncodedSample sampleTempCNearestLayer(isampler2DArray textureArray, int layer, EncodedGridLocation location, vec2 gridSize, int nodata) {
  if (location.valid <= 0.0) return encodedMissing();
  return sampleTempCLayer(
    textureArray,
    layer,
    nearestGridX(location, gridSize),
    nearestGridY(location, gridSize),
    nodata
  );
}

EncodedSample sampleLinearBilinearLayer(isampler2DArray textureArray, int layer, EncodedGridLocation location, int hasNodata, int nodata, float scale, float offset) {
  if (location.valid <= 0.0) return encodedMissing();
  return weightedEncodedSample(
    sampleLinearLayer(textureArray, layer, location.x0, location.y0, hasNodata, nodata, scale, offset),
    sampleLinearLayer(textureArray, layer, location.x1, location.y0, hasNodata, nodata, scale, offset),
    sampleLinearLayer(textureArray, layer, location.x0, location.y1, hasNodata, nodata, scale, offset),
    sampleLinearLayer(textureArray, layer, location.x1, location.y1, hasNodata, nodata, scale, offset),
    location.w00,
    location.w10,
    location.w01,
    location.w11
  );
}

EncodedSample sampleTempCBilinearLayer(isampler2DArray textureArray, int layer, EncodedGridLocation location, int nodata) {
  if (location.valid <= 0.0) return encodedMissing();
  return weightedEncodedSample(
    sampleTempCLayer(textureArray, layer, location.x0, location.y0, nodata),
    sampleTempCLayer(textureArray, layer, location.x1, location.y0, nodata),
    sampleTempCLayer(textureArray, layer, location.x0, location.y1, nodata),
    sampleTempCLayer(textureArray, layer, location.x1, location.y1, nodata),
    location.w00,
    location.w10,
    location.w01,
    location.w11
  );
}

EncodedSample sampleLinearTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, int layer, EncodedGridLocation location, int hasNodata, int nodata, float scale, float offset, float mixValue) {
  return blendEncodedSamples(
    sampleLinearBilinearLayer(lowerTextureArray, layer, location, hasNodata, nodata, scale, offset),
    sampleLinearBilinearLayer(upperTextureArray, layer, location, hasNodata, nodata, scale, offset),
    clamp(mixValue, 0.0, 1.0)
  );
}

EncodedSample sampleLinearNearestTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, int layer, EncodedGridLocation location, vec2 gridSize, int hasNodata, int nodata, float scale, float offset, float mixValue) {
  return blendEncodedSamples(
    sampleLinearNearestLayer(lowerTextureArray, layer, location, gridSize, hasNodata, nodata, scale, offset),
    sampleLinearNearestLayer(upperTextureArray, layer, location, gridSize, hasNodata, nodata, scale, offset),
    clamp(mixValue, 0.0, 1.0)
  );
}

EncodedSample sampleLinearNearestClampedTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, int layer, EncodedGridLocation location, vec2 gridSize, int hasNodata, int nodata, float scale, float offset, float minValue, float maxValue, float mixValue) {
  return blendEncodedSamples(
    clampEncodedSample(
      sampleLinearNearestLayer(lowerTextureArray, layer, location, gridSize, hasNodata, nodata, scale, offset),
      minValue,
      maxValue
    ),
    clampEncodedSample(
      sampleLinearNearestLayer(upperTextureArray, layer, location, gridSize, hasNodata, nodata, scale, offset),
      minValue,
      maxValue
    ),
    clamp(mixValue, 0.0, 1.0)
  );
}

EncodedSample sampleLinearClampedTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, int layer, EncodedGridLocation location, int hasNodata, int nodata, float scale, float offset, float minValue, float maxValue, float mixValue) {
  return blendEncodedSamples(
    clampEncodedSample(
      sampleLinearBilinearLayer(lowerTextureArray, layer, location, hasNodata, nodata, scale, offset),
      minValue,
      maxValue
    ),
    clampEncodedSample(
      sampleLinearBilinearLayer(upperTextureArray, layer, location, hasNodata, nodata, scale, offset),
      minValue,
      maxValue
    ),
    clamp(mixValue, 0.0, 1.0)
  );
}

EncodedSample sampleTempCTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, int layer, EncodedGridLocation location, int nodata, float mixValue) {
  return blendEncodedSamples(
    sampleTempCBilinearLayer(lowerTextureArray, layer, location, nodata),
    sampleTempCBilinearLayer(upperTextureArray, layer, location, nodata),
    clamp(mixValue, 0.0, 1.0)
  );
}

EncodedSample sampleTempCNearestTemporalLayer(isampler2DArray lowerTextureArray, isampler2DArray upperTextureArray, int layer, EncodedGridLocation location, vec2 gridSize, int nodata, float mixValue) {
  return blendEncodedSamples(
    sampleTempCNearestLayer(lowerTextureArray, layer, location, gridSize, nodata),
    sampleTempCNearestLayer(upperTextureArray, layer, location, gridSize, nodata),
    clamp(mixValue, 0.0, 1.0)
  );
}
