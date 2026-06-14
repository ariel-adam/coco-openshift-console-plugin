import {
  k8sCreate,
  k8sPatch,
  useK8sWatchResource,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  CodeBlock,
  CodeBlockCode,
  ExpandableSection,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { CheckCircleIcon } from '@patternfly/react-icons';
import type { FC } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ConfigMapGVK,
  ConfigMapModel,
  OSC_FEATURE_GATES_CM,
  OSC_NAMESPACE,
} from '../k8s/resources';
import { buildOscFeatureGatesConfigMap } from '../utils/featureGates';
import './coco.css';

type ConfigMapKind = K8sResourceCommon & { data?: Record<string, string> };

/**
 * One-click confidential-containers enablement: sets `confidential: "true"` on
 * the `osc-feature-gates` ConfigMap (creating it if absent), which makes the
 * OpenShift sandboxed containers operator install the `kata-cc` runtime. The
 * operator reconfigures and reboots the sandboxed-containers nodes.
 */
export const EnableConfidentialContainers: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');

  // Watch the ConfigMap as a LIST, not by name. useK8sWatchResource never flips
  // `loaded` to true for a single *named* resource that does not exist yet, and
  // osc-feature-gates is absent until CoCo is first enabled — which left the
  // enable button (isDisabled={!loaded}) permanently greyed out. A namespaced
  // list loads correctly (empty array when the CM is absent), the same pattern
  // EnableTdxHost uses for MachineConfigs.
  const [cms, loaded] = useK8sWatchResource<ConfigMapKind[]>({
    groupVersionKind: ConfigMapGVK,
    namespace: OSC_NAMESPACE,
    isList: true,
  });
  const cm = loaded ? cms?.find((c) => c.metadata?.name === OSC_FEATURE_GATES_CM) : undefined;
  const enabled = !!cm && cm.data?.confidential === 'true';
  const cmExists = !!cm;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const onEnable = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (cmExists) {
        await k8sPatch({
          model: ConfigMapModel,
          resource: cm as K8sResourceCommon,
          data: [
            { op: 'add', path: '/data', value: { ...(cm?.data ?? {}), confidential: 'true' } },
          ],
        });
      } else {
        await k8sCreate({ model: ConfigMapModel, data: buildOscFeatureGatesConfigMap() });
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (enabled) {
    return (
      <Label color="green" icon={<CheckCircleIcon />}>
        {t('Confidential containers enabled')}
      </Label>
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} isDisabled={!loaded}>
        {t('Enable confidential containers')}
      </Button>
      {open && (
        <Modal isOpen variant="medium" onClose={() => setOpen(false)}>
          <ModalHeader title={t('Enable confidential containers')} />
          <ModalBody>
            <p className="coco-openshift-console-plugin__mb">
              {t(
                'This enables confidential containers in the OpenShift sandboxed containers operator — a supported configuration option. The operator then installs the kata-cc runtime on your TEE nodes.',
              )}
            </p>
            <Alert
              variant="warning"
              isInline
              title={t('Nodes will reboot')}
              className="coco-openshift-console-plugin__mb"
            >
              {t(
                'Installing the kata-cc runtime reconfigures and reboots the sandboxed-containers nodes, one at a time.',
              )}
            </Alert>
            <ExpandableSection
              toggleText={t('Configuration to apply')}
              className="coco-openshift-console-plugin__mt"
            >
              <CodeBlock>
                <CodeBlockCode>
                  {JSON.stringify(buildOscFeatureGatesConfigMap(), null, 2)}
                </CodeBlockCode>
              </CodeBlock>
            </ExpandableSection>
            {error && (
              <Alert
                variant="danger"
                isInline
                title={t('Could not enable confidential containers')}
                className="coco-openshift-console-plugin__mt"
              >
                {error}
              </Alert>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="primary"
              onClick={() => void onEnable()}
              isLoading={busy}
              isDisabled={busy || !loaded}
            >
              {t('Enable and reboot')}
            </Button>
            <Button variant="link" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
};

export default EnableConfidentialContainers;
