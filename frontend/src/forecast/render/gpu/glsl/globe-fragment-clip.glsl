uniform highp vec4 u_projection_clipping_plane;
uniform highp float u_projection_transition;

const float GLOBE_FRAGMENT_CLIP_PI = 3.14159265358979323846;
const float GLOBE_FRAGMENT_CLIP_TRANSITION_THRESHOLD = 0.2;

vec3 globeFragmentSpherePosition(vec2 mercator) {
  vec2 spherical;
  spherical.x = mercator.x * GLOBE_FRAGMENT_CLIP_PI * 2.0 + GLOBE_FRAGMENT_CLIP_PI;
  spherical.y = 2.0 * atan(exp(GLOBE_FRAGMENT_CLIP_PI - (mercator.y * GLOBE_FRAGMENT_CLIP_PI * 2.0))) -
    GLOBE_FRAGMENT_CLIP_PI * 0.5;

  float radiusAtLatitude = cos(spherical.y);
  return vec3(
    sin(spherical.x) * radiusAtLatitude,
    sin(spherical.y),
    cos(spherical.x) * radiusAtLatitude
  );
}

bool globeFragmentOutsideVisibleHemisphere(vec2 mercator) {
  if (u_projection_transition <= GLOBE_FRAGMENT_CLIP_TRANSITION_THRESHOLD) {
    return false;
  }

  vec3 spherePos = globeFragmentSpherePosition(mercator);
  return dot(spherePos, u_projection_clipping_plane.xyz) + u_projection_clipping_plane.w < 0.0;
}
