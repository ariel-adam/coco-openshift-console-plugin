# Confidential Containers — OpenShift Console plugin

> [!WARNING]
> **Unofficial and unsupported.** This is a community/personal project — **not** an official Red Hat
> or OpenShift product, and **not** covered by Red Hat support, subscriptions, or any SLA. It is
> provided **as-is** under the Apache-2.0 license. Validate in a
> non-production environment before use, at your own risk.

`coco-openshift-console-plugin` is an OpenShift Console **dynamic plugin** to **create, configure,
manage, and observe confidential containers** — OpenShift sandboxed containers running inside a
hardware Trusted Execution Environment (Intel TDX / AMD SEV-SNP / NVIDIA confidential GPU) via the
`kata-cc` runtime.

> **Attestation lives in a separate plugin.** Deploying and managing the Red Hat build of Trustee
> (Key Broker Service, attestation/resource policies, reference values, delivered secrets, GPU
> attestation) is handled by **[`trustee-openshift-console-plugin`](https://github.com/makentenza/trustee-openshift-console-plugin)**.
> This plugin owns the *workload* side: it deploys a confidential pod with the `cc_init_data` value the
> attestation service supplies (pasted in, or optionally read from a same-cluster Trustee), and decodes
> that value's KBS URL — but does not deploy, configure, or require Trustee.

It is a **sibling of [`osc-openshift-console-plugin`](https://github.com/makentenza/osc-openshift-console-plugin)**
and shares its stack and conventions. Confidential containers *are* sandboxed containers plus
confidential computing, so this plugin extends the same Kata / runtime-class model with TEE support.

## What it covers

A single **Confidential Containers** admin nav section (gated by `console.flag/model` on `KataConfig`,
`kataconfiguration.openshift.io/v1`), with:

- **Overview** — confidential workloads, TEE-capable nodes, confidential runtime classes, KataConfig
  install state, and workload health at a glance.
- **Setup checklist** — guided path from a fresh cluster to an attested workload: detect TEE nodes →
  enable confidential containers (one-click `osc-feature-gates`) → install the `kata-cc` runtime →
  set up TEE quote generation → run a workload.
- **TEE-capable nodes** — detect/label Intel TDX or AMD SEV-SNP nodes via Node Feature Discovery,
  one-click **enable TEE detection** and **enable the Intel TDX host** (the `nohibernate` +
  `kvm_intel.tdx=1` kernel args, with MachineConfigPool reboot tracking), and confidential-GPU readiness.
- **Runtime classes** — the `kata` / `kata-cc` / `kata-cc-nvidia-gpu` runtime classes and their
  confidential classification.
- **Workloads** — list confidential (kata-cc) workloads, and a guided **Create workload** form
  (`runtimeClassName: kata-cc` + node targeting + the pasted `cc_init_data` annotation, an optional
  encrypted-LUKS volume, and an optional in-guest attestation-evidence sidecar).

> **Initdata is supplied, not built here.** A confidential workload's `cc_init_data` value is produced
> by an **attestation service** (Trustee today) — commonly on a *different* cluster (hub-and-spoke) and
> potentially not Trustee at all — and handed to the workload owner, like a TLS cert or pull secret. The
> Create form therefore *requires a pasted value* and stays topology-/vendor-agnostic. As a convenience,
> when a same-cluster Trustee has shared an initdata ConfigMap (see [Cross-plugin contracts](#cross-plugin-configmap-contracts)),
> the form offers an **optional** picker; manual paste remains the primary path.

## Screenshots

### Overview
![Confidential containers overview](docs/images/05_coco_overview.png)

### Setup
![Confidential containers setup](docs/images/06_coco_setup.png)

### Workloads
![Confidential workloads](docs/images/07_coco_workloads.png)

### Runtime classes
![Confidential runtime classes](docs/images/08_coco_runtimeclasses.png)

### Create confidential workload
![Create confidential workload](docs/images/10_coco_create.png)

## Packaging — two operators total

There is **no CoCo operator.** Confidential containers is a **feature gate of the OpenShift sandboxed
containers (OSC) operator**, not a product of its own: the OSC operator ships **both** the `osc`
(Sandboxes) and `coco` (Confidential Containers) console plugins, and "turning CoCo on" is flipping
`confidential: "true"` on the `osc-feature-gates` ConfigMap. Attestation is the **only** separate
operator — the **Trustee** operator ships the `trustee` plugin. So across all three plugins there are
**two operators**: the OSC operator (osc + coco, confidential is a feature gate) and the Trustee
operator (trustee). The Confidential Containers menu is gated on the `KataConfig` CRD, so it can be
present before `confidential:true` is set — the Overview shows a feature-gate empty-state in that case.

## Cross-plugin ConfigMap contracts

CoCo (shipped by the OSC operator) and Trustee (a separate operator) update on independent release
trains but exchange data through two **label-selected ConfigMap conventions**. Each carries a `schema`
data field stamped with a shared version (`SHARED_CONFIGMAP_SCHEMA_VERSION`, currently `"1"`); readers
**tolerate a missing/older value** to survive operator skew. Constants live in
[`src/k8s/resources.ts`](src/k8s/resources.ts).

| Contract | Label | Direction | Key data | Notes |
|---|---|---|---|---|
| **Shared initdata** | `trustee.attestation/shared-initdata: "true"` | Trustee **writes**, CoCo **optionally reads (same cluster only)** | `cc_init_data`, `kbs-url`, `pcr8`, `schema` | CoCo's Create form offers these as an optional picker in the selected namespace. Never required — the attestation service is usually on another cluster (hub-spoke) or not Trustee. |
| **Evidence** | `trustee.attestation/evidence: "true"` | CoCo's in-guest sidecar **writes**, Trustee **reads** | `evidence.json`, `schema` | One `attestation-evidence-<pod>` ConfigMap per workload, server-side-applied from inside the TEE. |

CoCo also **decodes the pasted initdata's KBS URL** and warns (warn-only, never blocks Create) when it
is an in-cluster `*.svc` host that a spoke/air-gapped cluster could not reach.

## Stack

Matches `osc-openshift-console-plugin` (OCP **4.22**): **React 18**, PatternFly 6.4,
`@openshift-console/dynamic-plugin-sdk` `4.22-latest`, `react-router` v7, `swc-loader`,
Yarn 4.14.1. Pure-logic helpers under `src/utils` have Jest `*.spec.ts` tests (`yarn test`).

## Develop

```bash
yarn install
yarn start          # plugin dev server on :9001
yarn start-console  # OpenShift console in a container (requires `oc login`)
# open http://localhost:9000
```

- `yarn lint` — eslint + stylelint (`--fix`)
- `yarn build` — production bundle
- `yarn test` — Jest unit tests for the `src/utils` pure helpers
- `yarn i18n` — regenerate `locales/en/plugin__coco-openshift-console-plugin.json`

## Conventions

- i18n namespace `plugin__coco-openshift-console-plugin`; CSS class prefix `coco-openshift-console-plugin__`.
- PatternFly `--pf-t--*` tokens only (no hex/named colors — dark-mode safe).
- Functional components; hooks wrap `useK8sWatchResource`; types extend `K8sResourceCommon`.
