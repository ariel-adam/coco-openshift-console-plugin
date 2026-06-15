import { DocumentTitle, ListPageHeader } from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  ClipboardCopy,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  PageSection,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useState } from 'react';
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

const InitdataBuilder: FC = () => {
  const { t } = useTranslation('plugin__coco-openshift-console-plugin');
  const [trusteeUrl, setTrusteeUrl] = useState('https://kbs-service.trustee-operator-system:8080');
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
        <Grid hasGutter>
          <GridItem md={6}>
            <Card>
              <CardTitle>{t('Configuration')}</CardTitle>
              <CardBody>
                <Form>
                  <FormGroup label={t('Trustee (KBS) URL')} isRequired fieldId="trustee-url">
                    <TextInput
                      id="trustee-url"
                      value={trusteeUrl}
                      onChange={(_e, v) => {
                        setTrusteeUrl(v);
                      }}
                    />
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
              <CardTitle>{t('Output')}</CardTitle>
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
                    </FormGroup>
                    <FormGroup
                      label={t('PCR8 reference value (add to Trustee RVPS)')}
                      fieldId="pcr8"
                      className="coco-openshift-console-plugin__mt"
                    >
                      <ClipboardCopy isReadOnly hoverTip={t('Copy')} clickTip={t('Copied')}>
                        {result.pcr8}
                      </ClipboardCopy>
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
                    </FormGroup>
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
