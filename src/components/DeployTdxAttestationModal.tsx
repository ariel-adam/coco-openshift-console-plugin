import type { FC } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  k8sCreate,
  k8sDelete,
  ResourceLink,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  ClipboardCopy,
  ClipboardCopyVariant,
  Content,
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ProgressStep,
  ProgressStepper,
  TextInput,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import {
  ClusterRoleBindingModel,
  DaemonSetGVK,
  DeploymentGVK,
  INTEL_DCAP_NAMESPACE,
  INTEL_PCS_PORTAL_URL,
  JobGVK,
  JobModel,
  NamespaceModel,
  NodeGVK,
  OC_CLI_IMAGE,
  OSC_DCAP_HELPERS_TAG,
  oscDcapHelpersBase,
  SecretModel,
  ServiceAccountModel,
  UBI9_IMAGE,
} from '../k8s/resources';
import type { DaemonSetKind, DeploymentKind, JobKind, NodeKind } from '../k8s/types';
import './coco.css';

const PREFIX = 'coco-openshift-console-plugin';
const NS = INTEL_DCAP_NAMESPACE;
/** Name shared by the setup Job, its ServiceAccount and its ClusterRoleBinding. */
const SETUP_NAME = 'coco-tdx-attest-setup';
/** Transient Secret that feeds the API key + tokens into the Job (mounted, not logged). */
const INPUT_SECRET = 'coco-tdx-attest-input';

const isNotFound = (e: unknown): boolean =>
  /not found|notfound|404/i.test(e instanceof Error ? e.message : String(e));
const isAlreadyExists = (e: unknown): boolean =>
  /already exists|alreadyexists|conflict|409/i.test(e instanceof Error ? e.message : String(e));

const isControlPlane = (n: NodeKind): boolean => {
  const labels = n.metadata?.labels ?? {};
  return (
    'node-role.kubernetes.io/control-plane' in labels || 'node-role.kubernetes.io/master' in labels
  );
};

/**
 * The in-cluster setup script — the OSC 1.12 "Deploying Intel TDX remote
 * attestation" procedure (§3.2), run by a cluster-admin Job. `oc` is provided by
 * an initContainer that copies it from the OpenShift CLI image into /shared; the
 * runner image (UBI9) supplies openssl/curl/base64/sha512sum/sed. The Intel PCS
 * API key and tokens are read from the mounted input Secret, never interpolated
 * into the command line. pccs.yaml.in is substituted with sed (no envsubst needed)
 * and applied; qgs.yaml is applied straight from the pinned operator-repo tag.
 */
