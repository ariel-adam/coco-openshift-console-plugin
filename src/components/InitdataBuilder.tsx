import { DocumentTitle, ListPageHeader } from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  ClipboardCopy,
  Content,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  PageSection,
  ProgressStep,
  ProgressStepper,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { CC_INIT_DATA_ANNOTATION } from '../k8s/resources';
import {
  buildInitdata,
  SENSITIVE_REQUESTS,
  type HashAlgo,
  type InitdataResult,
  type SensitiveRequest,
} from '../utils/initdata';
import './coco.css';

const DEFAULT_ALLOW: Record<SensitiveRequest, boolean> = {
  ExecProcessRequest: false,
  ReadStreamRequest: false,
  WriteStreamRequest: false,
  SetPolicyRequest: false,
  PullImageRequest: true,
};

/** Confidential Attestation overview (Trustee plugin) — where reference values live. */
const TRUSTEE_OVERVIEW = '/trustee';
/** Create confidential workload form (this plugin). */
const CREATE_WORKLOAD = '/confidential-containers/workloads/new';

const HowItWorks: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  return (
    <Card className="coco-openshift-console-plugin__mb">
      <CardTitle>
        {t('How this works — from initdata to a running confidential workload')}
      </CardTitle>
      <CardBody>
        <Content className="coco-openshift-console-plugin__mb">
          <Content component="p">
            {t(
              'Initdata is a small, tamper-evident configuration baked into a confidential pod. At boot the guest reads it to find your Trustee (the Key Broker Service, KBS) and to constrain what the Kata agent is allowed to do. Because initdata is measured into PCR8, Trustee can prove it has not been altered before releasing any secrets. Generating it is step 1 of six:',
            )}
          </Content>
        </Content>
        <ProgressStepper isVertical aria-label={t('Confidential workload attestation flow')}>
          <ProgressStep
            variant="info"
            id="cc-flow-1"
            titleId="cc-flow-1-title"
            aria-label={t('Step 1')}
            description={t(
              'Set your Trustee (KBS) URL and the Kata agent policy on the left, then Generate. Everything is computed in your browser — nothing is sent anywhere.',
            )}
          >
            {t('Generate initdata (here)')}
          </ProgressStep>
          <ProgressStep
            variant="info"
            id="cc-flow-2"
            titleId="cc-flow-2-title"
            aria-label={t('Step 2')}
            description={t(
              'Add the PCR8 reference value to Trustee’s reference values (RVPS). This is what lets attestation trust pods that carry this initdata — without it, Trustee refuses to release secrets and the pod cannot start its workload.',
            )}
          >
            {t('Register the reference value with Trustee')}
          </ProgressStep>
          <ProgressStep
            variant="info"
            id="cc-flow-3"
            titleId="cc-flow-3-title"
            aria-label={t('Step 3')}
            description={t(
              'Create a Pod or Deployment with runtimeClassName: kata-cc (or kata-cc-nvidia-gpu) and the cc_init_data annotation. Use the Pod manifest snippet below, or the Create confidential workload form.',
            )}
          >
            {t('Deploy your workload')}
          </ProgressStep>
          <ProgressStep
            variant="pending"
            id="cc-flow-4"
            titleId="cc-flow-4-title"
            aria-label={t('Step 4')}
            description={t(
              'The pod starts inside a hardware TEE. Its attestation agent sends evidence — including the PCR8 measurement of this initdata — to the Trustee KBS at the URL you configured.',
            )}
          >
            {t('The pod attests at boot (automatic)')}
          </ProgressStep>
          <ProgressStep
            variant="pending"
            id="cc-flow-5"
            titleId="cc-flow-5-title"
            aria-label={t('Step 5')}
            description={t(
              'Trustee checks the evidence against the registered reference values and the attestation policy. On success it returns an attestation token and releases the keys and secrets your workload requested.',
            )}
          >
            {t('Trustee verifies and releases secrets (automatic)')}
          </ProgressStep>
          <ProgressStep
            variant="pending"
            id="cc-flow-6"
            titleId="cc-flow-6-title"
            aria-label={t('Step 6')}
            description={t(
              'Your data stays encrypted in use, even from the host. Confirm attestation succeeded with the Verify attestation action on the pod, or from the Workloads list.',
            )}
          >
            {t('Workload runs confidentially')}
          </ProgressStep>
        </ProgressStepper>
      </CardBody>
    </Card>
  );
};

