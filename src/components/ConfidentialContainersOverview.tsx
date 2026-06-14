import { DocumentTitle, ListPageHeader, ResourceLink } from '@openshift-console/dynamic-plugin-sdk';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Label,
  PageSection,
  Skeleton,
  Title,
} from '@patternfly/react-core';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  LockIcon,
} from '@patternfly/react-icons';
import type { FC } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import {
  useConfidentialEnabled,
  useConfidentialWorkloads,
  useKataConfig,
  useRuntimeClasses,
  useTeeNodes,
  useTrusteeConfigs,
} from '../k8s/hooks';
import { NodeGVK, RuntimeClassGVK } from '../k8s/resources';
import { ccClassLabel, classForRuntimeClass, isConfidentialRuntimeClass } from '../utils/runtime';
import { kataInstallSummary, statusCategory } from '../utils/status';
import { teeLabel } from '../utils/tee';
import './coco.css';

const StatTile: FC<{ value: number | string; label: string; loading?: boolean }> = ({
  value,
  label,
  loading,
}) => (
  <Card isCompact className="coco-openshift-console-plugin__stat">
    <CardBody>
      <div className="coco-openshift-console-plugin__stat-value">
        {loading ? <Skeleton width="3rem" height="1.5rem" /> : value}
      </div>
      <div className="coco-openshift-console-plugin__stat-label">{label}</div>
    </CardBody>
  </Card>
);

const HealthBar: FC<{ healthy: number; warning: number; error: number }> = ({
  healthy,
  warning,
  error,
}) => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const total = healthy + warning + error;
  if (total === 0) return null;
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  return (
    <>
      <div className="coco-openshift-console-plugin__health-bar">
        {healthy > 0 && (
          <div
            className="coco-openshift-console-plugin__health-segment--healthy"
            style={{ width: pct(healthy) }}
          />
        )}
        {warning > 0 && (
          <div
            className="coco-openshift-console-plugin__health-segment--warning"
            style={{ width: pct(warning) }}
          />
        )}
        {error > 0 && (
          <div
            className="coco-openshift-console-plugin__health-segment--error"
            style={{ width: pct(error) }}
          />
        )}
      </div>
      <Flex gap={{ default: 'gapMd' }} className="coco-openshift-console-plugin__mt">
        <Label color="green" icon={<CheckCircleIcon />} isCompact>
          {t('Healthy')}: {healthy}
        </Label>
        <Label color="orange" icon={<ExclamationTriangleIcon />} isCompact>
          {t('Pending')}: {warning}
        </Label>
        <Label color="red" icon={<ExclamationCircleIcon />} isCompact>
          {t('Error')}: {error}
        </Label>
      </Flex>
    </>
  );
};

const GettingStarted: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  return (
    <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
      <FlexItem>
        {t(
          'Confidential containers run your workload inside a hardware Trusted Execution Environment (Intel TDX or AMD SEV-SNP), so data stays encrypted in use — even from the host. To get started:',
        )}
      </FlexItem>
      <FlexItem className="coco-openshift-console-plugin__muted">
        {t('1. Label TEE-capable nodes with the Node Feature Discovery operator.')}
      </FlexItem>
      <FlexItem className="coco-openshift-console-plugin__muted">
        {t(
          '2. Enable confidential containers and create a KataConfig to install the kata-cc runtime.',
        )}
      </FlexItem>
      <FlexItem className="coco-openshift-console-plugin__muted">
        {t(
          '3. Build initdata and deploy a pod with runtimeClassName: kata-cc, then verify attestation.',
        )}
      </FlexItem>
      <FlexItem className="coco-openshift-console-plugin__mt">
        <Link to="/confidential-containers/setup">
          <Button variant="primary" icon={<ArrowRightIcon />} iconPosition="end">
            {t('Open the setup checklist')}
          </Button>
        </Link>
      </FlexItem>
    </Flex>
  );
};

