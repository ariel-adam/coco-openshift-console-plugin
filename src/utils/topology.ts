// ---------------------------------------------------------------------------
// Topology model + layout for the confidential-workload attestation view.
//
// This is the SPOKE perspective: the confidential workloads running in THIS
// cluster, and which Trustee each one attests to — read from its initdata KBS
// URL. CoCo does not deploy Trustee; the attestation authority usually lives in
// another cluster (hub-and-spoke), so the "hub" shown here is derived from the
// workloads' own initdata endpoints, not from a local TrusteeConfig.
//
// We render the nesting workload ∈ node ∈ cluster and a single Trustee hub the
// workloads attest to. The console can only watch the cluster it runs in, so the
// live data is this cluster's confidential pods.
// ---------------------------------------------------------------------------
import { CC_INIT_DATA_ANNOTATION } from '../k8s/resources';
import type { InfrastructureKind, NodeKind, PodKind, TeeType } from '../k8s/types';
import { SNP_LABEL, TDX_LABEL } from './tee';

export type WlStatus = 'healthy' | 'pending' | 'error';

/**
 * Which Trustee a workload actually attests to, read from its initdata KBS URL:
 * - 'local'  — an in-cluster Trustee (kbs-service), i.e. Trustee is co-located
 * - 'remote' — a different Trustee (external route / hub) — hub-and-spoke
 * - 'none'   — no initdata, so it does not attest at all
 * - 'unknown'— has initdata but the URL hasn't been decoded yet
 */
export type AttestKind = 'local' | 'remote' | 'none' | 'unknown';
export interface AttestInfo {
  target: 'local' | 'remote';
  host: string;
}

export interface TopoWorkload {
  uid: string;
  name: string;
  namespace: string;
  nodeName: string; // '' when the pod is not yet scheduled to a node
  runtime: string;
  gpu: boolean;
  status: WlStatus;
  attest: AttestKind;
  attestHost?: string; // the KBS host this workload attests to (when remote)
}

export interface TopoNode {
  name: string; // '' for the synthetic "unscheduled" bucket
  tee: TeeType;
  ready: boolean;
  known: boolean; // matched a real Node object
  workloads: TopoWorkload[];
}

export interface TopoCluster {
  name: string;
  nodes: TopoNode[];
  workloadCount: number;
}

// ---- classification helpers ----

/** A confidential-containers pod runs on the kata-cc family of runtime classes. */
export const isConfidentialRuntimeName = (name?: string): boolean =>
  !!name && name.startsWith('kata-cc');

/** TEE type from NFD node labels (tolerates a missing/undecoded node). */
const teeTypeForNode = (node?: NodeKind): TeeType => {
  const labels = node?.metadata?.labels ?? {};
  if (labels[TDX_LABEL] === 'true') return 'tdx';
  if (labels[SNP_LABEL] === 'true') return 'snp';
  return 'none';
};

export const teeShort = (tee: TeeType): string =>
  tee === 'tdx' ? 'TDX' : tee === 'snp' ? 'SEV-SNP' : '';

export const teeLong = (tee: TeeType): string =>
  tee === 'tdx' ? 'Intel TDX' : tee === 'snp' ? 'AMD SEV-SNP' : 'No TEE node label';

