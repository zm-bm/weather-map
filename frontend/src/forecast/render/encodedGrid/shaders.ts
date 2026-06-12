export const ENCODED_GRID_LOCATION_GLSL = `
const float ENCODED_GRID_PI = 3.14159265358979323846;
const int ENCODED_GRID_X_WRAP_NONE = 0;
const int ENCODED_GRID_X_WRAP_REPEAT = 1;
const int ENCODED_GRID_Y_MODE_NONE = 0;
const int ENCODED_GRID_Y_MODE_CLAMP = 1;

struct EncodedGridLocation {
  float lon;
  float lat;
  float gridX;
  float gridY;
  float valid;
  int x0;
  int y0;
  int x1;
  int y1;
  int nearestX;
  int nearestY;
  float w00;
  float w10;
  float w01;
  float w11;
};

float encodedWrapRepeat(float value, float span) {
  if (span <= 0.0) return value;
  float wrapped = mod(value, span);
  return wrapped < 0.0 ? wrapped + span : wrapped;
}

float mercatorYToLatitude(float y) {
  float normalized = (0.5 - y) * (2.0 * ENCODED_GRID_PI);
  float latitudeRad = 2.0 * atan(exp(normalized)) - (ENCODED_GRID_PI * 0.5);
  return latitudeRad * 180.0 / ENCODED_GRID_PI;
}

EncodedGridLocation encodedGridLocationAt(float gridX, float gridY, vec2 gridSize, int xWrap, int yMode) {
  float nx = gridSize.x;
  float ny = gridSize.y;
  bool xRepeats = xWrap == ENCODED_GRID_X_WRAP_REPEAT;
  bool yClamps = yMode == ENCODED_GRID_Y_MODE_CLAMP;
  bool xValid = xRepeats || (gridX >= -0.5 && gridX <= nx - 0.5);
  bool yValid = yClamps || (gridY >= -0.5 && gridY <= ny - 0.5);
  float sampleGridX = xRepeats ? encodedWrapRepeat(gridX, nx) : clamp(gridX, 0.0, nx - 1.0);
  float sampleGridY = clamp(gridY, 0.0, ny - 1.0);

  int x0 = int(floor(sampleGridX));
  int y0 = int(floor(sampleGridY));
  int x1 = xRepeats ? int(encodedWrapRepeat(float(x0 + 1), nx)) : min(x0 + 1, int(nx) - 1);
  int y1 = min(y0 + 1, int(ny) - 1);
  int nearestX = xRepeats
    ? int(encodedWrapRepeat(floor(sampleGridX + 0.5), nx))
    : clamp(int(floor(sampleGridX + 0.5)), 0, int(nx) - 1);
  int nearestY = clamp(int(floor(sampleGridY + 0.5)), 0, int(ny) - 1);

  float tx = fract(sampleGridX);
  float ty = fract(sampleGridY);

  return EncodedGridLocation(
    0.0,
    0.0,
    sampleGridX,
    sampleGridY,
    xValid && yValid ? 1.0 : 0.0,
    x0,
    y0,
    x1,
    y1,
    nearestX,
    nearestY,
    (1.0 - tx) * (1.0 - ty),
    tx * (1.0 - ty),
    (1.0 - tx) * ty,
    tx * ty
  );
}

EncodedGridLocation encodedGridLocationForLonLat(vec2 lonLat, vec2 gridSize, float lon0, float lat0, float dx, float dy, int xWrap, int yMode) {
  EncodedGridLocation location = encodedGridLocationAt(
    (lonLat.x - lon0) / dx,
    (lonLat.y - lat0) / dy,
    gridSize,
    xWrap,
    yMode
  );
  location.lon = lonLat.x;
  location.lat = lonLat.y;
  return location;
}

EncodedGridLocation encodedGridLocationForMercator(vec2 mercator, vec2 gridSize, float lon0, float lat0, float dx, float dy, int xWrap, int yMode) {
  return encodedGridLocationForLonLat(
    vec2((mercator.x * 360.0) - 180.0, mercatorYToLatitude(mercator.y)),
    gridSize,
    lon0,
    lat0,
    dx,
    dy,
    xWrap,
    yMode
  );
}
`

export const ENCODED_SAMPLE_GLSL = `
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
`

export const ENCODED_TEXTURE_ARRAY_GLSL = `
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
`

export const ENCODED_DERIVED_GLSL = `
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
`

export const ENCODED_GRID_GLSL = `
${ENCODED_GRID_LOCATION_GLSL}
${ENCODED_SAMPLE_GLSL}
${ENCODED_TEXTURE_ARRAY_GLSL}
${ENCODED_DERIVED_GLSL}
`
