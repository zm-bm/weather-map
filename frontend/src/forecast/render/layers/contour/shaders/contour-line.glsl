vec2 gridDeltaToPixelDelta(vec2 deltaGrid, vec2 gridDx, vec2 gridDy, float determinant) {
  return vec2(
    ((deltaGrid.x * gridDy.y) - (gridDy.x * deltaGrid.y)) / determinant,
    ((gridDx.x * deltaGrid.y) - (deltaGrid.x * gridDx.y)) / determinant
  );
}

float distancePointToSegmentPx(vec2 pointPx, vec2 aPx, vec2 bPx) {
  vec2 ab = bPx - aPx;
  float segmentLengthSq = dot(ab, ab);
  if (segmentLengthSq <= 1e-8) return length(pointPx - aPx);
  float t = clamp(dot(pointPx - aPx, ab) / segmentLengthSq, 0.0, 1.0);
  return length(pointPx - (aPx + (t * ab)));
}

float pressureSegmentDistancePx(
  vec2 cellUv,
  vec2 aUv,
  vec2 bUv,
  vec2 gridDx,
  vec2 gridDy,
  float determinant
) {
  vec2 aPx = gridDeltaToPixelDelta(aUv - cellUv, gridDx, gridDy, determinant);
  vec2 bPx = gridDeltaToPixelDelta(bUv - cellUv, gridDx, gridDy, determinant);
  return distancePointToSegmentPx(vec2(0.0), aPx, bPx);
}

float contourLineAlpha(float distancePx, float halfWidthPx) {
  return 1.0 - smoothstep(halfWidthPx, halfWidthPx + 1.0, distancePx);
}

vec4 pressureContourLineColor(float distancePx) {
  float haloAlpha = contourLineAlpha(distancePx, HALO_HALF_WIDTH_PX) * HALO_ALPHA;
  float mainAlpha = contourLineAlpha(distancePx, MAIN_HALF_WIDTH_PX) * MAIN_ALPHA;
  float alpha = max(haloAlpha, mainAlpha);
  if (alpha <= 0.001) return vec4(0.0);

  vec3 color = mix(HALO_COLOR, MAIN_COLOR, smoothstep(0.0, MAIN_ALPHA, mainAlpha));
  return vec4(color, alpha);
}
