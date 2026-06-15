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
> This plugin owns the *workload* side; it produces the `initdata` that a confidential pod uses to
> attest to Trustee, and consumes Trustee's KBS URL — but does not deploy or configure Trustee.

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
  build initdata → run a workload.
- **TEE-capable nodes** — detect/label Intel TDX or AMD SEV-SNP nodes via Node Feature Discovery,
  one-click **enable TEE detection** and **enable the Intel TDX host** (the `nohibernate` +
  `kvm_intel.tdx=1` kernel args), and confidential-GPU readiness.
- **Runtime classes** — the `kata` / `kata-cc` / `kata-cc-nvidia-gpu` runtime classes and their
  confidential classification.
- **Workloads** — list confidential (kata-cc) workloads, and a guided **Create workload** form
  (`runtimeClassName: kata-cc` + node targeting + initdata annotation).
- **Initdata builder** — compose an `initdata.toml` (KBS URL, attestation/resource policy, Kata Agent
  policy), emit the gzip+base64 pod annotation `io.katacontainers.config.hypervisor.cc_init_data`, and
  the PCR8 reference value to register in Trustee's RVPS.

## Stack

Matches `osc-openshift-console-plugin` (OCP **4.21**): React 17, PatternFly 6.2,
`@openshift-console/dynamic-plugin-sdk` `4.21-latest`, `react-router-dom-v5-compat`, `ts-loader`,
Yarn 4.14.1.

## Develop

```bash
yarn install
yarn start          # plugin dev server on :9001
yarn start-console  # OpenShift console in a container (requires `oc login`)
# open http://localhost:9000
```

- `yarn lint` — eslint + stylelint (`--fix`)
- `yarn build` — production bundle
- `yarn i18n` — regenerate `locales/en/plugin__coco-openshift-console-plugin.json`

## Conventions

- i18n namespace `plugin__coco-openshift-console-plugin`; CSS class prefix `coco-openshift-console-plugin__`.
- PatternFly `--pf-t--*` tokens only (no hex/named colors — dark-mode safe).
- Functional components; hooks wrap `useK8sWatchResource`; types extend `K8sResourceCommon`.
