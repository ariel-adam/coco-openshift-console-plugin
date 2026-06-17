import {
  DocumentTitle,
  k8sCreate,
  ListPageHeader,
  useK8sWatchResource,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  MenuToggle,
  type MenuToggleElement,
  PageSection,
  Select,
  SelectList,
  SelectOption,
  TextArea,
  TextInput,
  TextInputGroup,
  TextInputGroupMain,
} from '@patternfly/react-core';
import type { FC, Ref } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  CC_INIT_DATA_ANNOTATION,
  DeploymentModel,
  EVIDENCE_SIDECAR_IMAGE,
  NamespaceModel,
  PersistentVolumeClaimModel,
  PodModel,
  ProjectGVK,
  RoleBindingModel,
  RoleModel,
  ServiceAccountModel,
  StorageClassGVK,
} from '../k8s/resources';
import type { NamespaceKind, StorageClassKind } from '../k8s/types';
import './coco.css';

type Kind = 'Pod' | 'Deployment';
type RuntimeClass = 'kata-cc' | 'kata-cc-nvidia-gpu';

const CREATE_NS_SENTINEL = '__coco_create_namespace__';
const IS_DEFAULT_SC_ANNOTATION = 'storageclass.kubernetes.io/is-default-class';
/** Placeholder shown when no LUKS helper image is supplied — must be replaced by the user. */
const LUKS_HELPER_PLACEHOLDER = '<luks-helper-image>';

// --- Attestation evidence sidecar ---
/**
 * Sanitize an arbitrary string into the suffix of a ConfigMap / RBAC object name.
 * Kubernetes object names are RFC 1123 labels: lowercase alphanumerics and '-',
 * and the evidence ConfigMap name must be <= 253 chars total.
 */
const sanitizeName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');

/** ConfigMap the Trustee plugin reads; one per pod, in the workload's namespace. */
const evidenceCmName = (podName: string): string =>
  `attestation-evidence-${sanitizeName(podName)}`.slice(0, 253).replace(/-+$/g, '');

/** ServiceAccount/Role/RoleBinding name for the sidecar (shared base name). */
const evidenceRbacName = (podName: string): string =>
  `${sanitizeName(podName)}-att-evidence`.slice(0, 253).replace(/-+$/g, '');

/**
 * Script run by the attestation-evidence sidecar. Tiny on purpose: it runs in a
 * ubi-minimal image (curl + bash + sed + coreutils) so it fits inside the
 * confidential kata-cc guest VM — the old coco-tools image (oc + python3) could
 * not unpack there ("No space left on device"). Built as single-quoted lines so
 * every bash `${VAR}` stays literal; all user-supplied values arrive via the
 * container env (POD_NAME, POD_NS, POD_UID, NODE_NAME, RUNTIME, HAS_INITDATA,
 * CDH_PATH, INTERVAL, CM_NAME, KBS_ENDPOINT), never via JS string interpolation.
 * Each loop iteration:
 *   1. probes the Confidential Data Hub for a KBS resource (released only after a
 *      successful in-guest attestation) and maps the curl exit code to a verdict,
 *   2. renders the trustee.attestation.evidence/v1 document with printf, and
 *   3. PATCHes (server-side apply) the evidence ConfigMap the Trustee plugin
 *      reads straight to the Kubernetes API with curl — no oc, no python.
 */