const buildSetupScript = (base: string): string =>
  [
    'set -eu',
    'export HOME=/tmp',
    'export PATH="/shared:$PATH"',
    'NS=intel-dcap',
    `BASE="${base}"`,
    'echo "### Reading inputs"',
    'PCCS_API_KEY="$(cat /input/PCCS_API_KEY)"',
    'PCCS_USER_TOKEN="$(cat /input/PCCS_USER_TOKEN 2>/dev/null || echo mytoken)"',
    'PCCS_ADMIN_TOKEN="$(cat /input/PCCS_ADMIN_TOKEN 2>/dev/null || echo mytoken)"',
    'PCCS_NODE="$(cat /input/PCCS_NODE 2>/dev/null || true)"',
    'echo "### 1/6 Namespace + service accounts"',
    'oc get ns "$NS" >/dev/null 2>&1 || oc create namespace "$NS"',
    'oc -n "$NS" get sa pccs-sa >/dev/null 2>&1 || oc -n "$NS" create serviceaccount pccs-sa',
    'oc -n "$NS" get sa qgs-sa >/dev/null 2>&1 || oc -n "$NS" create serviceaccount qgs-sa',
    'echo "### 2/6 Grant the privileged SCC"',
    'oc adm policy add-scc-to-user privileged -z pccs-sa -n "$NS"',
    'oc adm policy add-scc-to-user privileged -z qgs-sa -n "$NS"',
    'echo "### 3/6 Resolve PCCS node + cluster proxy"',
    'if [ -z "$PCCS_NODE" ]; then PCCS_NODE="$(oc get nodes -l node-role.kubernetes.io/control-plane= -o jsonpath=\'{.items[0].metadata.name}\')"; fi',
    'echo "PCCS node: $PCCS_NODE"',
    'CLUSTER_HTTPS_PROXY="$(oc get proxy/cluster -o jsonpath=\'{.spec.httpsProxy}\' 2>/dev/null || true)"',
    'echo "### 4/6 Create the pccs-secrets secret"',
    'PCCS_USER_TOKEN_HASH="$(printf \'%s\' "$PCCS_USER_TOKEN" | sha512sum | tr -d \'[:space:]-\')"',
    'PCCS_ADMIN_TOKEN_HASH="$(printf \'%s\' "$PCCS_ADMIN_TOKEN" | sha512sum | tr -d \'[:space:]-\')"',
    'oc -n "$NS" delete secret pccs-secrets --ignore-not-found >/dev/null 2>&1 || true',
    'oc -n "$NS" create secret generic pccs-secrets --from-literal=PCCS_API_KEY="$PCCS_API_KEY" --from-literal=PCCS_USER_TOKEN_HASH="$PCCS_USER_TOKEN_HASH" --from-literal=USER_TOKEN="$PCCS_USER_TOKEN" --from-literal=PCCS_ADMIN_TOKEN_HASH="$PCCS_ADMIN_TOKEN_HASH"',
    'echo "### 5/6 Generate the PCCS TLS cert + deploy PCCS"',
    'CERTDIR="$(mktemp -d)"',
    'openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout "$CERTDIR/private.pem" -out "$CERTDIR/certificate.pem" -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=www.example.com" 2>/dev/null',
    'PCCS_PEM="$(base64 -w0 < "$CERTDIR/private.pem")"',
    'PCCS_CERT="$(base64 -w0 < "$CERTDIR/certificate.pem")"',
    'curl -sSfL "$BASE/pccs.yaml.in" -o /tmp/pccs.yaml.in',
    'sed -e "s|\\${PCCS_PEM}|${PCCS_PEM}|g" -e "s|\\${PCCS_CERT}|${PCCS_CERT}|g" -e "s|\\${PCCS_NODE}|${PCCS_NODE}|g" -e "s|\\${CLUSTER_HTTPS_PROXY}|${CLUSTER_HTTPS_PROXY}|g" /tmp/pccs.yaml.in | oc apply -f -',
    'oc -n "$NS" set serviceaccount deployment/pccs pccs-sa',
    'echo "### 6/6 Deploy the QGS DaemonSet"',
    'oc apply -f "$BASE/qgs.yaml"',
    'oc -n "$NS" set serviceaccount daemonset/tdx-qgs qgs-sa',
    'echo "### DONE: Intel TDX remote attestation infrastructure applied."',
  ].join('\n');

