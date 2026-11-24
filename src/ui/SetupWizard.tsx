import { useEffect, useState } from 'preact/hooks';
import { t, type StringKey } from '../i18n';
import { Brand, Switch } from './common';
import { Icon } from './Icon';

interface Status {
  ok: boolean;
  error?: string;
  writable?: boolean;
  codeReady?: boolean;
  codeFile?: string;
  origin?: string;
}

const CONSOLE = 'https://console.cloud.google.com';
const CLIENT_ID = /^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$/;

/** Optional features the setup screen can turn on, each with the Google API it needs. */
const FEATURES = [
  { key: 'calendar', api: 'calendar-json.googleapis.com' },
  { key: 'tasks', api: 'tasks.googleapis.com' },
  { key: 'contactPhotos', api: 'people.googleapis.com' },
  { key: 'stickies', api: 'drive.googleapis.com' },
  { key: 'syncSettings', api: 'drive.googleapis.com' }
] as const;

const ERRORS = ['bad_code', 'locked', 'bad_client_id', 'bad_secret', 'bad_account', 'bad_domain', 'no_accounts', 'not_writable', 'write_check_failed', 'network'];

type FeatureKey = (typeof FEATURES)[number]['key'];

async function call(fields: Record<string, string>): Promise<Status> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    const r = await fetch('./setup.php', { method: 'POST', body: form, credentials: 'same-origin' });
    return ((await r.json().catch(() => null)) as Status | null) ?? { ok: false, error: r.status === 404 ? 'unavailable' : 'server' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

function Ext({ href, children }: { href: string; children: preact.ComponentChildren }) {
  return (
    <a class="btn sm" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" size={14} />
    </a>
  );
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <span class="wiz-copy">
      <code>{value}</code>
      <button
        type="button"
        class="btn sm"
        onClick={() => navigator.clipboard?.writeText(value).then(() => setDone(true), () => undefined)}
      >
        <Icon name={done ? 'tick' : 'copy'} size={14} />
        {done ? t('wiz.copied') : t('wiz.copy')}
      </button>
    </span>
  );
}

/**
 * First-run setup in the browser: walks through Google Cloud with direct links, then writes
 * maillo-config.php through setup.php, which deletes itself afterwards.
 */
