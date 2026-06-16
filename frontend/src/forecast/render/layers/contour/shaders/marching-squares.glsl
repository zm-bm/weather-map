struct PressureContourPoints {
  vec2 p0;
  vec2 p1;
  vec2 p2;
  vec2 p3;
  int count;
};

struct PressureContourSegments {
  vec2 p0;
  vec2 p1;
  vec2 p2;
  vec2 p3;
  int count;
};

float pressureContourSide(float pressureHpa, float contourLevelHpa) {
  float distanceHpa = pressureHpa - contourLevelHpa;
  return abs(distanceHpa) <= CONTOUR_EDGE_EPSILON_HPA
    ? CONTOUR_EDGE_EPSILON_HPA
    : distanceHpa;
}

bool pressureEdgeCrossesContour(float aHpa, float bHpa, float contourLevelHpa) {
  return pressureContourSide(aHpa, contourLevelHpa) *
    pressureContourSide(bHpa, contourLevelHpa) < 0.0;
}

vec2 pressureEdgeIntersection(
  vec2 aPosition,
  vec2 bPosition,
  float aHpa,
  float bHpa,
  float contourLevelHpa
) {
  float aDistanceHpa = aHpa - contourLevelHpa;
  float bDistanceHpa = bHpa - contourLevelHpa;
  if (abs(aDistanceHpa) <= CONTOUR_EDGE_EPSILON_HPA) return aPosition;
  if (abs(bDistanceHpa) <= CONTOUR_EDGE_EPSILON_HPA) return bPosition;

  float t = clamp(-aDistanceHpa / (bDistanceHpa - aDistanceHpa), 0.0, 1.0);
  return mix(aPosition, bPosition, t);
}

PressureContourPoints pressureContourPointsEmpty() {
  return PressureContourPoints(vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), 0);
}

bool contourPointsEqual(vec2 a, vec2 b) {
  return abs(a.x - b.x) <= 1e-5 && abs(a.y - b.y) <= 1e-5;
}

bool contourPointsContain(PressureContourPoints points, vec2 point) {
  if (points.count > 0 && contourPointsEqual(points.p0, point)) return true;
  if (points.count > 1 && contourPointsEqual(points.p1, point)) return true;
  if (points.count > 2 && contourPointsEqual(points.p2, point)) return true;
  if (points.count > 3 && contourPointsEqual(points.p3, point)) return true;
  return false;
}

PressureContourPoints addUniqueContourIntersection(PressureContourPoints points, vec2 point) {
  if (contourPointsContain(points, point)) return points;
  if (points.count == 0) points.p0 = point;
  else if (points.count == 1) points.p1 = point;
  else if (points.count == 2) points.p2 = point;
  else if (points.count == 3) points.p3 = point;
  if (points.count < 4) points.count++;
  return points;
}

PressureContourPoints pressureMarchingSquareIntersections(
  PressureFieldCell cell,
  float contourLevelHpa
) {
  PressureContourPoints points = pressureContourPointsEmpty();

  if (pressureEdgeCrossesContour(cell.s00.pressureHpa, cell.s10.pressureHpa, contourLevelHpa)) {
    points = addUniqueContourIntersection(points, pressureEdgeIntersection(
      vec2(0.0, 0.0),
      vec2(1.0, 0.0),
      cell.s00.pressureHpa,
      cell.s10.pressureHpa,
      contourLevelHpa
    ));
  }
  if (pressureEdgeCrossesContour(cell.s10.pressureHpa, cell.s11.pressureHpa, contourLevelHpa)) {
    points = addUniqueContourIntersection(points, pressureEdgeIntersection(
      vec2(1.0, 0.0),
      vec2(1.0, 1.0),
      cell.s10.pressureHpa,
      cell.s11.pressureHpa,
      contourLevelHpa
    ));
  }
  if (pressureEdgeCrossesContour(cell.s11.pressureHpa, cell.s01.pressureHpa, contourLevelHpa)) {
    points = addUniqueContourIntersection(points, pressureEdgeIntersection(
      vec2(1.0, 1.0),
      vec2(0.0, 1.0),
      cell.s11.pressureHpa,
      cell.s01.pressureHpa,
      contourLevelHpa
    ));
  }
  if (pressureEdgeCrossesContour(cell.s01.pressureHpa, cell.s00.pressureHpa, contourLevelHpa)) {
    points = addUniqueContourIntersection(points, pressureEdgeIntersection(
      vec2(0.0, 1.0),
      vec2(0.0, 0.0),
      cell.s01.pressureHpa,
      cell.s00.pressureHpa,
      contourLevelHpa
    ));
  }

  return points;
}

PressureContourSegments pressureContourSegmentsEmpty() {
  return PressureContourSegments(vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0), 0);
}

PressureContourSegments pressureContourSegmentsValue(
  vec2 p0,
  vec2 p1,
  vec2 p2,
  vec2 p3,
  int count
) {
  return PressureContourSegments(p0, p1, p2, p3, count);
}

float pressureCellCenterHpa(PressureFieldCell cell) {
  return (cell.s00.pressureHpa + cell.s10.pressureHpa + cell.s01.pressureHpa + cell.s11.pressureHpa) * 0.25;
}

bool pressureSaddleUsesBottomRightPairing(
  PressureFieldCell cell,
  float contourLevelHpa
) {
  bool s00High = pressureContourSide(cell.s00.pressureHpa, contourLevelHpa) > 0.0;
  bool centerHigh = pressureContourSide(pressureCellCenterHpa(cell), contourLevelHpa) > 0.0;
  return centerHigh == s00High;
}

PressureContourSegments pressureMarchingSquareSegments(
  PressureFieldCell cell,
  float contourLevelHpa
) {
  PressureContourPoints points = pressureMarchingSquareIntersections(cell, contourLevelHpa);
  if (points.count == 2) {
    return pressureContourSegmentsValue(points.p0, points.p1, vec2(0.0), vec2(0.0), 1);
  }
  if (points.count == 4) {
    if (pressureSaddleUsesBottomRightPairing(cell, contourLevelHpa)) {
      return pressureContourSegmentsValue(points.p0, points.p1, points.p2, points.p3, 2);
    }
    return pressureContourSegmentsValue(points.p0, points.p3, points.p1, points.p2, 2);
  }

  return pressureContourSegmentsEmpty();
}
