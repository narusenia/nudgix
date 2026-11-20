import { Check, Copy, Download, PackagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { IconButton } from './IconButton';
import s from './ui.module.css';

export function PromptPanel({ prompt, empty, hasSkill, onInstalled }: { prompt: string; empty: boolean; hasSkill: boolean; onInstalled: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => setCopied(false), [prompt]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      // When the clipboard is unavailable, just select the text and let the user press ⌘C
      const range = document.createRange();
      if (preRef.current) range.selectNodeContents(preRef.current);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  };

  const [installError, setInstallError] = useState<string | null>(null);
  const install = async () => {
    setInstallError(null);
    const res = await fetch('api/install-skill', { method: 'POST' }).catch(() => null);
    if (res?.ok || res?.status === 409) return onInstalled();
    setInstallError((await res?.json().catch(() => null))?.error ?? String(res?.status ?? 'network'));
  };

  const saveMd = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${prompt}\n`], { type: 'text/markdown' }));
    a.download = `token-changes-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle} style={{ flex: 1 }}>
          {t.prompt}
        </h2>
        {hasSkill ? null : (
          <IconButton label={t.installSkill} onClick={install}>
            <PackagePlus size={14} />
          </IconButton>
        )}
        <IconButton label={t.saveMd} variant="raised" disabled={empty} onClick={saveMd}>
          <Download size={14} />
        </IconButton>
        <IconButton label={copied ? t.copied : t.copy} shortcut="⌘⇧C" variant="primary" disabled={empty} onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </div>
      {installError ? <p className={s.empty}>{t.installFailed(installError)}</p> : null}
      {empty ? (
        <p className={s.empty}>{t.emptyPrompt}</p>
      ) : (
        <pre ref={preRef} className={s.promptPre}>
          {prompt}
        </pre>
      )}
    </section>
  );
}
