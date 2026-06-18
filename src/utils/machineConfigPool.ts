// ---------------------------------------------------------------------------
// MachineConfigPool rollout tracking for the TDX-host MachineConfig.
//
// Applying the TDX-host MachineConfig (nohibernate + kvm_intel.tdx=1) does not take
// effect until the Machine Config Operator drains and reboots every node in the
// target pool, one at a time. The CR existing means the change is *queued*, not
// *done* — so the enablement UI watches the pool's Updating/Updated condition and
// machine counts and reports reboot progress until the pool is fully Updated.
// ---------------------------------------------------------------------------
import type { MachineConfigPoolKind } from '../k8s/types';

/** The label every MachineConfigPool carries identifying its role. */
export const MCP_ROLE_LABEL = 'machineconfiguration.openshift.io/role';

export type McpRolloutPhase = 'updating' | 'updated' | 'degraded' | 'unknown';

export interface McpRollout {
  phase: McpRolloutPhase;
  /** Total machines in the pool (status.machineCount). */
  total: number;
  /** Machines already on the latest rendered config (status.updatedMachineCount). */
  updated: number;
  /** Machines reporting degraded (status.degradedMachineCount). */
  degraded: number;
}

const conditionIsTrue = (pool: MachineConfigPoolKind, type: string): boolean =>
  (pool.status?.conditions ?? []).some((c) => c.type === type && c.status === 'True');

/**
 * Find the MachineConfigPool that owns a given role. Standard pools are named after
 * their role ("worker", "master"); custom pools may be named differently but carry
 * the role label and/or select MachineConfigs by that role. We match, in order:
 *  1. a pool whose `metadata.name` equals the role (the common case), then
 *  2. a pool carrying `machineconfiguration.openshift.io/role: <role>`, then
 *  3. a pool whose machineConfigSelector matchExpression includes the role value.
 * Returns undefined when no pool matches (e.g. a typo'd custom role).
 */
export const findPoolForRole = (
  pools: MachineConfigPoolKind[],
  role: string,
): MachineConfigPoolKind | undefined => {
  const r = role.trim();
  if (r === '') return undefined;
  return (
    pools.find((p) => p.metadata?.name === r) ??
    pools.find((p) => p.metadata?.labels?.[MCP_ROLE_LABEL] === r) ??
    pools.find((p) =>
      (p.spec?.machineConfigSelector?.matchExpressions ?? []).some((e) =>
        (e.values ?? []).includes(r),
      ),
    )
  );
};

/** Derive the rollout phase + machine counts for a pool. */
export const mcpRolloutState = (pool?: MachineConfigPoolKind): McpRollout => {
  if (!pool) return { phase: 'unknown', total: 0, updated: 0, degraded: 0 };
  const total = pool.status?.machineCount ?? 0;
  const updated = pool.status?.updatedMachineCount ?? 0;
  const degraded = pool.status?.degradedMachineCount ?? 0;
  let phase: McpRolloutPhase;
  if (conditionIsTrue(pool, 'Degraded')) phase = 'degraded';
  else if (conditionIsTrue(pool, 'Updating')) phase = 'updating';
  else if (conditionIsTrue(pool, 'Updated')) phase = 'updated';
  // No explicit condition yet: fall back to the counts. All machines updated (and at
  // least one machine present) reads as updated; otherwise the rollout is in flight.
  else if (total > 0 && updated >= total) phase = 'updated';
  else phase = 'updating';
  return { phase, total, updated, degraded };
};