/** The same procedure as copy-paste commands for an admin workstation (oc logged in). */
const buildManualScript = (base: string, node: string): string =>
  [
    '# 1. Remote attestation project + service accounts',
    'oc create namespace intel-dcap',
    'oc create serviceaccount pccs-sa -n intel-dcap',
    'oc create serviceaccount qgs-sa -n intel-dcap',
    'oc adm policy add-scc-to-user privileged -z pccs-sa -n intel-dcap',
    'oc adm policy add-scc-to-user privileged -z qgs-sa -n intel-dcap',
    '',
    '# 2. Variables — paste your Intel PCS API key',
    'export PCCS_API_KEY="<API_KEY_VALUE>"',
    'export PCCS_USER_TOKEN="${PCCS_USER_TOKEN:-mytoken}"',
    'export PCCS_ADMIN_TOKEN="${PCCS_ADMIN_TOKEN:-mytoken}"',
    `export PCCS_NODE="${node || '<control-plane-node>'}"`,
    'export CLUSTER_HTTPS_PROXY="$(oc get proxy/cluster -o jsonpath={.spec.httpsProxy})"',
    '',
    '# 3. PCCS secrets (token hashes + self-signed PCCS cert)',
    'export PCCS_USER_TOKEN_HASH=$(echo -n "$PCCS_USER_TOKEN" | sha512sum | tr -d \'[:space:]-\')',
    'export PCCS_ADMIN_TOKEN_HASH=$(echo -n "$PCCS_ADMIN_TOKEN" | sha512sum | tr -d \'[:space:]-\')',
    'export PCCS_PEM_CERT_PATH=$(mktemp -d)',
    'openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 \\',
    '  -keyout $PCCS_PEM_CERT_PATH/private.pem \\',
    '  -out $PCCS_PEM_CERT_PATH/certificate.pem \\',
    '  -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=www.example.com"',
    'export PCCS_PEM=$(cat "$PCCS_PEM_CERT_PATH"/private.pem | base64 | tr -d \'\\n\')',
    'export PCCS_CERT=$(cat "$PCCS_PEM_CERT_PATH"/certificate.pem | base64 | tr -d \'\\n\')',
    'oc create secret generic pccs-secrets \\',
    '  --namespace intel-dcap \\',
    '  --from-literal=PCCS_API_KEY="$PCCS_API_KEY" \\',
    '  --from-literal=PCCS_USER_TOKEN_HASH="$PCCS_USER_TOKEN_HASH" \\',
    '  --from-literal=USER_TOKEN="$PCCS_USER_TOKEN" \\',
    '  --from-literal=PCCS_ADMIN_TOKEN_HASH="$PCCS_ADMIN_TOKEN_HASH"',
    '',
    `# 4. Deploy PCCS + QGS (pinned ${OSC_DCAP_HELPERS_TAG} manifests)`,
    `oc apply -f <(curl -sSf ${base}/pccs.yaml.in | envsubst)`,
    'oc set serviceaccount deployment/pccs pccs-sa -n intel-dcap',
    `oc apply -f ${base}/qgs.yaml`,
    'oc set serviceaccount daemonset/tdx-qgs qgs-sa -n intel-dcap',
  ].join('\n');

type Props = {
  /** How many TDX-capable nodes are detected (drives the live prerequisite hint). */
  tdxNodeCount: number;
  onClose: () => void;
};

/**
 * Guided, automated setup of the Intel TDX remote attestation infrastructure
 * (PCCS + per-node QGS). Automates every deployable step from the bare-metal CoCo
 * docs and prompts only for the one purely-manual input: the Intel PCS API key.
 */