const nodeReady = (node?: NodeKind): boolean =>
  (node?.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True');

export const podStatusCategory = (pod: PodKind): WlStatus => {
  const phase = pod.status?.phase;
  const waitingBad = (pod.status?.containerStatuses ?? []).some(
    (c) =>
      c.state?.waiting &&
      /CrashLoopBackOff|RunContainerError|CreateContainerError|ImagePullBackOff|ErrImagePull/i.test(
        c.state.waiting.reason ?? '',
      ),
  );
  if (waitingBad) return 'error';
  if (phase === 'Running' || phase === 'Succeeded') return 'healthy';
  if (phase === 'Failed' || phase === 'Unknown') return 'error';
  return 'pending';
};

export const truncate = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

// ---- attestation target (decode the pod's initdata) ----

/** What an in-browser decode of a pasted cc_init_data annotation tells us. */
export interface InitdataInspection {
  /** Decoded to something that looks like an initdata.toml (has [data] + cdh.toml). */
  ok: boolean;
  /** The first KBS `url = '...'` found (aa.toml/cdh.toml share it), or null. */
  kbsUrl: string | null;
  /** Scheme of kbsUrl. */
  scheme: 'http' | 'https' | 'other' | null;
  /** A `kbs_cert` is pinned in the initdata — required to validate an https KBS. */
  hasCert: boolean;
}

const EMPTY_INSPECTION: InitdataInspection = {
  ok: false,
  kbsUrl: null,
  scheme: null,
  hasCert: false,
};

/** Classify an already-decoded initdata.toml. Pure (no browser APIs) so it is unit-testable. */
export const classifyInitdataToml = (toml: string): InitdataInspection => {
  const ok = toml.includes('[data]') && toml.includes('cdh.toml');
  const m = /url\s*=\s*['"]([^'"]+)['"]/.exec(toml);
  const kbsUrl = m ? m[1].trim() : null;
  const scheme: InitdataInspection['scheme'] = !kbsUrl
    ? null
    : /^https:\/\//i.test(kbsUrl)
      ? 'https'
      : /^http:\/\//i.test(kbsUrl)
        ? 'http'
        : 'other';
  return { ok, kbsUrl, scheme, hasCert: /kbs_cert\s*=/.test(toml) };
};

/**
 * Decode + inspect a pasted cc_init_data annotation (gzip+base64 of initdata.toml) in
 * the browser. Returns an empty inspection (ok=false) when it does not decode — which
 * the Create form surfaces as "this doesn't look like valid initdata".
 */
export const inspectInitdata = async (annotation: string): Promise<InitdataInspection> => {
  try {
    const bin = atob(annotation.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const toml = await new Response(stream).text();
    return classifyInitdataToml(toml);
  } catch {
    return EMPTY_INSPECTION;
  }
};

/**
 * Decode the KBS URL out of a pod's `cc_init_data` annotation. Returns null if
 * absent/undecodable. Thin wrapper over inspectInitdata for existing callers.
 */
export const decodeInitdataKbsUrl = async (annotation: string): Promise<string | null> =>
  (await inspectInitdata(annotation)).kbsUrl;

/** Is this KBS URL an in-cluster Trustee (kbs-service) or a remote one? */
export const classifyKbsUrl = (kbsUrl: string, localServiceName: string): AttestInfo => {
  let host = kbsUrl;
  try {
    host = new URL(kbsUrl).host;
  } catch {
    /* keep the raw string */
  }
  const local = host.startsWith(`${localServiceName}.`) || host.startsWith(`${localServiceName}:`);
  return { target: local ? 'local' : 'remote', host };
};

/** Extract just the host (no port) from a KBS URL, tolerating a bare host string. */
export const kbsHostFromUrl = (kbsUrl: string): string => {
  const raw = kbsUrl.trim();
  // Only trust the URL parser when there is a real `scheme://authority`. A bare
  // `host:port` (e.g. "kbs-service.trustee.svc:8080") is wrongly parsed by `new
  // URL` as scheme `kbs-service.trustee.svc:` with an empty hostname, so we must
  // not route it through the parser.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      return new URL(raw).hostname;
    } catch {
      /* fall through to manual stripping */
    }
  }
  // Strip any scheme, path, and port so the caller still gets a comparable host.
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
};

/**
 * Is this KBS host an in-cluster Kubernetes Service DNS name (`*.svc` or
 * `*.svc.cluster.local`)? Such a name only resolves inside the cluster that owns
 * the Service, so a workload running on a spoke or air-gapped cluster cannot reach
 * it — the pod starts but silently fails to attest at runtime (visible only in the
 * in-guest CDH probe). This drives a warn-only hint on the initdata field; it never
 * blocks Create, because same-cluster Trustee is a supported topology.
 */
export const isInClusterKbsHost = (kbsUrl: string): boolean => {
  const host = kbsHostFromUrl(kbsUrl).toLowerCase();
  if (host === '') return false;
  return host.endsWith('.svc') || host.endsWith('.svc.cluster.local');
};

// ---- model ----

/** Build the live (this-cluster) topology model from confidential pods + nodes. */
export const buildTopoCluster = (
  pods: PodKind[],
  nodes: NodeKind[],
  infra: InfrastructureKind[],
  attestByUid: Map<string, AttestInfo> = new Map(),
): TopoCluster => {
  const clusterName =
    infra.find((i) => i.metadata?.name === 'cluster')?.status?.infrastructureName ?? 'This cluster';

  const nodeByName = new Map<string, NodeKind>();
  nodes.forEach((n) => {
    const nm = n.metadata?.name;
    if (nm) nodeByName.set(nm, n);
  });

  const confidential = pods.filter((p) => isConfidentialRuntimeName(p.spec?.runtimeClassName));

  const byNode = new Map<string, TopoWorkload[]>();
  confidential.forEach((p) => {
    const nodeName = p.spec?.nodeName ?? '';
    const runtime = p.spec?.runtimeClassName ?? '';
    const uid = p.metadata?.uid ?? `${p.metadata?.namespace ?? ''}/${p.metadata?.name ?? ''}`;
    const hasInitData = !!p.metadata?.annotations?.[CC_INIT_DATA_ANNOTATION];
    const decoded = attestByUid.get(uid);
    const attest: AttestKind = !hasInitData ? 'none' : decoded ? decoded.target : 'unknown';
    const wl: TopoWorkload = {
      uid,
      name: p.metadata?.name ?? '',
      namespace: p.metadata?.namespace ?? '',
      nodeName,
      runtime,
      gpu: runtime.includes('gpu'),
      status: podStatusCategory(p),
      attest,
      attestHost: decoded?.host,
    };
    const arr = byNode.get(nodeName) ?? [];
    arr.push(wl);
    byNode.set(nodeName, arr);
  });

  const topoNodes: TopoNode[] = [...byNode.entries()]
    .map(([name, workloads]) => {
      const obj = name ? nodeByName.get(name) : undefined;
      return {
        name,
        tee: teeTypeForNode(obj),
        ready: name ? nodeReady(obj) : false,
        known: !!obj,
        workloads: [...workloads].sort((a, b) =>
          `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`),
        ),
      };
    })
    // real nodes alphabetically; the unscheduled ('') bucket sinks to the bottom
    .sort((a, b) => {
      if (a.name === '') return 1;
      if (b.name === '') return -1;
      return a.name.localeCompare(b.name);
    });

  return { name: clusterName, nodes: topoNodes, workloadCount: confidential.length };
};