const SIDECAR_SCRIPT = [
  'set -u',
  'API="https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}"',
  'TOKEN="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"',
  'CACERT=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
  'while true; do',
  '  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
  '  HTTP="$(curl -s -m 10 -o /tmp/resp -w \'%{http_code}\' "http://127.0.0.1:8006/cdh/resource/${CDH_PATH}" 2>/tmp/cerr)"; PRC=$?',
  '  if [ "$PRC" -ne 0 ]; then VERDICT=inconclusive; HTTP=000; elif [ "$HTTP" -ge 200 ] && [ "$HTTP" -lt 300 ]; then VERDICT=passed; else VERDICT=failed; fi',
  '  printf \'{"schema":"trustee.attestation.evidence/v1","source":"sidecar","timestamp":"%s","workload":{"namespace":"%s","name":"%s","uid":"%s","node":"%s","runtimeClassName":"%s","hasInitData":%s},"trustee":{"kbsEndpoint":"%s"},"probe":{"method":"in-guest sidecar CDH resource fetch","cdhPath":"%s","httpStatus":"%s","execExitCode":%s},"verdict":"%s"}\' "$TS" "$POD_NS" "$POD_NAME" "$POD_UID" "$NODE_NAME" "$RUNTIME" "$HAS_INITDATA" "$KBS_ENDPOINT" "$CDH_PATH" "$HTTP" "$PRC" "$VERDICT" > /tmp/ev.json',
  "  ESC=\"$(sed -e 's/\\\\/\\\\\\\\/g' -e 's/\"/\\\\\"/g' /tmp/ev.json | tr -d '\\n')\"",
  '  printf \'{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"%s","labels":{"trustee.attestation/evidence":"true","trustee.attestation/pod":"%s"}},"data":{"evidence.json":"%s"}}\' "$CM_NAME" "$POD_NAME" "$ESC" > /tmp/cm.json',
  '  curl -sS --cacert "$CACERT" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/apply-patch+yaml" -X PATCH "${API}/api/v1/namespaces/${POD_NS}/configmaps/${CM_NAME}?fieldManager=attestation-evidence-sidecar&force=true" --data-binary @/tmp/cm.json >/tmp/apply.out 2>/tmp/apply.err || true',
  '  sleep "${INTERVAL}"',
  'done',
].join('\n');

