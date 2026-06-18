# AI agent instructions — coco-openshift-console-plugin

OpenShift Console dynamic plugin for **confidential containers** — the `kata-cc` runtime, TEE-capable
nodes, and confidential workloads (list + a guided Create form). **Attestation (the Red Hat build of
Trustee) is a separate plugin, `trustee-openshift-console-plugin`** — do not add TrusteeConfig /
KbsConfig / KBS / policy / reference-value management here; that belongs in the trustee plugin. There is
**no CoCo operator**: confidential containers is a *feature gate* of the OSC operator (`osc-feature-gates`
ConfigMap, `confidential: "true"`), which ships **both** the osc and coco plugins. Across all three
plugins there are **two operators total**: the OSC operator (ships osc + coco; confidential is a feature
gate) and the Trustee operator (ships trustee). Do **not** add any "detect / install Trustee" gate or
CTA here — the attestation service may be on another cluster or not be Trustee.

This is a **sibling of `osc-openshift-console-plugin`** (at `../osc-openshift-console-plugin`); match
its stack and conventions exactly. When in doubt about a pattern, read the corresponding file in
`osc-openshift-console-plugin`.

## Stack (OCP 4.22)

**React 18**, PatternFly **6.4**, `@openshift-console/dynamic-plugin-sdk` **4.22-latest**, **`react-router`
v7** (import `Link`/`useNavigate`/`useParams` from `react-router`), **`swc-loader`**, Yarn **4.14.1**. The
4.22 SDK uses the `__load_plugin_entry__` federation protocol — required to load in a 4.22 console.

## Conventions

- i18n namespace **`plugin__coco-openshift-console-plugin`**; in components `useTranslation('plugin__coco-openshift-console-plugin')`;
  in `console-extensions.json` use `%plugin__coco-openshift-console-plugin~Label%`. Run `yarn i18n` after changing strings.
- CSS class prefix **`coco-openshift-console-plugin__`**. Only PatternFly `--pf-t--*` tokens — **no hex/named colors**
  (stylelint enforces this; it protects dark mode).
- Functional components (`FC`); custom hooks in `src/k8s/hooks.ts` wrap `useK8sWatchResource` and
  return `[data, loaded]`; all resource types extend `K8sResourceCommon` in `src/k8s/types.ts`;
  GVKs/models/constants in `src/k8s/resources.ts`.
- Any component referenced by `$codeRef` in `console-extensions.json` **must** be listed in
  `package.json` → `consolePlugin.exposedModules`. `package.json` `name` must equal `consolePlugin.name`.

## Domain

One `console.flag/model`-gated nav section:

- **Confidential Containers** — flag `COCO_KATACONFIG` on `KataConfig` (`kataconfiguration.openshift.io/v1`).
  Covers TEE-node detection/enablement (NFD, the Intel TDX host kernel args with MachineConfigPool reboot
  tracking), the `kata-cc` / `kata-cc-nvidia-gpu` runtimes, and confidential workloads (list + create).
  The menu is gated on `KataConfig`, so it can appear before `confidential:true` is set — the Overview
  shows a feature-gate empty-state surfacing `EnableConfidentialContainers` in that case.

`initdata` (the pasted `cc_init_data` value) is the bridge to attestation: it is **supplied by the
attestation service out-of-band**, not authored here (the form *requires a pasted value*). It references
the KBS URL **as a string** — CoCo does **not** depend on the Trustee CRDs. CoCo decodes the pasted KBS
host and **warns (warn-only)** when it is an in-cluster `*.svc` name a spoke could not reach.

## Cross-plugin ConfigMap contracts

CoCo and the Trustee operator update independently but share two **label-selected ConfigMap** conventions.
Both carry a `schema` data field stamped with `SHARED_CONFIGMAP_SCHEMA_VERSION` (currently `"1"`, defined
in `src/k8s/resources.ts`); readers **tolerate a missing/older value** to survive operator skew.

- **`trustee.attestation/shared-initdata`** — Trustee *writes* a `<tc>-shared-initdata` ConfigMap
  (`cc_init_data` + `kbs-url` + `pcr8` + `schema`); CoCo *optionally reads* it **on the same cluster only**
  (the Create form's optional initdata picker). Never required.
- **`trustee.attestation/evidence`** — CoCo's in-guest sidecar *writes* one `attestation-evidence-<pod>`
  ConfigMap (`evidence.json` + `schema`); Trustee *reads* it by selector.

## Verify

`yarn install`, then `yarn lint`, `yarn build`, and `yarn test` must pass. `tsconfig` is `strict` with
`noUnusedLocals` — no unused imports/locals. Pure logic goes in `src/utils/*` with a Jest `*.spec.ts`
(babel-jest; see `jest.config.cjs` + `babel.config.cjs`). The Babel config is jest-only — the webpack
build uses `swc-loader` and never reads it.
