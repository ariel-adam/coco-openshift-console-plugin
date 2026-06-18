// ---------------------------------------------------------------------------
// Tiny synchronous checksum for verifying a pasted value landed intact.
//
// The initdata a confidential workload needs is a multi-KB gzip+base64 blob that a
// user pastes in. Showing a short, stable fingerprint next to the (truncated)
// preview lets them eyeball that the paste matches what their attestation-service
// admin gave them, without us shipping/awaiting a crypto digest. FNV-1a is not a
// cryptographic hash — it is only a copy-paste integrity hint, never a security
// control.
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a hash of a string, returned as an 8-char lowercase hex string. */
export const fnv1aHex = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619; Math.imul keeps the multiply in 32-bit space.
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 coerces to an unsigned 32-bit int before hex formatting.
  return (hash >>> 0).toString(16).padStart(8, '0');
};