const CreateConfidentialWorkload: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const navigate = useNavigate();

  const [kind, setKind] = useState<Kind>('Pod');
  const [name, setName] = useState('coco-workload');
  const [namespace, setNamespace] = useState('default');
  const [image, setImage] = useState('registry.access.redhat.com/ubi9/ubi:latest');
  const [runtimeClass, setRuntimeClass] = useState<RuntimeClass>('kata-cc');
  const [replicas, setReplicas] = useState('1');
  const [command, setCommand] = useState('sleep infinity');
  const [initdata, setInitdata] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // --- Namespace typeahead (pick existing or type a brand-new name) ---
  // Project (project.openshift.io) is the RBAC-aware list of namespaces the user
  // can see: a non-admin can't list cluster-scoped Namespaces but can list their
  // Projects; for an admin it's every namespace.
  const [projects] = useK8sWatchResource<NamespaceKind[]>({
    groupVersionKind: ProjectGVK,
    isList: true,
  });
  const nsNames = useMemo(
    () =>
      [...new Set((projects ?? []).map((n) => n.metadata?.name).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b),
      ),
    [projects],
  );
  const [nsOpen, setNsOpen] = useState(false);
  // What the user has typed into the combobox input (drives filtering + creatable option).
  const [nsInput, setNsInput] = useState(namespace);
  const nsToggleRef = useRef<MenuToggleElement>(null);
  const nsTrimmed = namespace.trim();
  const namespaceExists = nsNames.includes(nsTrimmed);
  const nsFilter = nsInput.trim().toLowerCase();
  // Don't filter while the input still shows the current selection, so opening the
  // menu lists every namespace; only narrow once the user types something new.
  const filterActive = nsFilter !== '' && nsFilter !== nsTrimmed.toLowerCase();
  const filteredNs = filterActive
    ? nsNames.filter((n) => n.toLowerCase().includes(nsFilter))
    : nsNames;
  // Offer a creatable option when the typed text doesn't exactly match an existing namespace.
  const nsTypedValue = nsInput.trim();
  const showCreateNsOption = nsTypedValue !== '' && !nsNames.includes(nsTypedValue);

  const selectNamespace = (value: string) => {
    setNamespace(value);
    setNsInput(value);
    setNsOpen(false);
    nsToggleRef.current?.focus();
  };

  // --- Encrypted block volume (LUKS) wizard ---
  const [enc, setEnc] = useState(false);
  const [pvcName, setPvcName] = useState('');
  const [pvcSize, setPvcSize] = useState('1Gi');
  const [storageClass, setStorageClass] = useState('');
  const [devicePath, setDevicePath] = useState('/dev/encblock');
  const [passphraseSource, setPassphraseSource] = useState('kbs:///default/luks/passphrase');
  const [helperImage, setHelperImage] = useState('');
  const [scOpen, setScOpen] = useState(false);
  // True once the user edits the PVC name, so we stop auto-deriving it from the workload name.
  const [pvcNameTouched, setPvcNameTouched] = useState(false);
  const [scTouched, setScTouched] = useState(false);

  // --- Attestation evidence sidecar (self-reporting, no exec) ---
  const [evidenceSidecar, setEvidenceSidecar] = useState(false);
  const [evidenceCdhPath, setEvidenceCdhPath] = useState('default/kbsres1/key1');
  const [evidenceInterval, setEvidenceInterval] = useState('60');

  // PodSecurity "restricted": the always-safe context fields are set unconditionally;
  // runAsNonRoot is opt-out because it blocks images that must run as root.
  const [runAsNonRoot, setRunAsNonRoot] = useState(true);

  const [storageClasses] = useK8sWatchResource<StorageClassKind[]>({
    groupVersionKind: StorageClassGVK,
    isList: true,
  });
  const scNames = useMemo(
    () =>
      ((storageClasses ?? []).map((s) => s.metadata?.name).filter(Boolean) as string[]).sort(
        (a, b) => a.localeCompare(b),
      ),
    [storageClasses],
  );
  const defaultSc = useMemo(() => {
    const flagged = (storageClasses ?? []).find(
      (s) => s.metadata?.annotations?.[IS_DEFAULT_SC_ANNOTATION] === 'true',
    );
    return flagged?.metadata?.name ?? scNames[0] ?? '';
  }, [storageClasses, scNames]);

  // Default-select the cluster's default StorageClass once the list loads (unless the user chose one).
  const effectiveSc = scTouched ? storageClass : storageClass || defaultSc;
  // Default the PVC name from the workload name until the user overrides it.
  const effectivePvcName = pvcNameTouched ? pvcName : pvcName || `${name.trim()}-enc`;

  // The sidecar records which KBS it attested against. The KBS endpoint is baked
  // into the initdata (which the user pastes below), so it is left empty here —
  // the probe still works via the CDH.
  const kbsEndpoint = '';

  const valid =
    name.trim() !== '' &&
    nsTrimmed !== '' &&
    image.trim() !== '' &&
    initdata.trim() !== '' &&
    (!enc || (effectivePvcName.trim() !== '' && pvcSize.trim() !== ''));

  const buildPvc = (): K8sResourceCommon =>
    ({
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: effectivePvcName.trim(), namespace: nsTrimmed },
      spec: {
        accessModes: ['ReadWriteOnce'],
        volumeMode: 'Block',
        resources: { requests: { storage: pvcSize.trim() } },
        ...(effectiveSc.trim() ? { storageClassName: effectiveSc.trim() } : {}),
      },
    }) as K8sResourceCommon;

  // ServiceAccount + Role + RoleBinding the evidence sidecar runs as. Returned as
  // a list so create() can apply them and the manifest preview can render them.
  const buildEvidenceRbac = (): K8sResourceCommon[] => {
    const rbacName = evidenceRbacName(name.trim());
    return [
      {
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: { name: rbacName, namespace: nsTrimmed },
      } as K8sResourceCommon,
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'Role',
        metadata: { name: rbacName, namespace: nsTrimmed },
        rules: [
          {
            apiGroups: [''],
            resources: ['configmaps'],
            verbs: ['get', 'create', 'patch', 'update'],
          },
          { apiGroups: [''], resources: ['pods'], verbs: ['get'] },
        ],
      } as unknown as K8sResourceCommon,
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name: rbacName, namespace: nsTrimmed },
        subjects: [{ kind: 'ServiceAccount', name: rbacName, namespace: nsTrimmed }],
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: rbacName },
      } as unknown as K8sResourceCommon,
    ];
  };

  const buildManifest = (initdataValue: string): K8sResourceCommon => {
    const cmd = command.trim() ? command.trim().split(/\s+/) : undefined;
    // When an encrypted volume is requested, the main container mounts it as a raw
    // block device and an init container opens (and on first use formats) the LUKS
    // device using the passphrase before the app container starts.
    const encVolumeDevices = enc
      ? [{ name: 'enc-vol', devicePath: devicePath.trim() || '/dev/encblock' }]
      : undefined;
    // Restricted PodSecurity context for the workload + evidence sidecar (not the
    // LUKS init container, which needs privileges to open the device). runAsNonRoot
    // is included only when the user kept it enabled — root images need it off.
    const securityContext = {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      seccompProfile: { type: 'RuntimeDefault' },
      ...(runAsNonRoot ? { runAsNonRoot: true } : {}),
    };
    const container = {
      name: name.trim(),
      image: image.trim(),
      ...(cmd ? { command: cmd } : {}),
      ...(encVolumeDevices ? { volumeDevices: encVolumeDevices } : {}),
      securityContext,
    };
    const annotations = initdataValue ? { [CC_INIT_DATA_ANNOTATION]: initdataValue } : undefined;

    // luks-setup must open/format the LUKS device on /dev/encblock using the
    // passphrase resolved from PASSPHRASE_SOURCE (a Trustee kbs:/// reference
    // delivered after attestation, or a mounted Kubernetes Secret).
    const initContainers = enc
      ? [
          {
            name: 'luks-setup',
            image: helperImage.trim() || LUKS_HELPER_PLACEHOLDER,
            volumeDevices: encVolumeDevices,
            env: [{ name: 'PASSPHRASE_SOURCE', value: passphraseSource.trim() }],
          },
        ]
      : undefined;
    const volumes = enc
      ? [{ name: 'enc-vol', persistentVolumeClaim: { claimName: effectivePvcName.trim() } }]
      : undefined;

    // The attestation evidence sidecar is a *declared* container (not `oc exec`,
    // which secure CoCo workloads forbid), so it runs inside the same TEE as the
    // workload and continuously proves attestation, publishing evidence to a
    // ConfigMap the Trustee plugin reads. All user values flow in via env so the
    // SIDECAR_SCRIPT can be a constant with literal bash `${VAR}` references.
    const podName = name.trim();
    const evidenceContainer = evidenceSidecar
      ? {
          name: 'attestation-evidence',
          image: EVIDENCE_SIDECAR_IMAGE,
          command: ['bash', '-c', SIDECAR_SCRIPT],
          securityContext,
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '50m', memory: '64Mi' },
          },
          env: [
            { name: 'POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
            { name: 'POD_NS', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
            { name: 'POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } },
            { name: 'NODE_NAME', valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } } },
            { name: 'RUNTIME', value: runtimeClass },
            { name: 'HAS_INITDATA', value: initdataValue ? 'true' : 'false' },
            { name: 'CDH_PATH', value: evidenceCdhPath.trim() || 'default/kbsres1/key1' },
            { name: 'INTERVAL', value: evidenceInterval.trim() || '60' },
            { name: 'CM_NAME', value: evidenceCmName(podName) },
            { name: 'KBS_ENDPOINT', value: kbsEndpoint },
          ],
        }
      : undefined;

    const podSpec = {
      runtimeClassName: runtimeClass,
      ...(evidenceContainer ? { serviceAccountName: evidenceRbacName(podName) } : {}),
      containers: evidenceContainer ? [container, evidenceContainer] : [container],
      ...(initContainers ? { initContainers } : {}),
      ...(volumes ? { volumes } : {}),
    };

    if (kind === 'Pod') {
      return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: name.trim(),
          namespace: nsTrimmed,
          labels: { app: name.trim() },
          ...(annotations ? { annotations } : {}),
        },
        spec: podSpec,
      } as K8sResourceCommon;
    }
    return {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: name.trim(), namespace: nsTrimmed },
      spec: {
        replicas: Number(replicas) || 1,
        selector: { matchLabels: { app: name.trim() } },
        template: {
          metadata: { labels: { app: name.trim() }, ...(annotations ? { annotations } : {}) },
          spec: podSpec,
        },
      },
    } as K8sResourceCommon;
  };

  const trimmedInitdata = initdata.trim();
  const previewInitdata =
    trimmedInitdata.length > 80
      ? `${trimmedInitdata.slice(0, 80)}… (${trimmedInitdata.length} chars)`
      : trimmedInitdata;
  const workloadPreview = JSON.stringify(buildManifest(previewInitdata), null, 2);
  // Show every additional object that gets created above the workload (PVC for the
  // LUKS volume, ServiceAccount/Role/RoleBinding for the evidence sidecar), so the
  // preview matches exactly what create() applies.
  const preview = [
    ...(enc ? [JSON.stringify(buildPvc(), null, 2)] : []),
    ...(evidenceSidecar ? buildEvidenceRbac().map((r) => JSON.stringify(r, null, 2)) : []),
    workloadPreview,
  ].join('\n---\n');

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // 1) Create the namespace first if the chosen one doesn't already exist.
      if (!namespaceExists) {
        await k8sCreate({
          model: NamespaceModel,
          data: {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: { name: nsTrimmed },
          } as K8sResourceCommon,
        });
      }
      // 2) Provision RBAC for the evidence sidecar before the workload that uses
      //    it: a dedicated ServiceAccount plus a tightly-scoped Role (write the
      //    evidence ConfigMap, read its own Pod) and a RoleBinding. Idempotent —
      //    re-creating a workload of the same name swallows AlreadyExists.
      if (evidenceSidecar) {
        const [sa, role, roleBinding] = buildEvidenceRbac();
        const createIdempotent = async (
          model: typeof ServiceAccountModel,
          data: K8sResourceCommon,
        ) => {
          try {
            await k8sCreate({ model, data });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!/already exists/i.test(msg)) throw e;
          }
        };
        await createIdempotent(ServiceAccountModel, sa);
        await createIdempotent(RoleModel, role);
        await createIdempotent(RoleBindingModel, roleBinding);
      }
      // 3) Create the encrypted PVC before the workload that consumes it.
      if (enc) {
        await k8sCreate({ model: PersistentVolumeClaimModel, data: buildPvc() });
      }
      // 4) Create the workload.
      await k8sCreate({
        model: kind === 'Pod' ? PodModel : DeploymentModel,
        data: buildManifest(trimmedInitdata),
      });
      navigate('/confidential-containers/workloads');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DocumentTitle>{t('Create confidential workload')}</DocumentTitle>
      <ListPageHeader title={t('Create confidential workload')} />
      <PageSection>
        <Grid hasGutter>
          <GridItem md={6}>
            <Card>
              <CardTitle>{t('Workload')}</CardTitle>
              <CardBody>
                <Form>
                  <FormGroup label={t('Kind')} fieldId="cw-kind">
                    <FormSelect
                      id="cw-kind"
                      value={kind}
                      onChange={(_e, v) => {
                        setKind(v as Kind);
                      }}
                    >
                      <FormSelectOption value="Pod" label="Pod" />
                      <FormSelectOption value="Deployment" label="Deployment" />
                    </FormSelect>
                  </FormGroup>
                  <FormGroup label={t('Name')} isRequired fieldId="cw-name">
                    <TextInput
                      id="cw-name"
                      value={name}
                      onChange={(_e, v) => {
                        setName(v);
                      }}
                    />
                  </FormGroup>
                  <FormGroup label={t('Namespace')} isRequired fieldId="cw-namespace">
                    <Select
                      isOpen={nsOpen}
                      selected={namespaceExists ? nsTrimmed : undefined}
                      onSelect={(_e, value) => {
                        if (value === CREATE_NS_SENTINEL) {
                          selectNamespace(nsTypedValue);
                        } else if (typeof value === 'string') {
                          selectNamespace(value);
                        }
                      }}
                      onOpenChange={(isOpen) => {
                        setNsOpen(isOpen);
                      }}
                      toggle={(toggleRef: Ref<MenuToggleElement>) => (
                        <MenuToggle
                          variant="typeahead"
                          aria-label={t('Namespace')}
                          ref={toggleRef}
                          isExpanded={nsOpen}
                          isFullWidth
                          onClick={() => {
                            setNsOpen(!nsOpen);
                          }}
                        >
                          <TextInputGroup isPlain>
                            <TextInputGroupMain
                              id="cw-namespace"
                              value={nsInput}
                              innerRef={nsToggleRef}
                              placeholder={t('Select or enter a namespace')}
                              role="combobox"
                              isExpanded={nsOpen}
                              aria-controls="cw-namespace-listbox"
                              onClick={() => {
                                setNsOpen(!nsOpen);
                              }}
                              onChange={(_e, v) => {
                                setNsInput(v);
                                setNamespace(v);
                                if (!nsOpen) setNsOpen(true);
                              }}
                            />
                          </TextInputGroup>
                        </MenuToggle>
                      )}
                    >
                      <SelectList id="cw-namespace-listbox">
                        {filteredNs.map((ns) => (
                          <SelectOption key={ns} value={ns}>
                            {ns}
                          </SelectOption>
                        ))}
                        {showCreateNsOption && (
                          <SelectOption key="__create__" value={CREATE_NS_SENTINEL}>
                            {t('Create new namespace: {{name}}', { name: nsTypedValue })}
                          </SelectOption>
                        )}
                        {filteredNs.length === 0 && !showCreateNsOption && (
                          <SelectOption isDisabled value="__none__">
                            {t('No namespaces found')}
                          </SelectOption>
                        )}
                      </SelectList>
                    </Select>
                    {nsTrimmed !== '' && !namespaceExists && (
                      <HelperText>
                        <HelperTextItem variant="warning">
                          {t('Namespace {{name}} does not exist yet and will be created.', {
                            name: nsTrimmed,
                          })}
                        </HelperTextItem>
                      </HelperText>
                    )}
                  </FormGroup>
                  <FormGroup label={t('Image')} isRequired fieldId="cw-image">
                    <TextInput
                      id="cw-image"
                      value={image}
                      onChange={(_e, v) => {
                        setImage(v);
                      }}
                    />
                  </FormGroup>
                  <FormGroup label={t('Runtime class')} fieldId="cw-rc">
                    <FormSelect
                      id="cw-rc"
                      value={runtimeClass}
                      onChange={(_e, v) => {
                        setRuntimeClass(v as RuntimeClass);
                      }}
                    >
                      <FormSelectOption value="kata-cc" label="kata-cc" />
                      <FormSelectOption value="kata-cc-nvidia-gpu" label="kata-cc-nvidia-gpu" />
                    </FormSelect>
                  </FormGroup>
                  {runtimeClass === 'kata-cc-nvidia-gpu' && (
                    <Alert
                      variant="info"
                      isInline
                      title={t('Confidential GPU prerequisites (Tech Preview)')}
                      className="coco-openshift-console-plugin__mb"
                    >
                      <p className="coco-openshift-console-plugin__mb">
                        {t(
                          'The kata-cc-nvidia-gpu runtime needs the GPU stack enabled on your TEE nodes first (NVIDIA H100, bare metal only):',
                        )}
                      </p>
                      <ul className="coco-openshift-console-plugin__mb">
                        <li>
                          {t(
                            'An IOMMU MachineConfig (intel_iommu=on / amd_iommu=on) — reboots nodes.',
                          )}
                        </li>
                        <li>
                          {t(
                            'The NVIDIA GPU Operator with a ClusterPolicy enabling ccManager (CC mode on), the kata sandbox device plugin, and vfio-manager.',
                          )}
                        </li>
                        <li>
                          {t(
                            'Nodes labeled nvidia.com/cc.mode.state=on, nvidia.com/cc.ready.state=true, and a TEE label.',
                          )}
                        </li>
                      </ul>
                      <a
                        href="https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/index.html"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('NVIDIA GPU Operator documentation')}
                      </a>
                    </Alert>
                  )}
                  {kind === 'Deployment' && (
                    <FormGroup label={t('Replicas')} fieldId="cw-replicas">
                      <TextInput
                        id="cw-replicas"
                        type="number"
                        value={replicas}
                        onChange={(_e, v) => {
                          setReplicas(v);
                        }}
                      />
                    </FormGroup>
                  )}
                  <FormGroup label={t('Command (optional)')} fieldId="cw-command">
                    <TextInput
                      id="cw-command"
                      value={command}
                      onChange={(_e, v) => {
                        setCommand(v);
                      }}
                    />
                  </FormGroup>
                  <FormGroup
                    label={t('Initdata (cc_init_data annotation)')}
                    isRequired
                    fieldId="cw-initdata"
                  >
                    <TextArea
                      id="cw-initdata"
                      value={initdata}
                      onChange={(_e, v) => {
                        setInitdata(v);
                      }}
                      rows={4}
                      placeholder={t('Paste the gzip+base64 value.')}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'Paste the initdata your Trustee admin shared with you — the cc_init_data value they generated on the Trustee, whether it runs in this cluster or a remote one. Without it the workload cannot attest.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>

                  <FormGroup fieldId="cw-enc">
                    <Checkbox
                      id="cw-enc"
                      label={t('Add an encrypted block volume (LUKS)')}
                      description={t(
                        'Attach a raw-block PVC that an init container opens with LUKS inside the TEE, using a passphrase Trustee delivers only after attestation.',
                      )}
                      isChecked={enc}
                      onChange={(_e, checked) => {
                        setEnc(checked);
                      }}
                    />
                  </FormGroup>
                  {enc && (
                    <>
                      <FormGroup label={t('PVC name')} isRequired fieldId="cw-pvc-name">
                        <TextInput
                          id="cw-pvc-name"
                          value={effectivePvcName}
                          onChange={(_e, v) => {
                            setPvcNameTouched(true);
                            setPvcName(v);
                          }}
                        />
                      </FormGroup>
                      <FormGroup label={t('Size')} isRequired fieldId="cw-pvc-size">
                        <TextInput
                          id="cw-pvc-size"
                          value={pvcSize}
                          onChange={(_e, v) => {
                            setPvcSize(v);
                          }}
                        />
                      </FormGroup>
                      <FormGroup label={t('Storage class')} fieldId="cw-pvc-sc">
                        <Select
                          isOpen={scOpen}
                          selected={effectiveSc}
                          onSelect={(_e, value) => {
                            setScTouched(true);
                            setStorageClass(typeof value === 'string' ? value : '');
                            setScOpen(false);
                          }}
                          onOpenChange={(isOpen) => {
                            setScOpen(isOpen);
                          }}
                          toggle={(toggleRef: Ref<MenuToggleElement>) => (
                            <MenuToggle
                              id="cw-pvc-sc"
                              ref={toggleRef}
                              isExpanded={scOpen}
                              isFullWidth
                              onClick={() => {
                                setScOpen(!scOpen);
                              }}
                            >
                              {effectiveSc || t('Use cluster default')}
                            </MenuToggle>
                          )}
                        >
                          <SelectList>
                            {scNames.length === 0 ? (
                              <SelectOption isDisabled value="__none__">
                                {t('No storage classes found')}
                              </SelectOption>
                            ) : (
                              scNames.map((sc) => (
                                <SelectOption key={sc} value={sc}>
                                  {sc === defaultSc ? t('{{name}} (default)', { name: sc }) : sc}
                                </SelectOption>
                              ))
                            )}
                          </SelectList>
                        </Select>
                      </FormGroup>
                      <FormGroup label={t('Device path')} fieldId="cw-device-path">
                        <TextInput
                          id="cw-device-path"
                          value={devicePath}
                          onChange={(_e, v) => {
                            setDevicePath(v);
                          }}
                        />
                      </FormGroup>
                      <FormGroup label={t('Passphrase source')} fieldId="cw-passphrase">
                        <TextInput
                          id="cw-passphrase"
                          value={passphraseSource}
                          onChange={(_e, v) => {
                            setPassphraseSource(v);
                          }}
                        />
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'A Trustee-delivered passphrase reference like kbs:///default/luks/passphrase, or a Kubernetes Secret name.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormGroup>
                      <FormGroup label={t('LUKS helper image')} fieldId="cw-helper-image">
                        <TextInput
                          id="cw-helper-image"
                          value={helperImage}
                          placeholder={LUKS_HELPER_PLACEHOLDER}
                          onChange={(_e, v) => {
                            setHelperImage(v);
                          }}
                        />
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Image whose init container opens the LUKS device with the passphrase on boot — see the OpenShift sandboxed containers LUKS-in-TEE docs.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormGroup>
                    </>
                  )}

                  <FormGroup fieldId="cw-evidence">
                    <Checkbox
                      id="cw-evidence"
                      label={t(
                        'Add attestation evidence sidecar (self-reporting, no exec required)',
                      )}
                      description={t(
                        'Run a declared container inside the TEE that continuously fetches a KBS resource to prove attestation and publishes a timestamped evidence record the Trustee plugin reads.',
                      )}
                      isChecked={evidenceSidecar}
                      onChange={(_e, checked) => {
                        setEvidenceSidecar(checked);
                      }}
                    />
                  </FormGroup>
                  {evidenceSidecar && (
                    <>
                      <Alert
                        variant="info"
                        isInline
                        title={t('How the evidence sidecar works')}
                        className="coco-openshift-console-plugin__mb"
                      >
                        <p className="coco-openshift-console-plugin__mb">
                          {t(
                            'The sidecar runs inside the TEE as a declared container — not via oc exec, which secure confidential workloads forbid. It proves attestation by fetching a KBS resource through the Confidential Data Hub (the resource is only released after a successful attestation) and pushes a timestamped evidence record to a ConfigMap.',
                          )}
                        </p>
                        <p className="coco-openshift-console-plugin__mb">
                          {t(
                            'It uses a tiny ubi-minimal image and pushes the evidence to the Kubernetes API with curl (no oc, no python), so it fits inside the confidential guest VM.',
                          )}
                        </p>
                        <p>
                          {t(
                            'The sidecar publishes that record as a ConfigMap the Trustee plugin reads in its Attestation status view. It must be present at pod creation; it cannot be added to a running pod.',
                          )}
                        </p>
                      </Alert>
                      <FormGroup label={t('CDH resource path')} fieldId="cw-evidence-cdh">
                        <TextInput
                          id="cw-evidence-cdh"
                          value={evidenceCdhPath}
                          onChange={(_e, v) => {
                            setEvidenceCdhPath(v);
                          }}
                        />
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'A KBS resource the guest fetches as proof it attested — released only after a successful attestation. Use the full path <repository>/<name>/<key>, e.g. default/kbsres1/key1. A two-segment path like default/kbsres1 is a folder, not a resource, and returns 404.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormGroup>
                      <FormGroup
                        label={t('Refresh interval seconds')}
                        fieldId="cw-evidence-interval"
                      >
                        <TextInput
                          id="cw-evidence-interval"
                          type="number"
                          value={evidenceInterval}
                          onChange={(_e, v) => {
                            setEvidenceInterval(v);
                          }}
                        />
                      </FormGroup>
                    </>
                  )}

                  <FormGroup fieldId="cw-nonroot">
                    <Checkbox
                      id="cw-nonroot"
                      label={t('Run as non-root')}
                      description={t(
                        'Adds runAsNonRoot: true so the pod meets the restricted Pod Security Standard (allowPrivilegeEscalation: false, dropped capabilities, and the RuntimeDefault seccomp profile are always set). Untick only if your image must run as root.',
                      )}
                      isChecked={runAsNonRoot}
                      onChange={(_e, checked) => {
                        setRunAsNonRoot(checked);
                      }}
                    />
                  </FormGroup>

                  {error && (
                    <Alert variant="danger" isInline title={t('Could not create workload')}>
                      {error}
                    </Alert>
                  )}

                  <ActionGroup>
                    <Button
                      variant="primary"
                      onClick={() => void create()}
                      isLoading={busy}
                      isDisabled={busy || !valid}
                    >
                      {t('Create')}
                    </Button>
                    <Button
                      variant="link"
                      onClick={() => {
                        navigate('/confidential-containers/workloads');
                      }}
                    >
                      {t('Cancel')}
                    </Button>
                  </ActionGroup>
                </Form>
              </CardBody>
            </Card>
          </GridItem>

          <GridItem md={6}>
            <Card>
              <CardTitle>{t('Manifest preview')}</CardTitle>
              <CardBody>
                <CodeBlock>
                  <CodeBlockCode>{preview}</CodeBlockCode>
                </CodeBlock>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default CreateConfidentialWorkload;
