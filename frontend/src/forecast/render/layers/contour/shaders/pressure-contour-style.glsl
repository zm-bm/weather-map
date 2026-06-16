float contourPhaseDistanceHpa(float pressureHpa) {
  float phase = mod(pressureHpa, CONTOUR_INTERVAL_HPA);
  return min(phase, CONTOUR_INTERVAL_HPA - phase);
}

float contourPhaseBandAlpha(float distanceHpa, float pressureDerivativeHpa, float halfWidthPx) {
  if (pressureDerivativeHpa <= 1e-5) return 0.0;
  float derivative = max(pressureDerivativeHpa, 1e-4);
  float inner = derivative * halfWidthPx;
  float outer = derivative * (halfWidthPx + 1.0);
  return 1.0 - smoothstep(inner, outer, distanceHpa);
}

vec4 pressureContourColor(float pressureHpa) {
  float pressureDerivativeHpa = fwidth(pressureHpa);
  float distanceHpa = contourPhaseDistanceHpa(pressureHpa);
  float haloAlpha = contourPhaseBandAlpha(distanceHpa, pressureDerivativeHpa, HALO_HALF_WIDTH_PX) * HALO_ALPHA;
  float mainAlpha = contourPhaseBandAlpha(distanceHpa, pressureDerivativeHpa, MAIN_HALF_WIDTH_PX) * MAIN_ALPHA;
  float alpha = max(haloAlpha, mainAlpha);
  if (alpha <= 0.001) return vec4(0.0);

  vec3 color = mix(HALO_COLOR, MAIN_COLOR, smoothstep(0.0, MAIN_ALPHA, mainAlpha));
  return vec4(color, alpha);
}
