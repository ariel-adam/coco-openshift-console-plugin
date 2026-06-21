import type { CcClass, RuntimeClassKind } from '../k8s/types';

// Confidential runtime classes are product-defined by name; their handlers are
// TEE-specific (e.g. kata-cc -> handler "kata-tdx" on a TDX cluster, "kata-snp"
// on SEV-SNP). We classify by name first, then fall back to handler prefix.
const CONFIDENTIAL_NAMES = new Set(['kata-cc']);
const CONFIDENTIAL_GPU_NAMES = new Set(['kata-cc-nvidia-gpu']);
const CONFIDENTIAL_HANDLER_PREFIXES = ['kata-tdx', 'kata-snp', 'kata-qemu-tdx', 'kata-qemu-snp'];

const hasConfidentialHandler = (handler: string): boolean =>
  CONFIDENTIAL_HANDLER_PREFIXES.some((p) => handler.startsWith(p));

/** Classify a RuntimeClass into a confidential-computing class. */
export const classForRuntimeClass = (rc: RuntimeClassKind): CcClass => {
  const name = rc.metadata?.name ?? '';
  const handler = rc.handler ?? '';
  if (CONFIDENTIAL_GPU_NAMES.has(name) || (name.includes('gpu') && hasConfidentialHandler(handler)))
    return 'confidential-gpu';
  if (CONFIDENTIAL_NAMES.has(name) || hasConfidentialHandler(handler)) return 'confidential';
  if (handler === 'kata-remote') return 'peerpod';
  if (handler.startsWith('kata')) return 'sandbox';
  return 'unknown';
};

/** True for hardware TEE runtimes (kata-cc family). */
export const isConfidentialClass = (c: CcClass): boolean =>
  c === 'confidential' || c === 'confidential-gpu';

/**
 * True for any runtime class that delivers workload isolation beyond a plain
 * container: hardware TEEs (kata-cc) AND cloud peer-pods (kata-remote).
 * Use this when listing all "confidential containers" workloads in the plugin,
 * so that peer-pod deployments appear alongside bare-metal TEE workloads.
 */
export const isCcWorkloadClass = (c: CcClass): boolean =>
  isConfidentialClass(c) || c === 'peerpod';

/** Is this RuntimeClass one of the confidential (kata-cc) runtimes? */
export const isConfidentialRuntimeClass = (rc: RuntimeClassKind): boolean =>
  isConfidentialClass(classForRuntimeClass(rc));

/** Is this RuntimeClass any CoCo workload runtime (kata-cc OR kata-remote)? */
export const isCcWorkloadRuntimeClass = (rc: RuntimeClassKind): boolean =>
  isCcWorkloadClass(classForRuntimeClass(rc));

export const ccClassLabel = (c: CcClass): string => {
  switch (c) {
    case 'confidential':
      return 'Confidential';
    case 'confidential-gpu':
      return 'Confidential + GPU';
    case 'peerpod':
      return 'Peer pod';
    case 'sandbox':
      return 'Sandbox';
    default:
      return 'Unknown';
  }
};

export const ccClassDescription = (c: CcClass): string => {
  switch (c) {
    case 'confidential':
      return 'Runs in a hardware TEE (Intel TDX / AMD SEV-SNP) via the kata-cc runtime.';
    case 'confidential-gpu':
      return 'Confidential microVM with an attested NVIDIA GPU (kata-cc-nvidia-gpu).';
    case 'peerpod':
      return 'Runs in a dedicated cloud VM provisioned per-pod (kata-remote). Provides VM-level isolation; combine with a CVM instance type (e.g. Azure DCas_v5) for hardware memory encryption.';
    case 'sandbox':
      return 'Sandboxed microVM on the worker node, without confidential computing.';
    default:
      return 'Class could not be determined from the RuntimeClass.';
  }
};