export function SetupWizard({ onCancel }: { onCancel: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [accounts, setAccounts] = useState('');
  const [domains, setDomains] = useState('');
  const [language, setLanguage] = useState<'auto' | 'en' | 'fr'>('auto');
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>({ calendar: false, tasks: false, contactPhotos: false, stickies: false, syncSettings: false });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    call({ action: 'status' }).then(setStatus);
  }, []);

  const origin = status?.origin ?? location.origin;
  const steps: StringKey[] = ['wiz.s1', 'wiz.s2', 'wiz.s3', 'wiz.s4', 'wiz.s5'];
  const idOk = CLIENT_ID.test(clientId.trim());
  const whoOk = !!(accounts.trim() || domains.trim());
  const canNext = step === 2 ? idOk : step === 3 ? whoOk : true;

  const save = async () => {
    setBusy(true);
    setError('');
    const r = await call({
      action: 'save',
      code,
      clientId: clientId.trim(),
      clientSecret: secret.trim(),
      accounts,
      domains,
      language,
      features: JSON.stringify({ ...features, staySignedIn: !!secret.trim() })
    });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(t(ERRORS.includes(r.error ?? '') ? (`wiz.err.${r.error}` as StringKey) : 'wiz.err.server'));
  };

  if (status && !status.ok) {
    return (
      <div class="center">
        <div class="glass signin setup">
          <Brand />
          <h1>{t('wiz.title')}</h1>
          <p class="err">{t(status.error === 'already_set_up' || status.error === 'unavailable' ? 'wiz.unavailable' : 'wiz.err.server')}</p>
          <button class="btn" onClick={onCancel}>{t('wiz.back')}</button>
        </div>
      </div>
    );
  }
  if (status && !status.writable) {
    return (
      <div class="center">
        <div class="glass signin setup">
          <Brand />
          <h1>{t('wiz.title')}</h1>
          <p class="err">{t('wiz.notWritable')}</p>
          <button class="btn" onClick={onCancel}>{t('wiz.back')}</button>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <div class="center">
        <div class="glass signin setup">
          <Brand />
          <h1>{t('wiz.doneTitle')}</h1>
          <p>{t('wiz.doneBody')}</p>
          <button class="btn primary" onClick={() => location.reload()}>{t('wiz.signIn')}</button>
        </div>
      </div>
    );
  }

  return (
    <div class="center">
      <div class="glass signin setup wiz">
        <Brand />
        <h1>{t('wiz.title')}</h1>
        <ol class="wiz-steps" aria-label={t('wiz.progress')}>
          {steps.map((s, i) => (
            <li class={i === step ? 'on' : i < step ? 'past' : ''} aria-current={i === step ? 'step' : undefined}>
              <span class="n">{i < step ? <Icon name="tick" size={12} /> : i + 1}</span>
              <span class="l">{t(s)}</span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div class="wiz-body">
            <p>{t('wiz.s1.intro')}</p>
            <ol class="wiz-list">
              <li>
                {t('wiz.s1.project')}
                <Ext href={`${CONSOLE}/projectcreate`}>{t('wiz.s1.projectBtn')}</Ext>
              </li>
              <li>
                {t('wiz.s1.gmail')}
                <Ext href={`${CONSOLE}/apis/library/gmail.googleapis.com`}>{t('wiz.s1.gmailBtn')}</Ext>
              </li>
            </ol>
            <p class="wiz-hint">{t('wiz.s1.hint')}</p>
          </div>
        )}

        {step === 1 && (
          <div class="wiz-body">
            <p>{t('wiz.s2.intro')}</p>
            <ol class="wiz-list">
              <li>
                {t('wiz.s2.start')}
                <Ext href={`${CONSOLE}/auth/overview`}>{t('wiz.s2.startBtn')}</Ext>
              </li>
              <li>{t('wiz.s2.info')}</li>
              <li>
                <b>{t('wiz.s2.audience')}</b> {t('wiz.s2.internal')} {t('wiz.s2.external')}
              </li>
            </ol>
          </div>
        )}

        {step === 2 && (
          <div class="wiz-body">
            <ol class="wiz-list">
              <li>
                {t('wiz.s3.create')}
                <Ext href={`${CONSOLE}/auth/clients/create`}>{t('wiz.s3.createBtn')}</Ext>
              </li>
              <li>
                {t('wiz.s3.origin')}
                <Copy value={origin} />
                {!origin.startsWith('https://') && <span class="wiz-warn">{t('wiz.s3.https')}</span>}
              </li>
              <li>{t('wiz.s3.paste')}</li>
            </ol>
            <label class="wiz-field">
              <span>{t('wiz.clientId')}</span>
              <input class="input" value={clientId} placeholder="1234567890-abc.apps.googleusercontent.com" spellcheck={false} autocomplete="off" onInput={(e) => setClientId((e.target as HTMLInputElement).value)} />
              {clientId.trim() && !idOk && <span class="wiz-warn">{t('wiz.clientIdBad')}</span>}
            </label>
            <label class="wiz-field">
              <span>{t('wiz.secret')}</span>
              <input class="input" type="password" value={secret} spellcheck={false} autocomplete="off" onInput={(e) => setSecret((e.target as HTMLInputElement).value)} />
              <small>{t('wiz.secretHelp')}</small>
            </label>
          </div>
        )}

        {step === 3 && (
          <div class="wiz-body">
            <label class="wiz-field">
              <span>{t('wiz.accounts')}</span>
              <input class="input" type="email" multiple value={accounts} placeholder="you@example.com" autocomplete="email" onInput={(e) => setAccounts((e.target as HTMLInputElement).value)} />
            </label>
            <label class="wiz-field">
              <span>{t('wiz.domains')}</span>
              <input class="input" value={domains} placeholder="example.com" onInput={(e) => setDomains((e.target as HTMLInputElement).value)} />
              <small>{t('wiz.domainsHelp')}</small>
            </label>
            <label class="wiz-field">
              <span>{t('settings.language')}</span>
              <select class="select" value={language} onChange={(e) => setLanguage((e.target as HTMLSelectElement).value as 'auto' | 'en' | 'fr')}>
                <option value="auto">{t('wiz.langAuto')}</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </label>
            <div class="wiz-feats">
              <span class="caps">{t('wiz.features')}</span>
              {FEATURES.map((f) => (
                <div class="wiz-feat">
                  <div>
                    <b>{t(`wiz.f.${f.key}` as StringKey)}</b>
                    <a href={`${CONSOLE}/apis/library/${f.api}`} target="_blank" rel="noopener noreferrer">{t('wiz.enableApi')}</a>
                  </div>
                  <Switch label={t(`wiz.f.${f.key}` as StringKey)} on={features[f.key]} onChange={(v) => setFeatures({ ...features, [f.key]: v })} />
                </div>
              ))}
              <small>{t('wiz.featuresHelp')}</small>
            </div>
          </div>
        )}

        {step === 4 && (
          <div class="wiz-body">
            <p>{t('wiz.s5.intro', { file: status?.codeFile ?? 'maillo-setup-code.php' })}</p>
            <label class="wiz-field">
              <span>{t('wiz.code')}</span>
              <input class="input wiz-code" value={code} placeholder="ABCD-EFGH-JKMN" spellcheck={false} autocomplete="off" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            </label>
            <p class="wiz-hint">{t('wiz.s5.after')}</p>
          </div>
        )}

        {error && <p class="err" role="alert">{error}</p>}

        <div class="wiz-nav">
          <button class="btn" onClick={() => (step ? setStep(step - 1) : onCancel())}>{t('wiz.back')}</button>
          {step < steps.length - 1 ? (
            <button class="btn primary" disabled={!canNext || !status} onClick={() => setStep(step + 1)}>{t('wiz.next')}</button>
          ) : (
            <button class="btn primary" disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 12} onClick={save}>{busy ? t('wiz.saving') : t('wiz.save')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
