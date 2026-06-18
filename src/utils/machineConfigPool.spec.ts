import type { MachineConfigPoolKind } from '../k8s/types';
import { findPoolForRole, MCP_ROLE_LABEL, mcpRolloutState } from './machineConfigPool';

const pool = (name: string, extra: Partial<MachineConfigPoolKind> = {}): MachineConfigPoolKind => ({
  metadata: { name },
  ...extra,
});

describe('findPoolForRole', () => {
  const worker = pool('worker');
  const master = pool('master');
  const kataLabelled = pool('kata-oc', {
    metadata: { name: 'kata-oc', labels: { [MCP_ROLE_LABEL]: 'kata' } },
  });
  const kataSelector = pool('custom', {
    spec: {
      machineConfigSelector: {
        matchExpressions: [
          { key: MCP_ROLE_LABEL, operator: 'In', values: ['worker', 'infra-tee'] },
        ],
      },
    },
  });

  it('matches a pool by name (the common case)', () => {
    expect(findPoolForRole([worker, master], 'worker')).toBe(worker);
  });

  it('matches a custom pool by its role label', () => {
    expect(findPoolForRole([worker, kataLabelled], 'kata')).toBe(kataLabelled);
  });

  it('matches a pool whose selector includes the role value', () => {
    expect(findPoolForRole([kataSelector], 'infra-tee')).toBe(kataSelector);
  });

  it('returns undefined when no pool matches', () => {
    expect(findPoolForRole([worker, master], 'nope')).toBeUndefined();
  });

  it('returns undefined for an empty role', () => {
    expect(findPoolForRole([worker], '  ')).toBeUndefined();
  });
});

describe('mcpRolloutState', () => {
  it('reports unknown when the pool is missing', () => {
    expect(mcpRolloutState(undefined)).toEqual({
      phase: 'unknown',
      total: 0,
      updated: 0,
      degraded: 0,
    });
  });

  it('reports updating while the Updating condition is True', () => {
    const p = pool('worker', {
      status: {
        machineCount: 3,
        updatedMachineCount: 1,
        conditions: [{ type: 'Updating', status: 'True' }],
      },
    });
    expect(mcpRolloutState(p)).toMatchObject({ phase: 'updating', total: 3, updated: 1 });
  });

  it('reports updated when the Updated condition is True', () => {
    const p = pool('worker', {
      status: {
        machineCount: 3,
        updatedMachineCount: 3,
        conditions: [{ type: 'Updated', status: 'True' }],
      },
    });
    expect(mcpRolloutState(p).phase).toBe('updated');
  });

  it('prioritises Degraded over other conditions', () => {
    const p = pool('worker', {
      status: {
        machineCount: 3,
        updatedMachineCount: 1,
        degradedMachineCount: 1,
        conditions: [
          { type: 'Updating', status: 'True' },
          { type: 'Degraded', status: 'True' },
        ],
      },
    });
    expect(mcpRolloutState(p)).toMatchObject({ phase: 'degraded', degraded: 1 });
  });

  it('falls back to counts when no condition is set (all updated → updated)', () => {
    const p = pool('worker', { status: { machineCount: 2, updatedMachineCount: 2 } });
    expect(mcpRolloutState(p).phase).toBe('updated');
  });

  it('falls back to counts when no condition is set (partial → updating)', () => {
    const p = pool('worker', { status: { machineCount: 2, updatedMachineCount: 1 } });
    expect(mcpRolloutState(p).phase).toBe('updating');
  });
});
