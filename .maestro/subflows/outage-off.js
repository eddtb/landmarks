/* global http, METRO_URL */ // Maestro's GraalJS runtime provides both
// Flip the deliberate /api/history outage OFF. Also runs as
// offline-stale.yaml's onFlowComplete hook so a mid-flow failure can
// never leak a dead network into the flows that run after it.
const origin = decodeURIComponent(METRO_URL);
http.get(origin + '/api/e2e-outage?on=0');
