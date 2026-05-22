export const CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 v_mercator;
out vec4 outColor;

uniform sampler2D u_cloud_tex;
uniform sampler2D u_cloud_tex_upper;
uniform vec2 u_grid_size;
uniform float u_time_mix;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_scale;
uniform float u_offset;
uniform float u_zoom;

const float CLOUD_NODATA_BYTE = 255.0;
const vec3 WINDY_CLOUD_DARK_GRAY = vec3(0.38);
const vec3 WINDY_CLOUD_MID_GRAY = vec3(0.62);
const vec3 WINDY_CLOUD_WHITE = vec3(0.98);

float mercatorYToLatitude(float y) {
  float normalized = (0.5 - y) * (2.0 * 3.14159265358979323846);
  float latitudeRad = 2.0 * atan(exp(normalized)) - (3.14159265358979323846 * 0.5);
  return latitudeRad * 180.0 / 3.14159265358979323846;
}

float wrapRepeat(float value, float span) {
  if (span <= 0.0) return value;
  float wrapped = mod(value, span);
  return wrapped < 0.0 ? wrapped + span : wrapped;
}

float decodeCloudByte(float normalizedByte) {
  float storedByte = floor((normalizedByte * 255.0) + 0.5);
  if (storedByte >= CLOUD_NODATA_BYTE - 0.5) return -1.0;
  return clamp(((storedByte * u_scale) + u_offset) / 100.0, 0.0, 1.0);
}

vec2 decodeCloudComponent(vec4 texel, int componentIndex) {
  float raw = componentIndex == 0
    ? texel.r
    : (componentIndex == 1 ? texel.g : texel.b);
  float decoded = decodeCloudByte(raw);
  if (decoded < 0.0) return vec2(0.0, 0.0);
  return vec2(decoded, 1.0);
}

vec2 sampleCloudComponent(sampler2D cloudTex, int componentIndex, int x0, int y0, int x1, int y1, float w00, float w10, float w01, float w11) {
  vec2 s00 = decodeCloudComponent(texelFetch(cloudTex, ivec2(x0, y0), 0), componentIndex);
  vec2 s10 = decodeCloudComponent(texelFetch(cloudTex, ivec2(x1, y0), 0), componentIndex);
  vec2 s01 = decodeCloudComponent(texelFetch(cloudTex, ivec2(x0, y1), 0), componentIndex);
  vec2 s11 = decodeCloudComponent(texelFetch(cloudTex, ivec2(x1, y1), 0), componentIndex);

  float totalWeight =
    w00 * s00.y +
    w10 * s10.y +
    w01 * s01.y +
    w11 * s11.y;

  if (totalWeight <= 0.0) {
    return vec2(0.0, 0.0);
  }

  float value =
    (w00 * s00.x * s00.y +
      w10 * s10.x * s10.y +
      w01 * s01.x * s01.y +
      w11 * s11.x * s11.y) / totalWeight;

  return vec2(value, 1.0);
}

vec2 blendCloudComponent(vec2 lower, vec2 upper, float mixValue) {
  if (lower.y <= 0.0 && upper.y <= 0.0) return vec2(0.0, 0.0);
  if (lower.y <= 0.0) return upper;
  if (upper.y <= 0.0) return lower;
  return vec2(mix(lower.x, upper.x, mixValue), 1.0);
}

vec4 sampleCloudDecks(float sampleGridX, float sampleGridY, float nx, float ny, float mixValue) {
  float wrappedGridX = wrapRepeat(sampleGridX, nx);
  float clampedGridY = clamp(sampleGridY, 0.0, ny - 1.0);

  int x0 = int(floor(wrappedGridX));
  int y0 = int(floor(clampedGridY));
  int x1 = int(wrapRepeat(float(x0 + 1), nx));
  int y1 = min(y0 + 1, int(ny) - 1);

  float tx = fract(wrappedGridX);
  float ty = fract(clampedGridY);
  float w00 = (1.0 - tx) * (1.0 - ty);
  float w10 = tx * (1.0 - ty);
  float w01 = (1.0 - tx) * ty;
  float w11 = tx * ty;

  vec2 low = blendCloudComponent(
    sampleCloudComponent(u_cloud_tex, 0, x0, y0, x1, y1, w00, w10, w01, w11),
    sampleCloudComponent(u_cloud_tex_upper, 0, x0, y0, x1, y1, w00, w10, w01, w11),
    mixValue
  );
  vec2 middle = blendCloudComponent(
    sampleCloudComponent(u_cloud_tex, 1, x0, y0, x1, y1, w00, w10, w01, w11),
    sampleCloudComponent(u_cloud_tex_upper, 1, x0, y0, x1, y1, w00, w10, w01, w11),
    mixValue
  );
  vec2 high = blendCloudComponent(
    sampleCloudComponent(u_cloud_tex, 2, x0, y0, x1, y1, w00, w10, w01, w11),
    sampleCloudComponent(u_cloud_tex_upper, 2, x0, y0, x1, y1, w00, w10, w01, w11),
    mixValue
  );

  return vec4(
    low.x * low.y,
    middle.x * middle.y,
    high.x * high.y,
    low.y + middle.y + high.y
  );
}

