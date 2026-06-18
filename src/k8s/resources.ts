import type { K8sGroupVersionKind, K8sModel } from '@openshift-console/dynamic-plugin-sdk';

// ---------------------------------------------------------------------------
// Confidential Containers (workload cluster) — shares the OSC/Kata data model.
// CoCo is OpenShift sandboxed containers + a TEE: the kata-cc runtime class plus
// per-pod initdata. We reuse the same KataConfig/RuntimeClass objects osc-openshift-console-plugin
// watches and narrow to the confidential runtimes.
// ---------------------------------------------------------------------------
export const RuntimeClassGVK: K8sGroupVersionKind = {
  group: 'node.k8s.io',
  version: 'v1',
  kind: 'RuntimeClass',
};

export const KataConfigGVK: K8sGroupVersionKind = {
  group: 'kataconfiguration.openshift.io',
  version: 'v1',
  kind: 'KataConfig',
};

/** Create-capable model for the cluster-scoped KataConfig singleton. */
export const KataConfigModel: K8sModel = {
  apiGroup: 'kataconfiguration.openshift.io',
  apiVersion: 'v1',
  kind: 'KataConfig',
  plural: 'kataconfigs',
  namespaced: false,
  abbr: 'KC',
  label: 'KataConfig',
  labelPlural: 'KataConfigs',
  crd: true,
};

/** nfd.openshift.io/v1alpha1 NodeFeatureRule — labels nodes with detected TEEs. */
export const NodeFeatureRuleGVK: K8sGroupVersionKind = {
  group: 'nfd.openshift.io',
  version: 'v1alpha1',
  kind: 'NodeFeatureRule',
};

/** nfd.openshift.io/v1 NodeFeatureDiscovery — the NFD operand that scans nodes. */
export const NodeFeatureDiscoveryGVK: K8sGroupVersionKind = {
  group: 'nfd.openshift.io',
  version: 'v1',
  kind: 'NodeFeatureDiscovery',
};

/** config.openshift.io/v1 ClusterVersion — used to derive the NFD operand image tag. */
export const ClusterVersionGVK: K8sGroupVersionKind = {
  group: 'config.openshift.io',
  version: 'v1',
  kind: 'ClusterVersion',
};

/** config.openshift.io/v1 Infrastructure — read status.infrastructureName for the cluster name. */
export const InfrastructureGVK: K8sGroupVersionKind = {
  group: 'config.openshift.io',
  version: 'v1',
  kind: 'Infrastructure',
};

/** machineconfiguration.openshift.io/v1 MachineConfig — sets host kernel arguments. */
export const MachineConfigGVK: K8sGroupVersionKind = {
  group: 'machineconfiguration.openshift.io',
  version: 'v1',
  kind: 'MachineConfig',
};

/**
 * machineconfiguration.openshift.io/v1 MachineConfigPool — watched to track the
 * rolling reboot a TDX-host MachineConfig triggers (Updating → Updated) instead of
 * declaring success the moment the CR is created.
 */
export const MachineConfigPoolGVK: K8sGroupVersionKind = {
  group: 'machineconfiguration.openshift.io',
  version: 'v1',
  kind: 'MachineConfigPool',
};

export const NodeFeatureRuleModel: K8sModel = {
  apiGroup: 'nfd.openshift.io',
  apiVersion: 'v1alpha1',
  kind: 'NodeFeatureRule',
  plural: 'nodefeaturerules',
  namespaced: true,
  abbr: 'NFR',
  label: 'NodeFeatureRule',
  labelPlural: 'NodeFeatureRules',
  crd: true,
};

export const NodeFeatureDiscoveryModel: K8sModel = {
  apiGroup: 'nfd.openshift.io',
  apiVersion: 'v1',
  kind: 'NodeFeatureDiscovery',
  plural: 'nodefeaturediscoveries',
  namespaced: true,
  abbr: 'NFD',
  label: 'NodeFeatureDiscovery',
  labelPlural: 'NodeFeatureDiscoveries',
  crd: true,
};

export const MachineConfigModel: K8sModel = {
  apiGroup: 'machineconfiguration.openshift.io',
  apiVersion: 'v1',
  kind: 'MachineConfig',
  plural: 'machineconfigs',
  namespaced: false,
  abbr: 'MC',
  label: 'MachineConfig',
  labelPlural: 'MachineConfigs',
  crd: true,
};

