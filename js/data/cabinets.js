// Mock epinephrine cabinet data.
//
// No real registered-cabinet network exists yet, so cabinets are generated
// relative to the user's live location at runtime — never hardcoded absolute
// coordinates. Given the user's real lat/lng, we offset by small random deltas
// (~0.001–0.003 deg, roughly 100–300 m) so markers render near the user on the
// map. The nearest is always labelled "Main St. Pharmacy lobby" to match the
// existing copy in the spec.

// Deterministic-ish small offsets so the layout looks intentional rather than
// random on every reload. Values are in degrees; ~0.001 deg ≈ 111 m of latitude.
const CABINET_TEMPLATES = [
  { label: 'Main St. Pharmacy lobby', dLat: 0.00095, dLng: -0.0011 }, // nearest
  { label: 'Community Center',        dLat: -0.0021, dLng: 0.0017 },
  { label: 'Transit Station',         dLat: 0.0026,  dLng: 0.0024 },
];

// Haversine distance in meters between two lat/lng points.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function metersToFeet(m) {
  return m * 3.28084;
}

// ~4.5 km/h casual walking pace → minutes, rounded up, min 1.
export function walkMinutes(meters) {
  return Math.max(1, Math.round(meters / 75));
}

export function generateMockCabinets(userLat, userLng) {
  const cabinets = CABINET_TEMPLATES.map((t, i) => {
    const lat = userLat + t.dLat;
    const lng = userLng + t.dLng;
    const meters = haversineMeters(userLat, userLng, lat, lng);
    return {
      id: `cab-${i}`,
      label: t.label,
      lat,
      lng,
      meters,
      feet: Math.round(metersToFeet(meters)),
      walkMin: walkMinutes(meters),
    };
  });
  // Nearest first.
  cabinets.sort((a, b) => a.meters - b.meters);
  return cabinets;
}
