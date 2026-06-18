import {
  k8sCreate,
  useK8sWatchResource,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  CodeBlock,
  CodeBlockCode,
  ExpandableSection,
  Form,
  FormGroup,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  TextInput,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@patternfly/react-icons';
import type { FC } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MachineConfigGVK, MachineConfigModel, MachineConfigPoolGVK } from '../k8s/resources';
import type { MachineConfigPoolKind } from '../k8s/types';
import {
  buildTdxHostMachineConfig,
  hasTdxHostArgs,
  TDX_HOST_KERNEL_ARGS,
} from '../utils/machineConfig';
import { findPoolForRole, mcpRolloutState } from '../utils/machineConfigPool';
import './coco.css';

type MachineConfigKind = K8sResourceCommon & {
  metadata?: K8sResourceCommon['metadata'] & { labels?: Record<string, string> };
  spec?: { kernelArguments?: string[] };
};

/** Role label of a MachineConfig (which pool it targets). */
const MC_ROLE_LABEL = 'machineconfiguration.openshift.io/role';

/**
 * One-click Intel TDX host activation: creates a MachineConfig that adds the
 * `nohibernate` + `kvm_intel.tdx=1` kernel arguments to a MachineConfigPool, so
 * the TDX module initializes and NFD can detect the node as TEE-capable. This is
 * the prerequisite for TEE detection when a node has TDX enabled in firmware but
 * is not yet labeled. Applying it reboots the pool's nodes.
 */
export const EnableTdxHost: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');

  const [mcs] = useK8sWatchResource<MachineConfigKind[]>({
    groupVersionKind: MachineConfigGVK,
    isList: true,
  });
  const appliedMcs = (mcs ?? []).filter((mc) => hasTdxHostArgs(mc.spec?.kernelArguments));
  const applied = appliedMcs.length > 0;
  // The role(s) the applied TDX-host MachineConfig(s) target, so we can follow the
  // matching pool's rolling reboot instead of declaring success on CR creation.
  const appliedRoles = [
    ...new Set(
      appliedMcs.map((mc) => mc.metadata?.labels?.[MC_ROLE_LABEL]).filter(Boolean) as string[],
    ),
  ];

  const [pools] = useK8sWatchResource<MachineConfigPoolKind[]>({
    groupVersionKind: MachineConfigPoolGVK,
    isList: true,
  });
  // Aggregate the rollout across every targeted pool: still "updating" until all are
  // Updated; "degraded" if any pool is degraded; "unknown" when we can't match a pool.
  const appliedPools = appliedRoles
    .map((r) => findPoolForRole(pools ?? [], r))
    .filter(Boolean) as MachineConfigPoolKind[];
  const rollouts = appliedPools.map((p) => mcpRolloutState(p));
  const rebootDegraded = rollouts.some((r) => r.phase === 'degraded');
  const rebootInProgress = rollouts.some((r) => r.phase === 'updating');
  const rebootTotal = rollouts.reduce((acc, r) => acc + r.total, 0);
  const rebootUpdated = rollouts.reduce((acc, r) => acc + r.updated, 0);

  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('worker');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const toCreate = buildTdxHostMachineConfig(role);

  const onCreate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await k8sCreate({ model: MachineConfigModel, data: buildTdxHostMachineConfig(role) });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (applied) {
    // The MachineConfig exists, but it only takes effect once the Machine Config
    // Operator has rebooted every node in the target pool. Track that rollout rather
    // than flipping straight to "enabled".
    if (rebootDegraded) {
      return (
        <Label color="red" icon={<ExclamationTriangleIcon />}>
          {t('TDX host rollout degraded — check the MachineConfigPool')}
        </Label>
      );
    }
    if (rebootInProgress) {
      return (
        <Label color="orange" icon={<Spinner size="md" />}>
          {rebootTotal > 0
            ? t('TDX host rollout: rebooting nodes ({{updated}}/{{total}})', {
                updated: rebootUpdated,
                total: rebootTotal,
              })
            : t('TDX host rollout: rebooting nodes…')}
        </Label>
      );
    }
    return (
      <Label color="green" icon={<CheckCircleIcon />}>
        {t('TDX host enabled')}
      </Label>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('Enable Intel TDX host')}
      </Button>
      {open && (
        <Modal
          isOpen
          variant="medium"
          onClose={() => {
            setOpen(false);
          }}
        >
          <ModalHeader title={t('Enable Intel TDX host')} />
          <ModalBody>
            <p className="coco-openshift-console-plugin__mb">
              {t(
                'Intel TDX must be activated in the host kernel before Node Feature Discovery can detect it. This adds the required kernel arguments to the selected MachineConfigPool. Use it when a node has TDX enabled in firmware but is not detected as TEE-capable.',
              )}
            </p>
            <Alert
              variant="warning"
              isInline
              title={t('Nodes will reboot')}
              className="coco-openshift-console-plugin__mb"
            >
              {t(
                'Applying this MachineConfig rolls out a reboot to every node in the "{{role}}" pool, one at a time.',
                { role },
              )}
            </Alert>
            <Form>
              <FormGroup label={t('MachineConfigPool role')} fieldId="tdx-role">
                <TextInput
                  id="tdx-role"
                  value={role}
                  onChange={(_e, v) => {
                    setRole(v);
                  }}
                />
                <p className="coco-openshift-console-plugin__muted coco-openshift-console-plugin__mt">
                  {t(
                    'The role label of the MachineConfigPool holding your TEE nodes — for example "worker", or a custom pool such as "kata-oc".',
                  )}
                </p>
              </FormGroup>
              <FormGroup label={t('Kernel arguments')} fieldId="tdx-args">
                <span className="coco-openshift-console-plugin__mono">
                  {TDX_HOST_KERNEL_ARGS.join('  ')}
                </span>
              </FormGroup>
            </Form>
            <ExpandableSection
              toggleText={t('Resource to create')}
              className="coco-openshift-console-plugin__mt"
            >
              <CodeBlock>
                <CodeBlockCode>{JSON.stringify(toCreate, null, 2)}</CodeBlockCode>
              </CodeBlock>
            </ExpandableSection>
            {error && (
              <Alert
                variant="danger"
                isInline
                title={t('Could not enable Intel TDX host')}
                className="coco-openshift-console-plugin__mt"
              >
                {error}
              </Alert>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="primary"
              onClick={() => void onCreate()}
              isLoading={busy}
              isDisabled={busy || !role}
            >
              {t('Enable and reboot')}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('Cancel')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
};

export default EnableTdxHost;