// ---- Core ----
export const PodGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Pod' };
export const DeploymentGVK: K8sGroupVersionKind = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
};
export const DaemonSetGVK: K8sGroupVersionKind = {
  group: 'apps',
  version: 'v1',
  kind: 'DaemonSet',
};
export const JobGVK: K8sGroupVersionKind = { group: 'batch', version: 'v1', kind: 'Job' };
export const ServiceGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Service' };
export const ConfigMapGVK: K8sGroupVersionKind = { version: 'v1', kind: 'ConfigMap' };
export const SecretGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Secret' };
export const EventGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Event' };
export const NodeGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Node' };
export const NamespaceGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Namespace' };
/** project.openshift.io/v1 Project — the RBAC-aware list of namespaces a user can see. */
export const ProjectGVK: K8sGroupVersionKind = {
  group: 'project.openshift.io',
  version: 'v1',
  kind: 'Project',
};
export const PersistentVolumeClaimGVK: K8sGroupVersionKind = {
  version: 'v1',
  kind: 'PersistentVolumeClaim',
};
export const StorageClassGVK: K8sGroupVersionKind = {
  group: 'storage.k8s.io',
  version: 'v1',
  kind: 'StorageClass',
};

/** Minimal K8sModels for create/delete via k8sCreate / k8sDelete. */
export const NamespaceModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'Namespace',
  plural: 'namespaces',
  namespaced: false,
  abbr: 'NS',
  label: 'Namespace',
  labelPlural: 'Namespaces',
};

export const PersistentVolumeClaimModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'PersistentVolumeClaim',
  plural: 'persistentvolumeclaims',
  namespaced: true,
  abbr: 'PVC',
  label: 'PersistentVolumeClaim',
  labelPlural: 'PersistentVolumeClaims',
};

export const PodModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'Pod',
  plural: 'pods',
  namespaced: true,
  abbr: 'P',
  label: 'Pod',
  labelPlural: 'Pods',
};

export const DeploymentModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'apps',
  kind: 'Deployment',
  plural: 'deployments',
  namespaced: true,
  abbr: 'D',
  label: 'Deployment',
  labelPlural: 'Deployments',
};

export const ConfigMapModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  plural: 'configmaps',
  namespaced: true,
  abbr: 'CM',
  label: 'ConfigMap',
  labelPlural: 'ConfigMaps',
};

export const SecretModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'Secret',
  plural: 'secrets',
  namespaced: true,
  abbr: 'S',
  label: 'Secret',
  labelPlural: 'Secrets',
};

/** batch/v1 Job — used to run in-cluster setup scripts (e.g. TDX attestation infra). */
export const JobModel: K8sModel = {
  apiGroup: 'batch',
  apiVersion: 'v1',
  kind: 'Job',
  plural: 'jobs',
  namespaced: true,
  abbr: 'J',
  label: 'Job',
  labelPlural: 'Jobs',
};

// ---- RBAC for the attestation evidence sidecar ----
// The evidence sidecar runs as its own ServiceAccount and needs a small Role
// (write the evidence ConfigMap, read its own Pod) bound to that SA.
export const ServiceAccountModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'ServiceAccount',
  plural: 'serviceaccounts',
  namespaced: true,
  abbr: 'SA',
  label: 'ServiceAccount',
  labelPlural: 'ServiceAccounts',
};

export const RoleModel: K8sModel = {
  apiGroup: 'rbac.authorization.k8s.io',
  apiVersion: 'v1',
  kind: 'Role',
  plural: 'roles',
  namespaced: true,
  abbr: 'R',
  label: 'Role',
  labelPlural: 'Roles',
};

export const RoleBindingModel: K8sModel = {
  apiGroup: 'rbac.authorization.k8s.io',
  apiVersion: 'v1',
  kind: 'RoleBinding',
  plural: 'rolebindings',
  namespaced: true,
  abbr: 'RB',
  label: 'RoleBinding',
  labelPlural: 'RoleBindings',
};

/** Cluster-scoped binding — the TDX attestation setup Job runs as cluster-admin. */
export const ClusterRoleBindingModel: K8sModel = {
  apiGroup: 'rbac.authorization.k8s.io',
  apiVersion: 'v1',
  kind: 'ClusterRoleBinding',
  plural: 'clusterrolebindings',
  namespaced: false,
  abbr: 'CRB',
  label: 'ClusterRoleBinding',
  labelPlural: 'ClusterRoleBindings',
};

// ---- Well-known names / locations ----
/** Where the OpenShift sandboxed containers operator and its config live. */
export const OSC_NAMESPACE = 'openshift-sandboxed-containers-operator';
/**
 * Configuration ConfigMap that enables confidential containers (data.confidential: "true"),
 * which makes the OSC operator install the kata-cc runtime. The ConfigMap keeps the name
 * "osc-feature-gates" for historical reasons; OSC now calls these "configuration options",
 * not "feature gates" — confidential containers is a supported (GA) option.
 */
