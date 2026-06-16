const float ENCODED_GRID_PI = 3.14159265358979323846;

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