const DeployTdxAttestationModal: FC<Props> = ({ tdxNodeCount, onClose }) => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');

  const base = useMemo(() => oscDcapHelpersBase(), []);

  const [apiKey, setApiKey] = useState('');
  const [userToken, setUserToken] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [pccsNode, setPccsNode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const cleanedUpRef = useRef(false);

  // Control-plane nodes — the PCCS pins to one of them (it caches PCK collateral on
  // a host path and needs outbound access to the Intel PCS).
  const [nodes] = useK8sWatchResource<NodeKind[]>({ groupVersionKind: NodeGVK, isList: true });
  const controlPlane = useMemo(
    () =>
      (nodes ?? [])
        .filter(isControlPlane)
        .map((n) => n.metadata?.name ?? '')
        .filter(Boolean),
    [nodes],
  );
  // Effective PCCS node: the user's pick, else the first control-plane node. (The
  // Job also auto-detects when this is left blank.)
  const effectivePccsNode = pccsNode || controlPlane[0] || '';

  // Watch the Job + the two workloads it creates, once we've launched.
  const [job] = useK8sWatchResource<JobKind>(
    started ? { groupVersionKind: JobGVK, name: SETUP_NAME, namespace: NS } : null,
  ) as [JobKind | undefined, boolean, unknown];
  const [pccs] = useK8sWatchResource<DeploymentKind>(
    started ? { groupVersionKind: DeploymentGVK, name: 'pccs', namespace: NS } : null,
  ) as [DeploymentKind | undefined, boolean, unknown];
  const [qgs] = useK8sWatchResource<DaemonSetKind>(
    started ? { groupVersionKind: DaemonSetGVK, name: 'tdx-qgs', namespace: NS } : null,
  ) as [DaemonSetKind | undefined, boolean, unknown];

  const jobActive = (job?.status?.active ?? 0) > 0;
  const jobSucceeded = (job?.status?.succeeded ?? 0) > 0;
  const jobFailed =
    (job?.status?.failed ?? 0) > 0 ||
    (job?.status?.conditions ?? []).some((c) => c.type === 'Failed' && c.status === 'True');

  const pccsReady = (pccs?.status?.availableReplicas ?? 0) > 0;
  const qgsDesired = qgs?.status?.desiredNumberScheduled ?? 0;
  const qgsReady = qgs?.status?.numberReady ?? 0;
  const qgsUp = qgsDesired > 0 && qgsReady >= qgsDesired;

  const valid = apiKey.trim() !== '';

  // Once the Job succeeds the infrastructure is applied. Drop the cluster-admin
  // binding and the API-key input Secret immediately — they're only needed while
  // the Job runs. The Job (and its logs) and the SA are left for inspection.
  useEffect(() => {
    if (!jobSucceeded || cleanedUpRef.current) return;
    cleanedUpRef.current = true;
    void (async () => {
      for (const [model, resource] of [
        [
          SecretModel,
          { apiVersion: 'v1', kind: 'Secret', metadata: { name: INPUT_SECRET, namespace: NS } },
        ],
        [
          ClusterRoleBindingModel,
          {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'ClusterRoleBinding',
            metadata: { name: SETUP_NAME },
          },
        ],
      ] as const) {
        try {
          await k8sDelete({ model, resource });
        } catch {
          /* best effort */
        }
      }
    })();
  }, [jobSucceeded]);

  const onDeploy = async () => {
    setBusy(true);
    setError('');
    try {
      // Namespace first (the Job's SA/Secret live in it). Idempotent.
      try {
        await k8sCreate({
          model: NamespaceModel,
          data: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: NS } },
        });
      } catch (e) {
        if (!isAlreadyExists(e)) throw e;
      }

      const sa = {
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: { name: SETUP_NAME, namespace: NS },
      };
      const crb = {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: SETUP_NAME },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'cluster-admin',
        },
        subjects: [{ kind: 'ServiceAccount', name: SETUP_NAME, namespace: NS }],
      };
      const inputSecret = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: INPUT_SECRET, namespace: NS },
        type: 'Opaque',
        stringData: {
          PCCS_API_KEY: apiKey.trim(),
          PCCS_USER_TOKEN: userToken.trim() || 'mytoken',
          PCCS_ADMIN_TOKEN: adminToken.trim() || 'mytoken',
          PCCS_NODE: effectivePccsNode,
        },
      };
      // Recreate SA + ClusterRoleBinding + input Secret so reruns start clean.
      for (const [model, resource] of [
        [ServiceAccountModel, sa],
        [ClusterRoleBindingModel, crb],
        [SecretModel, inputSecret],
      ] as const) {
        try {
          await k8sDelete({ model, resource });
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
        await k8sCreate({ model, data: resource });
      }

      const script = buildSetupScript(base);
      const jobResource: JobKind & Record<string, unknown> = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: SETUP_NAME, namespace: NS },
        spec: {
          backoffLimit: 2,
          template: {
            metadata: { name: SETUP_NAME },
            spec: {
              serviceAccountName: SETUP_NAME,
              restartPolicy: 'Never',
              securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
              volumes: [
                { name: 'shared', emptyDir: {} },
                { name: 'input', secret: { secretName: INPUT_SECRET } },
              ],
              initContainers: [
                {
                  name: 'copy-oc',
                  image: OC_CLI_IMAGE,
                  command: ['sh', '-c', 'cp /usr/bin/oc /shared/oc'],
                  volumeMounts: [{ name: 'shared', mountPath: '/shared' }],
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    capabilities: { drop: ['ALL'] },
                  },
                },
              ],
              containers: [
                {
                  name: 'setup',
                  image: UBI9_IMAGE,
                  command: ['bash', '-c'],
                  args: [script],
                  env: [{ name: 'HOME', value: '/tmp' }],
                  volumeMounts: [
                    { name: 'shared', mountPath: '/shared' },
                    { name: 'input', mountPath: '/input', readOnly: true },
                  ],
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    capabilities: { drop: ['ALL'] },
                  },
                },
              ],
            },
          },
        },
      };
      try {
        await k8sDelete({ model: JobModel, resource: jobResource as JobKind });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      await k8sCreate({ model: JobModel, data: jobResource as JobKind });
      setStarted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ProgressStepper variants for the three phases.
  const applyVariant = jobFailed
    ? 'danger'
    : jobSucceeded
      ? 'success'
      : jobActive
        ? 'info'
        : 'pending';
  const pccsVariant = pccsReady ? 'success' : jobSucceeded ? 'info' : 'pending';
  const qgsVariant = qgsUp
    ? 'success'
    : jobSucceeded && qgsDesired > 0
      ? 'warning'
      : jobSucceeded
        ? 'info'
        : 'pending';

  return (
    <Modal isOpen variant="large" onClose={onClose} aria-label={t('Set up Intel TDX attestation')}>
      <ModalHeader title={t('Set up Intel TDX remote attestation')} />
      <ModalBody>
        <Alert variant="info" isInline title={t('What this sets up')} className={`${PREFIX}__mb`}>
          {t(
            'Intel TDX pods prove their identity with a signed TD quote. This deploys the host-side stack that produces and backs those quotes: an in-cluster Provisioning Certificate Caching Service (PCCS) that caches PCK certificates from Intel, automatic per-node platform registration, and a per-node Quote Generation Service (QGS) the guest reaches over vsock. Without it, attestation fails with an empty quote and Trustee never releases a secret.',
          )}
        </Alert>

        <Alert variant="warning" isInline title={t('Before you start')} className={`${PREFIX}__mb`}>
          <List>
            <ListItem>
              {t(
                'This runs as a temporary cluster-admin Job — it creates a namespace, grants the privileged SCC, and applies a privileged DaemonSet. You must be a cluster administrator.',
              )}
            </ListItem>
            <ListItem>
              {tdxNodeCount > 0
                ? t(
                    '{{count}} Intel TDX node(s) detected — the QGS DaemonSet schedules onto them.',
                    {
                      count: tdxNodeCount,
                    },
                  )
                : t(
                    'No Intel TDX nodes detected yet. Label them first (Detect TEE nodes) or the QGS DaemonSet will have nowhere to run.',
                  )}
            </ListItem>
            <ListItem>
              {t(
                'The Intel SGX device plugin must be installed (Intel Device Plugins Operator) — the QGS requests sgx.intel.com/epc, /enclave and /provision.',
              )}{' '}
              <a
                href="/operatorhub/all-namespaces?keyword=Intel+Device+Plugins"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('Install it')}
              </a>
            </ListItem>
            <ListItem>
              {t(
                'The chosen control-plane (PCCS) node needs outbound internet access to reach the Intel PCS, and your Intel TDX MachineConfig must already be applied.',
              )}
            </ListItem>
          </List>
        </Alert>

        <Form>
          <FormGroup label={t('Intel PCS API key')} isRequired fieldId="pccs-api-key">
            <TextInput
              id="pccs-api-key"
              type="password"
              value={apiKey}
              isDisabled={started}
              validated={valid || apiKey === '' ? 'default' : 'error'}
              onChange={(_e, v) => {
                setApiKey(v);
              }}
              placeholder={t('Paste your Provisioning Certification Service API key')}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  {t(
                    'The one manual step. In the Intel Trusted Services API portal, sign in and subscribe to the Provisioning Certification Service; the API key is shown on the Manage Subscriptions page.',
                  )}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
            <Button
              variant="link"
              isInline
              component="a"
              href={INTEL_PCS_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLinkAltIcon />}
              iconPosition="end"
              className={`${PREFIX}__mt`}
            >
              {t('Open the Intel Trusted Services API portal')}
            </Button>
          </FormGroup>

          <ExpandableSection toggleText={t('Advanced options')}>
            <FormGroup label={t('PCCS node (control plane)')} fieldId="pccs-node">
              {controlPlane.length > 0 ? (
                <FormSelect
                  id="pccs-node"
                  value={effectivePccsNode}
                  isDisabled={started}
                  onChange={(_e, v) => {
                    setPccsNode(v);
                  }}
                >
                  {controlPlane.map((n) => (
                    <FormSelectOption key={n} value={n} label={n} />
                  ))}
                </FormSelect>
              ) : (
                <TextInput
                  id="pccs-node"
                  value={effectivePccsNode}
                  isDisabled={started}
                  onChange={(_e, v) => {
                    setPccsNode(v);
                  }}
                  placeholder={t('Leave blank to auto-select the first control-plane node')}
                />
              )}
            </FormGroup>
            <FormGroup label={t('PCCS user token')} fieldId="pccs-user-token">
              <TextInput
                id="pccs-user-token"
                value={userToken}
                isDisabled={started}
                onChange={(_e, v) => {
                  setUserToken(v);
                }}
                placeholder="mytoken"
              />
            </FormGroup>
            <FormGroup label={t('PCCS admin token')} fieldId="pccs-admin-token">
              <TextInput
                id="pccs-admin-token"
                value={adminToken}
                isDisabled={started}
                onChange={(_e, v) => {
                  setAdminToken(v);
                }}
                placeholder="mytoken"
              />
            </FormGroup>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  {t('Tokens default to "mytoken" if left blank, matching the documented example.')}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </ExpandableSection>

          <ExpandableSection toggleText={t('What this creates in the intel-dcap namespace')}>
            <List>
              <ListItem>
                {t('Namespace intel-dcap and service accounts pccs-sa / qgs-sa (privileged SCC)')}
              </ListItem>
              <ListItem>
                {t('Secret pccs-secrets (API key + token hashes) and a self-signed PCCS TLS cert')}
              </ListItem>
              <ListItem>
                {t('Deployment pccs + Service pccs-service (PCK certificate cache)')}
              </ListItem>
              <ListItem>
                {t('DaemonSet tdx-qgs (per-node quote generation + platform registration)')}
              </ListItem>
            </List>
            <Content component="small" className={`${PREFIX}__muted`}>
              {t(
                'PCCS and QGS images come from the pinned sandboxed-containers-operator {{tag}} manifests.',
                {
                  tag: OSC_DCAP_HELPERS_TAG,
                },
              )}
            </Content>
          </ExpandableSection>

          <ExpandableSection
            toggleText={t('Prefer to run it yourself? Copy the equivalent commands')}
          >
            <Content component="small" className={`${PREFIX}__mb ${PREFIX}__muted`}>
              {t(
                'Run these from a workstation with oc logged in as cluster-admin (needs openssl and envsubst).',
              )}
            </Content>
            <ClipboardCopy
              isCode
              isReadOnly
              variant={ClipboardCopyVariant.expansion}
              hoverTip={t('Copy')}
              clickTip={t('Copied')}
            >
              {buildManualScript(base, effectivePccsNode)}
            </ClipboardCopy>
          </ExpandableSection>

          {started && (
            <ProgressStepper isVertical className={`${PREFIX}__mt`}>
              <ProgressStep
                variant={applyVariant}
                id="step-apply"
                titleId="step-apply-title"
                aria-label={t('Apply attestation infrastructure')}
                isCurrent={jobActive}
                description={
                  jobFailed
                    ? t('The setup Job failed — open it below to read the logs.')
                    : jobSucceeded
                      ? t('Namespace, secrets, PCCS and QGS applied.')
                      : jobActive
                        ? t('Running the documented setup procedure…')
                        : t('Waiting for the Job to start.')
                }
              >
                {t('Apply attestation infrastructure')}
              </ProgressStep>
              <ProgressStep
                variant={pccsVariant}
                id="step-pccs"
                titleId="step-pccs-title"
                aria-label={t('PCCS certificate cache running')}
                description={
                  pccsReady
                    ? t('pccs Deployment is available.')
                    : t('Pulls the PCCS image and starts on the control-plane node.')
                }
              >
                {t('PCCS certificate cache running')}
              </ProgressStep>
              <ProgressStep
                variant={qgsVariant}
                id="step-qgs"
                titleId="step-qgs-title"
                aria-label={t('QGS quote service running')}
                description={
                  qgsUp
                    ? t('tdx-qgs is ready on {{ready}}/{{desired}} node(s).', {
                        ready: qgsReady,
                        desired: qgsDesired,
                      })
                    : jobSucceeded && qgsDesired > 0
                      ? t(
                          '{{ready}}/{{desired}} ready — pods Pending usually means the SGX device plugin is missing.',
                          {
                            ready: qgsReady,
                            desired: qgsDesired,
                          },
                        )
                      : t('Runs on each Intel TDX node once applied.')
                }
              >
                {t('QGS quote service running')}
              </ProgressStep>
            </ProgressStepper>
          )}

          {jobSucceeded && (
            <Alert
              variant="success"
              isInline
              title={t('Attestation infrastructure deployed')}
              className={`${PREFIX}__mt`}
            >
              <p>
                {t(
                  'The PCCS and per-node QGS are applied. New Intel TDX pods can now produce a signed quote; existing pods that failed to attest must be restarted.',
                )}
              </p>
              <div className={`${PREFIX}__mt`}>
                <ResourceLink groupVersionKind={DeploymentGVK} name="pccs" namespace={NS} inline />{' '}
                <ResourceLink
                  groupVersionKind={DaemonSetGVK}
                  name="tdx-qgs"
                  namespace={NS}
                  inline
                />{' '}
                <ResourceLink groupVersionKind={JobGVK} name={SETUP_NAME} namespace={NS} inline />
              </div>
            </Alert>
          )}
          {jobFailed && (
            <Alert
              variant="danger"
              isInline
              title={t('The setup Job failed')}
              className={`${PREFIX}__mt`}
            >
              <p>{t('Open the Job and read its pod logs to see which step failed.')}</p>
              <div className={`${PREFIX}__mt`}>
                <ResourceLink groupVersionKind={JobGVK} name={SETUP_NAME} namespace={NS} inline />
              </div>
            </Alert>
          )}
          {error && (
            <Alert
              variant="danger"
              isInline
              title={t('Could not start the setup')}
              className={`${PREFIX}__mt`}
            >
              {error}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        {!jobSucceeded ? (
          <>
            <Button
              variant="primary"
              onClick={() => void onDeploy()}
              isLoading={busy || (started && !jobFailed)}
              isDisabled={!valid || busy || (started && !jobFailed)}
            >
              {started && jobFailed ? t('Retry') : t('Deploy attestation infrastructure')}
            </Button>
            <Button variant="link" onClick={onClose}>
              {t('Cancel')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            {t('Done')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default DeployTdxAttestationModal;
