import { DocumentTitle, ListPageHeader, ResourceLink } from '@openshift-console/dynamic-plugin-sdk';
import { EmptyState, EmptyStateBody, PageSection } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { FC } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useConfidentialWorkloads, useRuntimeClasses } from '../k8s/hooks';
import { RuntimeClassGVK } from '../k8s/resources';
import {
  ccClassDescription,
  classForRuntimeClass,
  isConfidentialRuntimeClass,
} from '../utils/runtime';
import { CcClassLabel } from './CcClassLabel';
import './coco.css';

const RuntimeClassesList: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const [runtimeClasses, loaded] = useRuntimeClasses();
  const { workloads } = useConfidentialWorkloads();

  const confidentialRCs = useMemo(
    () => runtimeClasses.filter(isConfidentialRuntimeClass),
    [runtimeClasses],
  );

  const usage = useMemo(() => {
    const counts: Record<string, number> = {};
    workloads.forEach((w) => {
      counts[w.runtimeClass] = (counts[w.runtimeClass] ?? 0) + 1;
    });
    return counts;
  }, [workloads]);

  return (
    <>
      <DocumentTitle>{t('Confidential runtime classes')}</DocumentTitle>
      <ListPageHeader title={t('Confidential runtime classes')} />
      <PageSection>
        {loaded && confidentialRCs.length === 0 ? (
          <EmptyState headingLevel="h4" titleText={t('No confidential runtime classes')}>
            <EmptyStateBody>
              {t(
                'The kata-cc runtime class is created when confidential containers are enabled and a KataConfig is installed on TEE-capable nodes.',
              )}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label={t('Confidential runtime classes')} variant="compact">
            <Thead>
              <Tr>
                <Th>{t('Name')}</Th>
                <Th>{t('Handler')}</Th>
                <Th>{t('Confidentiality')}</Th>
                <Th>{t('Pod overhead')}</Th>
                <Th>{t('Active workloads')}</Th>
                <Th>{t('Description')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {confidentialRCs.map((rc) => {
                const name = rc.metadata?.name ?? '';
                const cc = classForRuntimeClass(rc);
                const overhead = rc.overhead?.podFixed;
                const count = usage[name] ?? 0;
                return (
                  <Tr key={name}>
                    <Td dataLabel={t('Name')}>
                      <ResourceLink groupVersionKind={RuntimeClassGVK} name={name} />
                    </Td>
                    <Td dataLabel={t('Handler')} className="coco-openshift-console-plugin__mono">
                      {rc.handler}
                    </Td>
                    <Td dataLabel={t('Confidentiality')}>
                      <CcClassLabel ccClass={cc} isCompact />
                    </Td>
                    <Td dataLabel={t('Pod overhead')}>
                      {overhead ? (
                        <span className="coco-openshift-console-plugin__mono">
                          {Object.entries(overhead)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                        </span>
                      ) : (
                        <span className="coco-openshift-console-plugin__muted">—</span>
                      )}
                    </Td>
                    <Td dataLabel={t('Active workloads')}>
                      {count > 0 ? (
                        <Link
                          to={`/confidential-containers/workloads?rc=${encodeURIComponent(name)}`}
                        >
                          {count}
                        </Link>
                      ) : (
                        <span className="coco-openshift-console-plugin__muted">0</span>
                      )}
                    </Td>
                    <Td dataLabel={t('Description')}>{ccClassDescription(cc)}</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
};

export default RuntimeClassesList;
