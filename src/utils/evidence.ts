// ---------------------------------------------------------------------------
// Attestation evidence published by the in-guest self-reporting sidecar.
//
// A confidential guest is sealed: `oc exec` is blocked by the kata-agent policy,
// so the plugin cannot probe it from outside. Instead the optional evidence
// sidecar (see CreateConfidentialWorkload) runs INSIDE the TEE, fetches a KBS
// resource from the Confidential Data Hub — released only after a successful
// attestation — and server-side-applies a small ConfigMap to the API. The plugin
// only READS that ConfigMap; no exec, no privileged probe.
// ---------------------------------------------------------------------------

// The evidence label is part of the cross-plugin ConfigMap contract and lives with
// the other contract constants in k8s/resources; re-export it here so existing
// readers keep importing it from utils/evidence (single source of truth).
export { EVIDENCE_LABEL, SHARED_CONFIGMAP_SCHEMA_VERSION } from '../k8s/resources';
/** Label carrying the reporting pod name. */
export const EVIDENCE_POD_LABEL = 'trustee.attestation/pod';

const sanitizeName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');

/** ConfigMap name the sidecar writes for a workload (in the workload's namespace). */
export const evidenceCmName = (name: string): string =>
  `attestation-evidence-${sanitizeName(name)}`.slice(0, 253).replace(/-+$/g, '');

/**
 * Verdict the sidecar writes. Known values: 'passed' | 'failed' | 'inconclusive';
 * any other string is tolerated and rendered as inconclusive. (The literal union
 * collapses to `string`, so this is typed as `string` to keep the linter happy.)
 */
export type EvidenceVerdict = string;

/** The trustee.attestation.evidence/v1 record the sidecar publishes. */
export interface EvidenceRecord {
  schema?: string;
  /** "sidecar" (continuous in-guest self-report). */
  source?: string;
  timestamp?: string;
  workload?: {
    namespace?: string;
    name?: string;
    uid?: string;
    node?: string;
    runtimeClassName?: string;
    hasInitData?: boolean;
  };
  trustee?: { kbsEndpoint?: string };
  probe?: {
    method?: string;
    cdhPath?: string;
    httpStatus?: string;
    execExitCode?: number;
  };
  verdict?: EvidenceVerdict;
}

export const parseEvidence = (json?: string): EvidenceRecord | undefined => {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as EvidenceRecord;
  } catch {
    return undefined;
  }
};

/** Short relative time ("3m ago") from an ISO timestamp. */
export const relativeTime = (iso?: string): string => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};