export const OSC_FEATURE_GATES_CM = 'osc-feature-gates';
export const KATACONFIG_NAME = 'example-kataconfig';
/** Pod annotation carrying the gzip+base64 initdata for a confidential pod. */
export const CC_INIT_DATA_ANNOTATION = 'io.katacontainers.config.hypervisor.cc_init_data';

/**
 * The Trustee Key Broker Service in-cluster Service name + port. The attestation
 * topology decodes each workload's initdata KBS URL and compares its host against
 * `kbs-service.<ns>` to tell an in-cluster (co-located) Trustee from a remote one
 * (hub-and-spoke). CoCo itself never deploys Trustee — this is only for classification.
 */
export const KBS_SERVICE_NAME = 'kbs-service';
export const KBS_SERVICE_PORT = 8080;

// ---- Cross-plugin ConfigMap contracts (CoCo ⇄ Trustee) ----
// CoCo and Trustee ship in two independently-versioned operators but exchange data
// through two label-selected ConfigMap conventions. To guard against operator skew,
// each plugin stamps a `schema` data field with this shared version and tolerates a
// missing/older value when reading. Bump only on a breaking shape change.
/** Shared schema/version stamped on the cross-plugin ConfigMaps. */
export const SHARED_CONFIGMAP_SCHEMA_VERSION = '1';
/** Data key carrying the schema/version on a cross-plugin ConfigMap. */
export const SHARED_CONFIGMAP_SCHEMA_KEY = 'schema';

/**
 * Initdata-sharing contract (Trustee writes, CoCo optionally reads on the SAME
 * cluster). Trustee labels a `<tc>-shared-initdata` ConfigMap with this label and
 * puts the ready-to-paste `cc_init_data` value (plus the KBS URL and PCR8) in its
 * data. CoCo's create form offers these as an optional initdata source when one is
 * present in the selected namespace — never required, because the attestation
 * service is commonly on another cluster (hub-spoke) or not Trustee at all.
 */
export const SHARED_INITDATA_LABEL = 'trustee.attestation/shared-initdata';
/** Data key on a shared-initdata ConfigMap holding the gzip+base64 cc_init_data value. */
export const SHARED_INITDATA_DATA_KEY = 'cc_init_data';
/** Data key on a shared-initdata ConfigMap holding the KBS URL (for display only). */
export const SHARED_INITDATA_KBS_URL_KEY = 'kbs-url';

/**
 * Evidence contract (CoCo's in-guest sidecar writes, Trustee reads). The sidecar
 * server-side-applies an `attestation-evidence-*` ConfigMap labeled with this label;
 * Trustee reads it by selector in its Attestation status view. Defined here so the
 * GVK/label live next to the initdata contract; the sidecar script and the
 * evidence-reader (`utils/evidence.ts`) use the same literal.
 */
export const EVIDENCE_LABEL = 'trustee.attestation/evidence';

/**
 * coco-tools image — ships bash, oc, curl, and python3. Kept for tooling that
 * needs the full client set; NOT used by the attestation evidence sidecar (it is
 * too large to unpack inside a confidential kata-cc guest VM — see
 * EVIDENCE_SIDECAR_IMAGE).
 */
export const COCO_TOOLS_IMAGE = 'quay.io/openshift_sandboxed_containers/coco-tools:1.12';

/**
 * Tiny image for the in-guest attestation evidence sidecar. ubi-minimal ships
 * curl + bash + sed + coreutils (~40MB), which fits inside the confidential
 * kata-cc guest VM; the heavier COCO_TOOLS_IMAGE (oc + python3) cannot unpack
 * there and fails with "No space left on device". The sidecar pushes the
 * evidence ConfigMap straight to the Kubernetes API with curl — no oc, no python.
 */
export const EVIDENCE_SIDECAR_IMAGE = 'registry.access.redhat.com/ubi9/ubi-minimal:latest';

/**
 * Full UBI9 (not ubi-minimal) — ships openssl, curl, base64, sha512sum, sed and
 * bash. Used as the runner for the TDX attestation setup Job (which needs openssl
 * to mint the throwaway PCCS TLS cert). Public, no pull secret required.
 */
export const UBI9_IMAGE = 'registry.access.redhat.com/ubi9/ubi:latest';

