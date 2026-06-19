import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  DocumentTitle,
  ListPageHeader,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import { Alert, Bullseye, Content, PageSection, Spinner } from '@patternfly/react-core';
import {
  CC_INIT_DATA_ANNOTATION,
  InfrastructureGVK,
  KBS_SERVICE_NAME,
  NodeGVK,
  PodGVK,
} from '../k8s/resources';
import type { InfrastructureKind, NodeKind, PodKind } from '../k8s/types';
import {
  buildTopoCluster,
  classifyKbsUrl,
  decodeInitdataKbsUrl,
  isConfidentialRuntimeName,
  layoutTopology,
  teeLong,
  teeShort,
  truncate,
  type AttestInfo,
  type LaidNode,
  type LaidWorkload,
  type WlStatus,
} from '../utils/topology';
import './coco.css';

const PREFIX = 'coco-openshift-console-plugin';

const dotClass = (s: WlStatus): string => `${PREFIX}__topo-dot--${s}`;

const LegendDot: FC<{ variant: string; label: string }> = ({ variant, label }) => (
  <span className={`${PREFIX}__legend-item`}>
    <span className={`${PREFIX}__legend-dot ${PREFIX}__legend-dot--${variant}`} />
    {label}
  </span>
);

const AttestationTopology: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const navigate = useNavigate();

  const [pods, podsLoaded] = useK8sWatchResource<PodKind[]>({
    groupVersionKind: PodGVK,
    isList: true,
  });
  const [nodes, nodesLoaded] = useK8sWatchResource<NodeKind[]>({
    groupVersionKind: NodeGVK,
    isList: true,
  });
  const [infra] = useK8sWatchResource<InfrastructureKind[]>({
    groupVersionKind: InfrastructureGVK,
    isList: true,
  });

  // Decode each confidential pod's initdata KBS URL so the topology shows which
  // Trustee each workload ACTUALLY attests to (an in-cluster one vs a remote hub)
  // — not merely where it runs. CoCo has no local TrusteeConfig to read, so the
  // attestation authority is reconstructed entirely from the workloads' initdata.
  const [attestByUid, setAttestByUid] = useState<Map<string, AttestInfo>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = new Map<string, AttestInfo>();
      for (const p of pods ?? []) {
        if (!isConfidentialRuntimeName(p.spec?.runtimeClassName)) continue;
        const ann = p.metadata?.annotations?.[CC_INIT_DATA_ANNOTATION];
        if (!ann) continue;
        const uid = p.metadata?.uid ?? `${p.metadata?.namespace ?? ''}/${p.metadata?.name ?? ''}`;
        const url = await decodeInitdataKbsUrl(ann);
        if (url) next.set(uid, classifyKbsUrl(url, KBS_SERVICE_NAME));
      }
      if (!cancelled) setAttestByUid(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pods]);

  // The Trustee hub is derived from the distinct KBS endpoints the workloads
  // attest to (decoded from their initdata) — CoCo never deploys Trustee itself.
  const endpoints = useMemo(() => {
    const m = new Map<string, 'local' | 'remote'>();
    attestByUid.forEach((info) => m.set(info.host, info.target));
    return [...m.entries()].map(([host, target]) => ({ host, target }));
  }, [attestByUid]);
  const anyLocal = endpoints.some((e) => e.target === 'local');
  const anyRemote = endpoints.some((e) => e.target === 'remote');
  const hubScopeText =
    endpoints.length === 0
      ? t('endpoint from workload initdata')
      : anyLocal && anyRemote
        ? t('in-cluster + remote')
        : anyLocal
          ? t('in-cluster Trustee')
          : t('remote · hub-and-spoke');
  const hubEndpointText =
    endpoints.length === 0
      ? t('no initdata decoded yet')
      : endpoints.length === 1
        ? endpoints[0].host
        : t('{{count}} KBS endpoints', { count: endpoints.length });
  const hubTitle =
    endpoints.length === 0
      ? t('The Trustee endpoint is read from each workload’s initdata.')
      : endpoints.map((e) => `${e.host} (${e.target})`).join('\n');

  const layout = useMemo(
    () => layoutTopology(buildTopoCluster(pods ?? [], nodes ?? [], infra ?? [], attestByUid)),
    [pods, nodes, infra, attestByUid],
  );

  const loading = !podsLoaded || !nodesLoaded;

  const renderNode = (ln: LaidNode) => {
    const { node } = ln;
    const tee = teeShort(node.tee);
    const clickable = node.known && node.name !== '';
    const openNode = () => void navigate(`/k8s/cluster/nodes/${node.name}`);
    return (
      <g
        key={`node-${node.name || 'unscheduled'}`}
        className={clickable ? `${PREFIX}__topo-clickable` : undefined}
        onClick={clickable ? openNode : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (e.key === ' ') e.preventDefault();
                  openNode();
                }
              }
            : undefined
        }
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-label={clickable ? t('Open node {{name}}', { name: node.name }) : undefined}
      >
        <rect
          x={ln.x}
          y={ln.y}
          width={ln.w}
          height={ln.h}
          rx={8}
          className={`${PREFIX}__topo-node`}
        />
        {node.name ? (
          <>
            <circle
              cx={ln.x + 14}
              cy={ln.y + 16}
              r={4}
              className={node.ready ? dotClass('healthy') : dotClass('error')}
            />
            <text x={ln.x + 26} y={ln.y + 20} className={`${PREFIX}__topo-text`}>
              {truncate(node.name, 30)}
            </text>
            {tee && (
              <text
                x={ln.x + ln.w - 10}
                y={ln.y + 20}
                textAnchor="end"
                className={`${PREFIX}__topo-subtle`}
              >
                {tee}
              </text>
            )}
            <title>{`${node.name} — ${teeLong(node.tee)} — ${node.ready ? 'Ready' : 'Not ready'}`}</title>
          </>
        ) : (
          <text x={ln.x + 14} y={ln.y + 20} className={`${PREFIX}__topo-subtle`}>
            {t('Unscheduled — awaiting placement')}
          </text>
        )}
      </g>
    );
  };

  const renderWorkload = (lw: LaidWorkload) => {
    const { wl } = lw;
    // Does this workload attest to an in-cluster Trustee, a remote one, or not at
    // all? Decoded from its initdata KBS URL.
    const elsewhere = wl.attest === 'remote' || wl.attest === 'none';
    const attestText =
      wl.attest === 'local'
        ? t('↳ attests in-cluster')
        : wl.attest === 'remote'
          ? `↗ ${truncate(wl.attestHost ?? t('remote Trustee'), 19)}`
          : wl.attest === 'none'
            ? t('no initdata')
            : t('↳ checking…');
    const attestCls =
      wl.attest === 'local'
        ? `${PREFIX}__topo-attest--local`
        : wl.attest === 'remote'
          ? `${PREFIX}__topo-attest--remote`
          : `${PREFIX}__topo-attest--none`;
    const attestTitle =
      wl.attest === 'local'
        ? t('attests to an in-cluster Trustee')
        : wl.attest === 'remote'
          ? t('attests to a remote Trustee at {{host}}', { host: wl.attestHost ?? '?' })
          : wl.attest === 'none'
            ? t('no initdata — does not attest')
            : t('decoding initdata…');
    const openWorkload = () => void navigate(`/k8s/ns/${wl.namespace}/pods/${wl.name}`);
    return (
      <g
        key={wl.uid}
        className={`${PREFIX}__topo-clickable`}
        onClick={openWorkload}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.key === ' ') e.preventDefault();
            openWorkload();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={t('Open workload {{namespace}}/{{name}}', {
          namespace: wl.namespace,
          name: wl.name,
        })}
      >
        <rect
          x={lw.x}
          y={lw.y}
          width={lw.w}
          height={lw.h}
          rx={6}
          className={`${PREFIX}__topo-wl`}
          strokeDasharray={elsewhere ? '4 3' : undefined}
        />
        <circle cx={lw.x + 14} cy={lw.y + 16} r={4} className={dotClass(wl.status)} />
        <text x={lw.x + 26} y={lw.y + 19} className={`${PREFIX}__topo-text`}>
          {truncate(wl.name, 17)}
        </text>
        {wl.gpu && (
          <text
            x={lw.x + lw.w - 8}
            y={lw.y + 19}
            textAnchor="end"
            className={`${PREFIX}__topo-subtle`}
          >
            {t('GPU')}
          </text>
        )}
        <text x={lw.x + 26} y={lw.y + 34} className={`${PREFIX}__topo-subtle`}>
          {truncate(wl.namespace, 20)}
        </text>
        <text x={lw.x + 26} y={lw.y + 50} className={attestCls}>
          {attestText}
        </text>
        <title>{`${wl.namespace}/${wl.name} · ${wl.runtime} · ${wl.status} · ${attestTitle}`}</title>
      </g>
    );
  };

  const cluster = layout.cluster;
  const { hub, edge } = layout;

  return (
    <>
      <DocumentTitle>{t('Attestation topology')}</DocumentTitle>
      <ListPageHeader title={t('Attestation topology')} />
      <PageSection>
        {loading ? (
          <Bullseye>
            <Spinner aria-label={t('Loading')} />
          </Bullseye>
        ) : (
          <>
            <Alert
              variant="info"
              isInline
              isExpandable
              title={t('How these workloads are attested')}
              className={`${PREFIX}__mb`}
            >
              <Content component="p">
                {t(
                  'A confidential workload proves its hardware identity to a Trustee Key Broker Service (KBS) at boot; only after the KBS verifies that evidence does it release the workload’s secrets and keys. Each workload runs inside a node’s Trusted Execution Environment, in a cluster — shown here nested as workload → node → cluster.',
                )}
              </Content>
              <Content component="p">
                {t(
                  'Confidential Containers does not deploy Trustee — the attestation authority usually runs in a separate, trusted cluster (hub-and-spoke). This view shows the workloads in the current cluster and which Trustee each one actually attests to, read from its initdata: a solid box marked “↳ attests in-cluster” targets a co-located Trustee; a dashed box marked “↗ …” attests to a remote Trustee; “no initdata” means it does not attest at all. The Trustee on the left is reconstructed from those endpoints.',
                )}
              </Content>
            </Alert>

            <div className={`${PREFIX}__legend ${PREFIX}__mb`}>
              <LegendDot variant="healthy" label={t('Running')} />
              <LegendDot variant="pending" label={t('Pending')} />
              <LegendDot variant="error" label={t('Failed')} />
              <span className={`${PREFIX}__muted`}>
                {t('Select a node or a workload to open it.')}
              </span>
            </div>

            <div className={`${PREFIX}__topo`}>
              <svg
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={t('Attestation topology diagram')}
              >
                <defs>
                  <marker
                    id="coco-topo-arrow"
                    markerWidth={9}
                    markerHeight={9}
                    refX={7}
                    refY={4.5}
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0,0 L9,4.5 L0,9 z" className={`${PREFIX}__topo-arrowhead`} />
                  </marker>
                </defs>

                {/* the Trustee attests this cluster's workloads */}
                <path
                  d={`M ${edge.x1} ${edge.y1} C ${edge.x1 + 40} ${edge.y1}, ${edge.x2 - 40} ${edge.y2}, ${edge.x2} ${edge.y2}`}
                  className={`${PREFIX}__topo-edge`}
                  markerEnd="url(#coco-topo-arrow)"
                />
                <text
                  x={(edge.x1 + edge.x2) / 2}
                  y={(edge.y1 + edge.y2) / 2 - 6}
                  textAnchor="middle"
                  className={`${PREFIX}__topo-subtle`}
                >
                  {t('attests')}
                </text>

                {/* Trustee hub (derived from workload initdata) */}
                <g>
                  <rect
                    x={hub.x}
                    y={hub.y}
                    width={hub.w}
                    height={hub.h}
                    rx={10}
                    className={`${PREFIX}__topo-hub`}
                  />
                  <text x={hub.x + 16} y={hub.y + 30} className={`${PREFIX}__topo-title`}>
                    {t('Trustee')}
                  </text>
                  <text x={hub.x + 16} y={hub.y + 50} className={`${PREFIX}__topo-subtle`}>
                    {t('Attestation authority · KBS')}
                  </text>
                  <text x={hub.x + 16} y={hub.y + 74} className={`${PREFIX}__topo-subtle`}>
                    {truncate(hubScopeText, 28)}
                  </text>
                  <text x={hub.x + 16} y={hub.y + 98} className={`${PREFIX}__topo-mono`}>
                    {truncate(hubEndpointText, 26)}
                  </text>
                  <title>{hubTitle}</title>
                </g>

                {/* this cluster */}
                <rect
                  x={cluster.x}
                  y={cluster.y}
                  width={cluster.w}
                  height={cluster.h}
                  rx={12}
                  className={`${PREFIX}__topo-cluster`}
                />
                <text x={cluster.x + 14} y={cluster.y + 26} className={`${PREFIX}__topo-title`}>
                  {truncate(cluster.name, 40)}
                </text>
                <text x={cluster.x + 14} y={cluster.y + 42} className={`${PREFIX}__topo-subtle`}>
                  {t('{{count}} confidential workloads', { count: cluster.workloadCount })}
                  {` · ${t('{{count}} nodes', { count: cluster.nodes.length })}`}
                </text>
                <circle
                  cx={cluster.x + cluster.w - 54}
                  cy={cluster.y + 22}
                  r={4}
                  className={dotClass('healthy')}
                />
                <text
                  x={cluster.x + cluster.w - 46}
                  y={cluster.y + 26}
                  className={`${PREFIX}__topo-subtle`}
                >
                  {t('live')}
                </text>

                {cluster.empty && (
                  <text
                    x={cluster.x + cluster.w / 2}
                    y={cluster.y + cluster.headerH + 34}
                    textAnchor="middle"
                    className={`${PREFIX}__topo-subtle`}
                  >
                    {t('No confidential workloads found in this cluster yet.')}
                  </text>
                )}

                {cluster.nodes.map((ln) => (
                  <g key={`group-${ln.node.name || 'unscheduled'}`}>
                    {renderNode(ln)}
                    {ln.workloads.map(renderWorkload)}
                  </g>
                ))}
              </svg>
            </div>
          </>
        )}
      </PageSection>
    </>
  );
};

export default AttestationTopology;