float hashCloudNoise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float smoothCloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - (2.0 * f));

  float a = hashCloudNoise(i);
  float b = hashCloudNoise(i + vec2(1.0, 0.0));
  float c = hashCloudNoise(i + vec2(0.0, 1.0));
  float d = hashCloudNoise(i + vec2(1.0, 1.0));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float cloudTextureNoise(vec2 lonLat, float zoom) {
  float scale = mix(0.42, 1.18, smoothstep(1.5, 6.0, zoom));
  float broad = smoothCloudNoise(vec2(lonLat.x * scale, lonLat.y * scale * 1.65));
  float fine = smoothCloudNoise(vec2((lonLat.x * scale * 2.9) + 37.0, (lonLat.y * scale * 3.4) - 19.0));
  return ((broad - 0.5) * 0.018) + ((fine - 0.5) * 0.008);
}

float cloudOpacityMax(float zoom) {
  return mix(0.60, 0.70, smoothstep(1.5, 6.0, zoom));
}

float derivedCloudCoverage(float lowCover, float middleCover, float highCover) {
  return 1.0 - ((1.0 - lowCover) * (1.0 - middleCover) * (1.0 - highCover));
}

float cloudDensityFromDecks(vec3 decks) {
  float coverage = derivedCloudCoverage(decks.x, decks.y, decks.z);
  return clamp((coverage * 0.68) + (decks.y * 0.18) + (decks.x * 0.09) + (decks.z * 0.07), 0.0, 1.0);
}

float cloudReliefShade(float gridX, float gridY, float nx, float ny, float mixValue, vec3 decks) {
  float sampleStep = mix(2.2, 1.0, smoothstep(2.0, 5.8, u_zoom));
  float centerDensity = cloudDensityFromDecks(decks);
  float eastDensity = cloudDensityFromDecks(sampleCloudDecks(gridX + sampleStep, gridY, nx, ny, mixValue).xyz);
  float southDensity = cloudDensityFromDecks(sampleCloudDecks(gridX, gridY + sampleStep, nx, ny, mixValue).xyz);
  float dx = eastDensity - centerDensity;
  float dy = southDensity - centerDensity;
  return clamp((-dx * 0.74) + (dy * 0.44), -0.16, 0.18);
}

vec4 windyGrayscaleCloud(vec3 decks, float coverage, float reliefShade, float texture, float zoom) {
  float lowCover = decks.x;
  float middleCover = decks.y;
  float highCover = decks.z;
  float strongestDeck = max(max(lowCover, middleCover), highCover);

  float coverageBody = smoothstep(0.08, 0.96, coverage);
  float lowShadow = smoothstep(0.10, 0.88, lowCover);
  float middleBody = smoothstep(0.08, 0.86, middleCover);
  float highVeil = smoothstep(0.08, 0.80, highCover);

  float gray = mix(WINDY_CLOUD_MID_GRAY.r, WINDY_CLOUD_WHITE.r, coverageBody);
  gray -= lowShadow * (1.0 - (middleBody * 0.34)) * 0.23;
  gray -= middleBody * (1.0 - (highVeil * 0.48)) * 0.085;
  gray += highVeil * (1.0 - lowShadow * 0.42) * 0.11;
  gray += reliefShade * smoothstep(0.16, 0.86, coverage);
  gray += texture;
  gray = clamp(gray, WINDY_CLOUD_DARK_GRAY.r, 1.0);

  float alpha = smoothstep(0.09, 0.88, coverage) *
    mix(0.62, 1.0, smoothstep(0.18, 0.82, strongestDeck)) *
    cloudOpacityMax(zoom);

  return vec4(vec3(gray), clamp(alpha, 0.0, 0.70));
}

void main() {
  float nx = u_grid_size.x;
  float ny = u_grid_size.y;
  if (nx < 2.0 || ny < 2.0) {
    outColor = vec4(0.0);
    return;
  }

  float lon = v_mercator.x * 360.0 - 180.0;
  float lat = mercatorYToLatitude(v_mercator.y);
  float gridX = wrapRepeat((lon - u_lon0) / u_dx, nx);
  float gridY = clamp((lat - u_lat0) / u_dy, 0.0, ny - 1.0);

  float mixValue = clamp(u_time_mix, 0.0, 1.0);
  vec4 cloudDecks = sampleCloudDecks(gridX, gridY, nx, ny, mixValue);
  if (cloudDecks.w <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  vec3 decks = cloudDecks.xyz;
  float coverage = derivedCloudCoverage(decks.x, decks.y, decks.z);
  float textureMask = smoothstep(0.14, 0.82, coverage);
  float texture = cloudTextureNoise(vec2(lon, lat), u_zoom) * textureMask;
  float relief = cloudReliefShade(gridX, gridY, nx, ny, mixValue, decks);
  vec4 cloud = windyGrayscaleCloud(decks, coverage, relief, texture, u_zoom);
  if (cloud.a <= 0.001) {
    outColor = vec4(0.0);
    return;
  }

  outColor = cloud;
}
`