/**
 * In-cluster OpenShift CLI image — always present, version-matched to the cluster,
 * pullable from any namespace with no pull secret. An initContainer copies its `oc`
 * binary into a shared volume so the UBI9 runner can drive `oc`/`oc adm`.
 */
export const OC_CLI_IMAGE = 'image-registry.openshift-image-registry.svc:5000/openshift/cli:latest';

// ---- Intel TDX remote attestation (Intel DCAP: PCCS + QGS) ----
// Mirrors "Deploying confidential containers on bare-metal servers" §3.2,
// "Deploying Intel TDX remote attestation".
/** Namespace that holds the Intel DCAP remote-attestation infrastructure. */
export const INTEL_DCAP_NAMESPACE = 'intel-dcap';
/**
 * sandboxed-containers-operator release tag whose install-helpers carry the pinned
 * PCCS/QGS manifests. Matches OSC 1.12 (the version the bare-metal CoCo doc targets).
 */
export const OSC_DCAP_HELPERS_TAG = 'v1.12.0';
/** Raw base URL for the pinned intel-dcap install helpers (pccs.yaml.in, qgs.yaml). */
export const oscDcapHelpersBase = (tag: string = OSC_DCAP_HELPERS_TAG): string =>
  `https://raw.githubusercontent.com/openshift/sandboxed-containers-operator/refs/tags/${tag}/scripts/install-helpers/baremetal-coco/intel-dcap`;
/** Intel Trusted Services API portal — where the operator subscribes for the PCS API key. */
export const INTEL_PCS_PORTAL_URL = 'https://api.portal.trustedservices.intel.com';

// ---- Intel SGX device plugin (prereq for TDX quote generation) ----
// TDX quotes are signed by an SGX quoting enclave, so the QGS requests
// sgx.intel.com/enclave + /provision — advertised by the Intel SGX device plugin.
export const SgxDevicePluginGVK: K8sGroupVersionKind = {
  group: 'deviceplugin.intel.com',
  version: 'v1',
  kind: 'SgxDevicePlugin',
};
/** Cluster-scoped SgxDevicePlugin CR — deploys the SGX device-plugin DaemonSet. */
export const SgxDevicePluginModel: K8sModel = {
  apiGroup: 'deviceplugin.intel.com',
  apiVersion: 'v1',
  kind: 'SgxDevicePlugin',
  plural: 'sgxdeviceplugins',
  namespaced: false,
  abbr: 'SGX',
  label: 'SgxDevicePlugin',
  labelPlural: 'SgxDevicePlugins',
  crd: true,
};
export const SubscriptionModel: K8sModel = {
  apiGroup: 'operators.coreos.com',
  apiVersion: 'v1alpha1',
  kind: 'Subscription',
  plural: 'subscriptions',
  namespaced: true,
  abbr: 'SUB',
  label: 'Subscription',
  labelPlural: 'Subscriptions',
  crd: true,
};
/** apiextensions.k8s.io/v1 CustomResourceDefinition — watched to know when the operator is ready. */
export const CustomResourceDefinitionGVK: K8sGroupVersionKind = {
  group: 'apiextensions.k8s.io',
  version: 'v1',
  kind: 'CustomResourceDefinition',
};

export const INTEL_DEVICE_PLUGINS_OPERATOR = 'intel-device-plugins-operator';
export const INTEL_DEVICE_PLUGINS_CHANNEL = 'stable';
export const INTEL_DEVICE_PLUGINS_SOURCE = 'certified-operators';
export const INTEL_DEVICE_PLUGINS_SOURCE_NS = 'openshift-marketplace';
/** AllNamespaces operator — installs into the global operators namespace. */
export const INTEL_DEVICE_PLUGINS_INSTALL_NS = 'openshift-operators';
export const SGX_DEVICEPLUGIN_CRD = 'sgxdeviceplugins.deviceplugin.intel.com';
export const SGX_DEVICEPLUGIN_CR_NAME = 'sgxdeviceplugin';
/** NFD label the SGX device plugin selects on (TDX nodes carry it too). */
export const SGX_NODE_SELECTOR_LABEL = 'intel.feature.node.kubernetes.io/sgx';
/** Endpoints — watched to know when the operator's admission webhook is serving. */
export const EndpointsGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Endpoints' };
/** The operator's webhook service; its endpoints must be populated before the CR applies. */
export const INTEL_DEVICE_PLUGINS_WEBHOOK_SVC = 'intel-deviceplugins-controller-manager-service';

// `kind~group~version` reference string for action/flag extensions.
export const KataConfigModelRef = 'kataconfiguration.openshift.io~v1~KataConfig';
