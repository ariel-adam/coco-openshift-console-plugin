import { DocumentTitle, ListPageHeader, ResourceLink } from '@openshift-console/dynamic-plugin-sdk';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  Flex,
  FlexItem,
  Label,
  PageSection,
} from '@patternfly/react-core';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InfoCircleIcon,
  PlusCircleIcon,
} from '@patternfly/react-icons';
import type { FC, ReactNode } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import {
  useConfidentialEnabled,
  useKataConfig,
  useRuntimeClasses,
  useTeeNodes,
  useTrusteeConfigs,
} from '../k8s/hooks';
import { KataConfigGVK } from '../k8s/resources';
import { isConfidentialRuntimeClass } from '../utils/runtime';
import { kataInstallSummary } from '../utils/status';
import './coco.css';

type Status = 'done' | 'todo' | 'warn' | 'info';

interface Step {
  title: string;
  status: Status;
  detail: ReactNode;
  action?: { label: string; href: string };
}

const StatusIcon: FC<{ status: Status }> = ({ status }) => {
  if (status === 'done')
    return (
      <CheckCircleIcon
        className="coco-openshift-console-plugin__icon-success"
        color="var(--pf-t--global--icon--color--status--success--default)"
      />
    );
  if (status === 'warn')
    return <ExclamationTriangleIcon className="coco-openshift-console-plugin__icon-warning" />;
  if (status === 'info')
    return (
      <InfoCircleIcon
        className="coco-openshift-console-plugin__icon-info"
        color="var(--pf-t--global--icon--color--status--info--default)"
      />
    );
  return <PlusCircleIcon className="coco-openshift-console-plugin__muted" />;
};

