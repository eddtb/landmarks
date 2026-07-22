/* global http, METRO_URL */ // Maestro's GraalJS runtime provides both
// Flip the deliberate /api/history outage ON (see /api/e2e-outage —
// fixtures-only, inert in every other topology). METRO_URL is the
// URL-encoded origin every invocation passes with -e for the
// dev-client link (see boot.yaml); decode it rather than carrying
// the origin in a second variable.
const origin = decodeURIComponent(METRO_URL);
const response = http.get(origin + '/api/e2e-outage?on=1');
if (!response.ok) {
  throw new Error('Outage toggle refused: HTTP ' + response.status);
}