const ConfidentialContainersOverview: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const [kataConfig, kcLoaded] = useKataConfig();
  const [runtimeClasses] = useRuntimeClasses();
  const { workloads, loaded } = useConfidentialWorkloads();
  const [ccEnabled, ccEnabledLoaded] = useConfidentialEnabled();
  const { teeNodes } = useTeeNodes();
  const [trusteeConfigs] = useTrusteeConfigs();

  const kata = kataInstallSummary(kataConfig);
  const confidentialRCs = useMemo(
    () => runtimeClasses.filter(isConfidentialRuntimeClass),
    [runtimeClasses],
  );

  const healthCounts = useMemo(() => {
    let healthy = 0,
      warning = 0,
      error = 0;
    workloads.forEach((w) => {
      const cat = statusCategory(w.status);
      if (cat === 'Healthy') healthy++;
      else if (cat === 'Pending') warning++;
      else error++;
    });
    return { healthy, warning, error };
  }, [workloads]);

  const wlLoading = !loaded;

  return (
    <>
      <DocumentTitle>{t('Confidential Containers')}</DocumentTitle>
      <ListPageHeader title={t('Confidential containers overview')} />

      <PageSection>
        <Grid hasGutter>
          <GridItem span={3}>
            <StatTile
              value={workloads.length}
              label={t('Confidential workloads')}
              loading={wlLoading}
            />
          </GridItem>
          <GridItem span={2}>
            <StatTile value={teeNodes.length} label={t('TEE-capable nodes')} loading={!kcLoaded} />
          </GridItem>
          <GridItem span={3}>
            <StatTile value={confidentialRCs.length} label={t('Confidential runtime classes')} />
          </GridItem>
          <GridItem span={2}>
            <StatTile value={kata.ready} label={t('Kata nodes ready')} loading={!kcLoaded} />
          </GridItem>
          <GridItem span={2}>
            <StatTile
              value={trusteeConfigs.length > 0 ? trusteeConfigs.length : t('External')}
              label={t('Attestation (Trustee)')}
            />
          </GridItem>

          <GridItem span={6}>
            <Card>
              <CardTitle>{t('Confidential computing status')}</CardTitle>
              <CardBody>
                {!kcLoaded || !ccEnabledLoaded ? (
                  <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
                    <Skeleton width="60%" />
                    <Skeleton width="80%" />
                    <Skeleton width="50%" />
                  </Flex>
                ) : (
                  <DescriptionList isHorizontal>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Confidential containers')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {ccEnabled ? (
                          <Label color="green" icon={<CheckCircleIcon />}>
                            {t('Enabled')}
                          </Label>
                        ) : (
                          <Label color="orange" icon={<ExclamationTriangleIcon />}>
                            {t('Not enabled')}
                          </Label>
                        )}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('KataConfig')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {kata.state === 'installed' ? (
                          <Label color="green" icon={<CheckCircleIcon />}>
                            {t('Installed')}
                          </Label>
                        ) : kata.state === 'inProgress' ? (
                          <Label color="orange">
                            {t('In progress')}
                            {kata.reason ? ` (${kata.reason})` : ''}
                          </Label>
                        ) : kata.state === 'failed' ? (
                          <Label color="red" icon={<ExclamationCircleIcon />}>
                            {t('Failed')}: {kata.failed.join(', ')}
                          </Label>
                        ) : (
                          <Label color="red" icon={<ExclamationTriangleIcon />}>
                            {t('Not installed')}
                          </Label>
                        )}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Kata nodes ready')}</DescriptionListTerm>
                      <DescriptionListDescription>{kata.ready}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('kata-cc runtime')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {confidentialRCs.length > 0
                          ? confidentialRCs.map((rc) => rc.metadata?.name).join(', ')
                          : t('Not present')}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  </DescriptionList>
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem span={6}>
            <Card>
              <CardTitle>{t('TEE-capable nodes')}</CardTitle>
              <CardBody>
                {teeNodes.length === 0 ? (
                  <span className="coco-openshift-console-plugin__muted">
                    {t(
                      'No TEE-capable nodes detected. Install the Node Feature Discovery operator and a NodeFeatureRule to label TDX / SEV-SNP nodes.',
                    )}
                  </span>
                ) : (
                  <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
                    {teeNodes.map((n) => (
                      <FlexItem key={n.name}>
                        <Flex
                          justifyContent={{ default: 'justifyContentSpaceBetween' }}
                          alignItems={{ default: 'alignItemsCenter' }}
                        >
                          <FlexItem>
                            <ResourceLink groupVersionKind={NodeGVK} name={n.name} />
                          </FlexItem>
                          <FlexItem>
                            {n.tee !== 'none' && (
                              <Label color="blue" isCompact>
                                {teeLabel(n.tee)}
                              </Label>
                            )}{' '}
                            {n.gpuCcReady && (
                              <Label color="purple" isCompact>
                                {t('GPU CC')}
                              </Label>
                            )}
                          </FlexItem>
                        </Flex>
                      </FlexItem>
                    ))}
                  </Flex>
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem span={12}>
            <Card>
              <CardTitle>
                {!wlLoading && workloads.length === 0
                  ? t('Get started with confidential containers')
                  : t('Workload health')}
              </CardTitle>
              <CardBody>
                {wlLoading ? (
                  <Skeleton width="100%" height="0.5rem" />
                ) : workloads.length === 0 ? (
                  <GettingStarted />
                ) : (
                  <HealthBar {...healthCounts} />
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem span={6}>
            <Card>
              <CardTitle>{t('Confidential runtime classes')}</CardTitle>
              <CardBody>
                {confidentialRCs.length === 0 ? (
                  <span className="coco-openshift-console-plugin__muted">
                    {t('No confidential (kata-cc) runtime classes found.')}
                  </span>
                ) : (
                  <Flex direction={{ default: 'column' }}>
                    {confidentialRCs.map((rc) => (
                      <FlexItem key={rc.metadata?.name}>
                        <Flex
                          justifyContent={{ default: 'justifyContentSpaceBetween' }}
                          alignItems={{ default: 'alignItemsCenter' }}
                        >
                          <FlexItem>
                            <ResourceLink
                              groupVersionKind={RuntimeClassGVK}
                              name={rc.metadata?.name}
                            />
                          </FlexItem>
                          <FlexItem>
                            <Label color="blue" isCompact>
                              {ccClassLabel(classForRuntimeClass(rc))}
                            </Label>
                          </FlexItem>
                        </Flex>
                      </FlexItem>
                    ))}
                  </Flex>
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem span={6}>
            <Card>
              <CardTitle>{t('Attestation')}</CardTitle>
              <CardBody>
                {trusteeConfigs.length > 0 ? (
                  <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
                    <FlexItem>
                      <Label color="green" icon={<LockIcon />}>
                        {t('Trustee detected on this cluster')}
                      </Label>
                    </FlexItem>
                    <FlexItem>
                      <Title headingLevel="h4" size="md">
                        <Link to="/trustee">{t('Go to Trustee (Attestation)')}</Link>
                      </Title>
                    </FlexItem>
                  </Flex>
                ) : (
                  <span className="coco-openshift-console-plugin__muted">
                    {t(
                      'Attestation is provided by the Red Hat build of Trustee, which verifies TEE evidence and releases sealed secrets. It commonly runs on a separate trusted cluster (hub-and-spoke), so it may not appear here.',
                    )}
                  </span>
                )}
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default ConfidentialContainersOverview;