const CocoSetup: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const [kataConfig] = useKataConfig();
  const [ccEnabled] = useConfidentialEnabled();
  const [trusteeConfigs] = useTrusteeConfigs();
  const { teeNodes } = useTeeNodes();
  const [runtimeClasses] = useRuntimeClasses();

  const kata = kataInstallSummary(kataConfig);
  const confidentialRCs = useMemo(
    () => runtimeClasses.filter(isConfidentialRuntimeClass),
    [runtimeClasses],
  );
  const ccRuntimeReady = confidentialRCs.length > 0;
  const trusteeReady = trusteeConfigs.length > 0;

  const steps: Step[] = [
    {
      title: t('TEE-capable nodes'),
      status: teeNodes.length > 0 ? 'done' : 'todo',
      detail:
        teeNodes.length > 0
          ? t('{{count}} node(s) are labeled as TEE-capable.', { count: teeNodes.length })
          : t(
              'Detect and label your Intel TDX or AMD SEV-SNP nodes with Node Feature Discovery. Confidential workloads only schedule onto these nodes.',
            ),
      action: {
        label: teeNodes.length > 0 ? t('View TEE nodes') : t('Detect TEE nodes'),
        href: '/confidential-containers/tee-nodes',
      },
    },
    {
      title: t('Confidential containers enabled'),
      status: ccEnabled ? 'done' : 'info',
      detail: ccEnabled
        ? t('The confidential feature gate is on, so the operator installs the kata-cc runtime.')
        : t(
            'Turn on the confidential feature gate in the OpenShift sandboxed containers operator. The operator then installs the kata-cc runtime when you create a KataConfig.',
          ),
    },
    {
      title: t('kata-cc runtime installed'),
      status:
        ccRuntimeReady && kata.state === 'installed'
          ? 'done'
          : kata.state === 'inProgress' || kata.state === 'failed'
            ? 'warn'
            : 'todo',
      detail: ccRuntimeReady ? (
        <span className="coco-openshift-console-plugin__mono">
          {confidentialRCs.map((rc) => rc.metadata?.name).join(', ')}
        </span>
      ) : kataConfig ? (
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          gap={{ default: 'gapSm' }}
          flexWrap={{ default: 'wrap' }}
        >
          <FlexItem>
            <ResourceLink
              groupVersionKind={KataConfigGVK}
              name={kataConfig.metadata?.name}
              inline
            />
          </FlexItem>
          <FlexItem>
            <Label
              isCompact
              color={
                kata.state === 'installed' ? 'green' : kata.state === 'failed' ? 'red' : 'orange'
              }
            >
              {t('{{state}} ({{ready}} nodes)', { state: kata.label, ready: kata.ready })}
            </Label>
          </FlexItem>
        </Flex>
      ) : (
        t(
          'Create a KataConfig with confidential containers enabled to install the kata-cc runtime on your TEE nodes. This reboots the selected nodes.',
        )
      ),
    },
    {
      title: t('Attestation (Trustee)'),
      status: trusteeReady ? 'done' : 'info',
      detail: trusteeReady
        ? t('Trustee is deployed on this cluster and ready to verify TEE evidence.')
        : t(
            'Deploy the Red Hat build of Trustee to verify TEE evidence and release sealed secrets. It can also run on a separate trusted cluster (hub-and-spoke).',
          ),
      action: {
        label: trusteeReady ? t('View Trustee') : t('Deploy Trustee'),
        href: trusteeReady ? '/trustee' : '/trustee/deploy',
      },
    },
    {
      title: t('Build initdata'),
      status: 'info',
      detail: t(
        'Pin the attestation policy and KBS endpoint into your pods with an initdata document, so the guest can attest on boot.',
      ),
      action: { label: t('Open initdata builder'), href: '/confidential-containers/initdata' },
    },
    {
      title: t('Run a confidential workload'),
      status: ccRuntimeReady ? 'info' : 'todo',
      detail: ccRuntimeReady
        ? t(
            'Deploy a workload with runtimeClassName: kata-cc, then verify its attestation from the workload page.',
          )
        : t('Available once the kata-cc runtime is installed on your TEE nodes.'),
      action: ccRuntimeReady
        ? { label: t('Create workload'), href: '/confidential-containers/workloads/new' }
        : undefined,
    },
  ];

  return (
    <>
      <DocumentTitle>{t('Confidential containers setup')}</DocumentTitle>
      <ListPageHeader title={t('Confidential containers setup')} />
      <PageSection>
        <Card className="coco-openshift-console-plugin__mb">
          <CardBody>
            <Content component="p">
              {t(
                'Confidential containers run your workload inside a hardware Trusted Execution Environment (Intel TDX or AMD SEV-SNP), so data stays encrypted in use — even from the cluster host. Work through the checklist below to go from a fresh cluster to an attested confidential workload.',
              )}
            </Content>
          </CardBody>
        </Card>

        <Card>
          <CardTitle>{t('Setup checklist')}</CardTitle>
          <CardBody>
            <Flex direction={{ default: 'column' }} gap={{ default: 'gapLg' }}>
              {steps.map((step) => (
                <FlexItem key={step.title}>
                  <Flex
                    alignItems={{ default: 'alignItemsCenter' }}
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                  >
                    <FlexItem grow={{ default: 'grow' }}>
                      <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                        <FlexItem>
                          <StatusIcon status={step.status} />
                        </FlexItem>
                        <FlexItem>
                          <strong>{step.title}</strong>
                          <div className="coco-openshift-console-plugin__muted">{step.detail}</div>
                        </FlexItem>
                      </Flex>
                    </FlexItem>
                    {step.action && (
                      <FlexItem>
                        <Link to={step.action.href}>
                          <Button
                            variant={step.status === 'done' ? 'secondary' : 'primary'}
                            icon={<ArrowRightIcon />}
                            iconPosition="end"
                          >
                            {step.action.label}
                          </Button>
                        </Link>
                      </FlexItem>
                    )}
                  </Flex>
                </FlexItem>
              ))}
            </Flex>
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
};

export default CocoSetup;
