import {
  classifyInitdataToml,
  classifyKbsUrl,
  isInClusterKbsHost,
  kbsHostFromUrl,
} from './topology';

describe('kbsHostFromUrl', () => {
  it('extracts the hostname from a full URL (dropping scheme/port/path)', () => {
    expect(kbsHostFromUrl('https://kbs.example.com:8080/api')).toBe('kbs.example.com');
  });

  it('handles a bare host:port string with no scheme', () => {
    expect(kbsHostFromUrl('kbs-service.trustee.svc:8080')).toBe('kbs-service.trustee.svc');
  });

  it('strips a scheme even when the rest is not URL-parseable', () => {
    expect(kbsHostFromUrl('http://kbs-service.trustee.svc')).toBe('kbs-service.trustee.svc');
  });

  it('returns empty string for empty input', () => {
    expect(kbsHostFromUrl('   ')).toBe('');
  });
});

describe('isInClusterKbsHost', () => {
  it('flags a bare *.svc service name', () => {
    expect(isInClusterKbsHost('https://kbs-service.trustee.svc:8080')).toBe(true);
  });

  it('flags a fully-qualified *.svc.cluster.local name', () => {
    expect(isInClusterKbsHost('http://kbs-service.trustee.svc.cluster.local:8080')).toBe(true);
  });

  it('flags a bare host:port with no scheme', () => {
    expect(isInClusterKbsHost('kbs-service.trustee.svc:8080')).toBe(true);
  });

  it('does NOT flag an external route hostname', () => {
    expect(isInClusterKbsHost('https://kbs-trustee.apps.hub.example.com')).toBe(false);
  });

  it('does NOT flag a bare IP address', () => {
    expect(isInClusterKbsHost('https://10.0.0.5:8080')).toBe(false);
  });

  it('is case-insensitive on the suffix', () => {
    expect(isInClusterKbsHost('https://KBS-SERVICE.TRUSTEE.SVC:8080')).toBe(true);
  });

  it('returns false for empty/garbage input', () => {
    expect(isInClusterKbsHost('')).toBe(false);
    expect(isInClusterKbsHost('   ')).toBe(false);
  });
});

describe('classifyKbsUrl (existing local/remote split)', () => {
  it('classifies the named local service as local', () => {
    expect(classifyKbsUrl('https://kbs-service.trustee.svc:8080', 'kbs-service')).toEqual({
      target: 'local',
      host: 'kbs-service.trustee.svc:8080',
    });
  });

  it('classifies a different host as remote', () => {
    expect(classifyKbsUrl('https://kbs.apps.hub.example.com', 'kbs-service').target).toBe('remote');
  });
});

describe('classifyInitdataToml', () => {
  const withUrl = (url: string, cert = false): string =>
    `algorithm = "sha256"\n[data]\n"cdh.toml" = '''\n[kbc]\nname = 'cc_kbc'\nurl = '${url}'\n${
      cert
        ? 'kbs_cert = """\n-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----\n"""\n'
        : ''
    }'''\n`;

  it('flags an https KBS that pins no certificate (the rustls footgun)', () => {
    const i = classifyInitdataToml(withUrl('https://kbs.apps.hub.example.com'));
    expect(i).toMatchObject({ ok: true, scheme: 'https', hasCert: false });
    expect(i.kbsUrl).toBe('https://kbs.apps.hub.example.com');
  });

  it('accepts an https KBS with a pinned cert', () => {
    expect(classifyInitdataToml(withUrl('https://kbs.apps.hub.example.com', true))).toMatchObject({
      ok: true,
      scheme: 'https',
      hasCert: true,
    });
  });

  it('treats a plain-http KBS as ok with no cert needed', () => {
    expect(classifyInitdataToml(withUrl('http://35.0.0.1:8080'))).toMatchObject({
      ok: true,
      scheme: 'http',
      hasCert: false,
    });
  });

  it('marks a value that is not an initdata.toml as not ok', () => {
    expect(classifyInitdataToml('just some pasted text')).toEqual({
      ok: false,
      kbsUrl: null,
      scheme: null,
      hasCert: false,
    });
  });
});