const InitdataBuilder: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const navigate = useNavigate();
  const [topology, setTopology] = useState<'colocated' | 'remote'>('colocated');
  const [trusteeUrl, setTrusteeUrl] = useState('http://kbs-service.trustee-operator-system:8080');
  const [algorithm, setAlgorithm] = useState<HashAlgo>('sha256');
  const [kbsCert, setKbsCert] = useState('');
  const [imageUri, setImageUri] = useState('');
  const [allow, setAllow] = useState<Record<SensitiveRequest, boolean>>(DEFAULT_ALLOW);
  const [result, setResult] = useState<InitdataResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const requestHelp: Record<SensitiveRequest, string> = {
    ExecProcessRequest: t('Allow oc/kubectl exec into the confidential VM (recommended off).'),
    ReadStreamRequest: t('Allow reading container stdout/stderr streams (recommended off).'),
    WriteStreamRequest: t('Allow writing to container stdin (recommended off).'),
    SetPolicyRequest: t('Allow replacing the Kata Agent policy at runtime (recommended off).'),
    PullImageRequest: t('Allow the guest to pull container images.'),
  };

  const generate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await buildInitdata({
        trusteeUrl: trusteeUrl.trim(),
        algorithm,
        kbsCert: kbsCert.trim() || undefined,
        imageSecurityPolicyUri: imageUri.trim() || undefined,
        policyOverrides: allow,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const podSnippet = result
    ? `metadata:\n  annotations:\n    ${CC_INIT_DATA_ANNOTATION}: "${result.annotation}"\nspec:\n  runtimeClassName: kata-cc`
    : '';

  return (
    <>
      <DocumentTitle>{t('Initdata builder')}</DocumentTitle>
      <ListPageHeader title={t('Initdata builder')} />
      <PageSection>
        <HowItWorks />
        <Grid hasGutter>
          <GridItem md={6}>
            <Card>
              <CardTitle>{t('1. Configure initdata')}</CardTitle>
              <CardBody>
                <Form>
                  <FormGroup label={t('Trustee location')} fieldId="trustee-topology">
                    <FormSelect
                      id="trustee-topology"
                      value={topology}
                      onChange={(_e, v) => {
                        const mode = v as 'colocated' | 'remote';
                        setTopology(mode);
                        setTrusteeUrl(
                          mode === 'remote'
                            ? ''
                            : 'http://kbs-service.trustee-operator-system:8080',
                        );
                      }}
                    >
                      <FormSelectOption value="colocated" label={t('Same cluster (co-located)')} />
                      <FormSelectOption
                        value="remote"
                        label={t('Different cluster (hub-and-spoke)')}
                      />
                    </FormSelect>
                  </FormGroup>
                  {topology === 'remote' && (
                    <Alert
                      variant="info"
                      isInline
                      title={t('Remote (hub-and-spoke) attestation')}
                      className="coco-openshift-console-plugin__mb"
                    >
                      {t(
                        'This workload (spoke) attests to a Trustee on another cluster. Use the externally reachable KBS route on 443 (for example https://kbs-route-<ns>.apps.<hub-domain>) — not the in-cluster Service or :8080. If the route is HTTPS with a self-signed or cluster cert, paste that cert below so the guest can trust it. Also confirm on the hub Trustee: its KBS is reachable from this cluster, and it has reference values for this hardware plus this initdata’s PCR8 registered (or a Permissive policy).',
                      )}
                    </Alert>
                  )}
                  <FormGroup label={t('Trustee (KBS) URL')} isRequired fieldId="trustee-url">
                    <TextInput
                      id="trustee-url"
                      value={trusteeUrl}
                      placeholder={
                        topology === 'remote'
                          ? 'https://kbs-route-<ns>.apps.<hub-domain>'
                          : 'http://kbs-service.<namespace>:8080'
                      }
                      onChange={(_e, v) => {
                        setTrusteeUrl(v);
                      }}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'Where the guest reaches your Trustee. Use http:// for an insecure in-cluster KBS, or https:// for a TLS route — then paste its cert below.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>
                  <FormGroup label={t('Measurement algorithm')} fieldId="algorithm">
                    <FormSelect
                      id="algorithm"
                      value={algorithm}
                      onChange={(_e, v) => {
                        setAlgorithm(v as HashAlgo);
                      }}
                    >
                      <FormSelectOption value="sha256" label="sha256" />
                      <FormSelectOption value="sha384" label="sha384" />
                      <FormSelectOption value="sha512" label="sha512" />
                    </FormSelect>
                  </FormGroup>
                  <FormGroup label={t('KBS certificate (PEM body, optional)')} fieldId="kbs-cert">
                    <TextArea
                      id="kbs-cert"
                      value={kbsCert}
                      onChange={(_e, v) => {
                        setKbsCert(v);
                      }}
                      rows={4}
                      placeholder={t(
                        'Paste the certificate between BEGIN/END lines, or leave blank for insecure HTTP.',
                      )}
                    />
                  </FormGroup>
                  <FormGroup label={t('Image security policy URI (optional)')} fieldId="image-uri">
                    <TextInput
                      id="image-uri"
                      value={imageUri}
                      onChange={(_e, v) => {
                        setImageUri(v);
                      }}
                      placeholder="kbs:///default/security-policy/test"
                    />
                  </FormGroup>
                  <FormGroup label={t('Kata Agent policy')} fieldId="policy">
                    {SENSITIVE_REQUESTS.map((req) => (
                      <Checkbox
                        key={req}
                        id={`allow-${req}`}
                        label={t('Allow {{req}}', { req })}
                        description={requestHelp[req]}
                        isChecked={allow[req]}
                        onChange={(_e, checked) => {
                          setAllow((prev) => ({ ...prev, [req]: checked }));
                        }}
                        className="coco-openshift-console-plugin__mb"
                      />
                    ))}
                  </FormGroup>
                  <Button
                    variant="primary"
                    onClick={() => void generate()}
                    isLoading={busy}
                    isDisabled={busy || trusteeUrl.trim() === ''}
                  >
                    {t('Generate initdata')}
                  </Button>
                </Form>
              </CardBody>
            </Card>
          </GridItem>

          <GridItem md={6}>
            <Card>
              <CardTitle>{t('2. Output — and what to do with it')}</CardTitle>
              <CardBody>
                {error && (
                  <Alert
                    variant="danger"
                    isInline
                    title={t('Could not generate initdata')}
                    className="coco-openshift-console-plugin__mb"
                  >
                    {error}
                  </Alert>
                )}
                {!result ? (
                  <span className="coco-openshift-console-plugin__muted">
                    {t(
                      'Fill in the form and select Generate. The initdata is built in your browser — nothing is sent anywhere.',
                    )}
                  </span>
                ) : (
                  <>
                    <FormGroup
                      label={t('cc_init_data annotation value (gzip + base64)')}
                      fieldId="annotation"
                    >
                      <ClipboardCopy
                        isReadOnly
                        isExpanded
                        variant="expansion"
                        hoverTip={t('Copy')}
                        clickTip={t('Copied')}
                      >
                        {result.annotation}
                      </ClipboardCopy>
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'The deployable form of your initdata. Set it as the {{key}} annotation on your confidential Pod (or Deployment pod template).',
                              { key: CC_INIT_DATA_ANNOTATION },
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup
                      label={t('PCR8 reference value (add to Trustee RVPS)')}
                      fieldId="pcr8"
                      className="coco-openshift-console-plugin__mt"
                    >
                      <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                        {result.pcr8}
                      </ClipboardCopy>
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem variant="warning">
                            {t(
                              'A measurement of exactly this initdata. Register it in Trustee’s reference values (RVPS) before you deploy — otherwise attestation fails and Trustee withholds secrets. Open Confidential Attestation → your TrusteeConfig → Reference values.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup
                      label={t('Pod manifest snippet')}
                      fieldId="pod-snippet"
                      className="coco-openshift-console-plugin__mt"
                    >
                      <ClipboardCopy
                        isCode
                        isReadOnly
                        variant="expansion"
                        hoverTip={t('Copy')}
                        clickTip={t('Copied')}
                      >
                        {podSnippet}
                      </ClipboardCopy>
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Ready to paste into a Pod or Deployment template — it sets the confidential runtime class and the annotation for you. Switch kata-cc to kata-cc-nvidia-gpu for confidential GPU workloads.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup
                      label={t('Generated initdata.toml')}
                      fieldId="initdata-toml"
                      className="coco-openshift-console-plugin__mt"
                    >
                      <ClipboardCopy
                        isCode
                        isReadOnly
                        isExpanded
                        variant="expansion"
                        hoverTip={t('Copy')}
                        clickTip={t('Copied')}
                      >
                        {result.toml}
                      </ClipboardCopy>
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Human-readable source the annotation encodes — for review and audit. You deploy the annotation above, not this file.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>

                    <div className="coco-openshift-console-plugin__mt">
                      <Content component="p">
                        <strong>{t('Next steps')}</strong>
                      </Content>
                      <Button
                        variant="primary"
                        className="coco-openshift-console-plugin__mb"
                        onClick={() => {
                          navigate(CREATE_WORKLOAD, {
                            state: {
                              initdata: result.annotation,
                              pcr8: result.pcr8,
                              trusteeUrl: trusteeUrl.trim(),
                            },
                          });
                        }}
                      >
                        {t('Create workload with this initdata')}
                      </Button>{' '}
                      <Button
                        variant="secondary"
                        className="coco-openshift-console-plugin__mb"
                        component={(props) => <Link {...props} to={TRUSTEE_OVERVIEW} />}
                      >
                        {t('Register reference value in Confidential Attestation')}
                      </Button>
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default InitdataBuilder;
