// ---------------------------------------------------------------------------
// Validation for the evidence sidecar's CDH (Confidential Data Hub) resource path.
//
// The sidecar fetches a KBS resource through the CDH at
// `http://127.0.0.1:8006/cdh/resource/<repository>/<name>/<key>`. The path must be
// exactly three non-empty segments: a two-segment path like `default/kbsres1` is a
// *folder*, not a resource, and the CDH returns 404 — which the probe records as an
// "inconclusive" verdict with no obvious cause. Validating the shape before Create
// turns that silent runtime failure into an inline form hint.
// ---------------------------------------------------------------------------

/** The exact segment count a KBS resource path must have: <repository>/<name>/<key>. */
export const CDH_PATH_SEGMENTS = 3;

/**
 * True when `path` is a well-formed CDH resource path: exactly three slash-separated
 * non-empty segments, no leading/trailing slash. Surrounding whitespace is ignored.
 */
export const isValidCdhResourcePath = (path: string): boolean => {
  const trimmed = path.trim();
  if (trimmed === '') return false;
  // Reject leading/trailing slashes outright (they would create empty segments and
  // are a common copy-paste artifact from a full CDH URL).
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return false;
  const segments = trimmed.split('/');
  return segments.length === CDH_PATH_SEGMENTS && segments.every((s) => s.trim() !== '');
};
