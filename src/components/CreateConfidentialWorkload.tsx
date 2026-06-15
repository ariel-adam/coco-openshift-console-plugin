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
import { Link, useNavigate } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import {
  CC_INIT_DATA_ANNOTATION,
  DeploymentModel,
  NamespaceGVK,
  NamespaceModel,
  PersistentVolumeClaimModel,
  PodModel,
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
  const [namespaces] = useK8sWatchResource<NamespaceKind[]>({
    groupVersionKind: NamespaceGVK,
    isList: true,
  });
  const nsNames = useMemo(
    () =>
      [
        ...new Set((namespaces ?? []).map((n) => n.metadata?.name).filter(Boolean) as string[]),
      ].sort((a, b) => a.localeCompare(b)),
    [namespaces],
  );
  const [nsOpen, setNsOpen] = useState(false);
  // What the user has typed into the combobox input (drives filtering + creatable option).
  const [nsInput, setNsInput] = useState(namespace);
  const nsToggleRef = useRef<MenuToggleElement>(null);
  const nsTrimmed = namespace.trim();
  const namespaceExists = nsNames.includes(nsTrimmed);
  const nsFilter = nsInput.trim().toLowerCase();
  const filteredNs = nsFilter ? nsNames.filter((n) => n.toLowerCase().includes(nsFilter)) : nsNames;
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
  const pvcNameTouched = useRef(false);
  const scTouched = useRef(false);

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
  const effectiveSc = scTouched.current ? storageClass : storageClass || defaultSc;
  // Default the PVC name from the workload name until the user overrides it.
  const effectivePvcName = pvcNameTouched.current ? pvcName : pvcName || `${name.trim()}-enc`;

  const valid =
    name.trim() !== '' &&
    nsTrimmed !== '' &&
    image.trim() !== '' &&
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

  const buildManifest = (initdataValue: string): K8sResourceCommon => {
    const cmd = command.trim() ? command.trim().split(/\s+/) : undefined;
    // When an encrypted volume is requested, the main container mounts it as a raw
    // block device and an init container opens (and on first use formats) the LUKS
    // device using the passphrase before the app container starts.
    const encVolumeDevices = enc
      ? [{ name: 'enc-vol', devicePath: devicePath.trim() || '/dev/encblock' }]
      : undefined;
    const container = {
      name: name.trim(),
      image: image.trim(),
      ...(cmd ? { command: cmd } : {}),
      ...(encVolumeDevices ? { volumeDevices: encVolumeDevices } : {}),
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

    const podSpec = {
      runtimeClassName: runtimeClass,
      containers: [container],
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
  // Show the PVC manifest above the workload so the user sees everything that gets created.
  const preview = enc
    ? `${JSON.stringify(buildPvc(), null, 2)}\n---\n${workloadPreview}`
    : workloadPreview;

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
      // 2) Create the encrypted PVC before the workload that consumes it.
      if (enc) {
        await k8sCreate({ model: PersistentVolumeClaimModel, data: buildPvc() });
      }
      // 3) Create the workload.
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
                    label={t('Initdata annotation value (optional)')}
                    fieldId="cw-initdata"
                  >
                    <TextArea
                      id="cw-initdata"
                      value={initdata}
                      onChange={(_e, v) => {
                        setInitdata(v);
                      }}
                      rows={4}
                      placeholder={t('Paste the gzip+base64 value, or generate it first.')}
                    />
                    <p className="coco-openshift-console-plugin__mt">
                      <Link to="/confidential-containers/initdata">
                        {t('Open the initdata builder')}
                      </Link>
                    </p>
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
                            pvcNameTouched.current = true;
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
                            scTouched.current = true;
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
