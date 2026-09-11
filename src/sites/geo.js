export const EARTH_RADIUS_KM = 6371;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const KM_PER_DEGREE_LAT = 111.32;
const MIN_COS = 0.01; // guard against division by zero near the poles

const toRadians = (degrees) => degrees / DEGREES_PER_RADIAN;

/** Great-circle distance in kilometres between two WGS84 points. */
export function haversineKm(fromLat, fromLng, toLat, toLng) {
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Index-friendly bounding box around a point. Used to pre-filter rows in SQL
 * before the exact haversine check runs, so the lat/lng index does the work.
 */
export function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const cos = Math.max(MIN_COS, Math.cos(toRadians(lat)));
  const lngDelta = radiusKm / (KM_PER_DEGREE_LAT * cos);
  // A circle that reaches a pole covers every meridian, and one wider than half
  // the globe wraps the antimeridian. Neither can be expressed as a single
  // longitude range, so widen to all longitudes and let the exact distance
  // check do the filtering.
  const touchesPole = maxLat >= 90 || minLat <= -90;
  return {
    minLat: Math.max(-90, minLat),
    maxLat: Math.min(90, maxLat),
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
    spansAllLongitudes: touchesPole || lngDelta >= 180,
  };
}