// ---- layout (pure geometry; pixel coordinates for the SVG) ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LaidWorkload extends Rect {
  wl: TopoWorkload;
}
export interface LaidNode extends Rect {
  node: TopoNode;
  headerH: number;
  workloads: LaidWorkload[];
}
export interface LaidCluster extends Rect {
  name: string;
  headerH: number;
  nodes: LaidNode[];
  workloadCount: number;
  empty: boolean;
}
export interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed: boolean;
}
export interface Layout {
  width: number;
  height: number;
  hub: Rect;
  cluster: LaidCluster;
  edge: Edge;
}

const GEO = {
  pad: 16,
  hubW: 208,
  hubH: 120,
  arrowGap: 80,
  clusterW: 600,
  clusterPad: 14,
  clusterHeaderH: 46,
  nodeGap: 12,
  nodePad: 12,
  nodeHeaderH: 32,
  wlW: 174,
  wlH: 60,
  wlGap: 10,
  emptyH: 48,
};

export const layoutTopology = (cluster: TopoCluster): Layout => {
  const g = GEO;
  const clusterX = g.pad + g.hubW + g.arrowGap;
  const innerW = g.clusterW - 2 * g.clusterPad; // node-box width
  const nodeInnerW = innerW - 2 * g.nodePad;
  const cols = Math.max(1, Math.floor((nodeInnerW + g.wlGap) / (g.wlW + g.wlGap)));

  const nodeX = clusterX + g.clusterPad;
  const wlX0 = nodeX + g.nodePad;
  let cursorY = g.pad + g.clusterHeaderH + g.clusterPad; // first node top

  const laidNodes: LaidNode[] = cluster.nodes.map((node) => {
    const rows = Math.max(1, Math.ceil(node.workloads.length / cols));
    const contentH = rows * g.wlH + (rows - 1) * g.wlGap;
    const nodeH = g.nodeHeaderH + contentH + g.nodePad;
    const nodeTop = cursorY;
    const wlY0 = nodeTop + g.nodeHeaderH;
    const workloads: LaidWorkload[] = node.workloads.map((wl, i) => ({
      wl,
      x: wlX0 + (i % cols) * (g.wlW + g.wlGap),
      y: wlY0 + Math.floor(i / cols) * (g.wlH + g.wlGap),
      w: g.wlW,
      h: g.wlH,
    }));
    cursorY = nodeTop + nodeH + g.nodeGap;
    return { node, x: nodeX, y: nodeTop, w: innerW, h: nodeH, headerH: g.nodeHeaderH, workloads };
  });

  const empty = cluster.nodes.length === 0;
  const contentBottom = empty
    ? g.pad + g.clusterHeaderH + g.clusterPad + g.emptyH
    : cursorY - g.nodeGap; // bottom of the last node
  const clusterH = contentBottom - g.pad + g.clusterPad;

  const laidCluster: LaidCluster = {
    name: cluster.name,
    x: clusterX,
    y: g.pad,
    w: g.clusterW,
    h: clusterH,
    headerH: g.clusterHeaderH,
    nodes: laidNodes,
    workloadCount: cluster.workloadCount,
    empty,
  };

  // Hub centered on the cluster; when the cluster is shorter than the hub, the hub
  // top-aligns and the canvas grows to fit it (no clipping for tiny clusters).
  const hubY = g.pad + Math.max(0, (clusterH - g.hubH) / 2);
  const hub: Rect = { x: g.pad, y: hubY, w: g.hubW, h: g.hubH };

  const edge: Edge = {
    x1: hub.x + hub.w,
    y1: hub.y + hub.h / 2,
    x2: clusterX,
    y2: g.pad + clusterH / 2,
    dashed: false,
  };

  return {
    width: clusterX + g.clusterW + g.pad,
    height: g.pad + Math.max(clusterH, g.hubH) + g.pad,
    hub,
    cluster: laidCluster,
    edge,
  };
};
