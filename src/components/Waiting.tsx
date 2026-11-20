import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import type { AdapterId } from '../lib/adapters';
import { IconButton } from './IconButton';
import s from './ui.module.css';

export type Status = {
  target: string | null;
  targetUp: boolean;
  dir: string;
  framework: 'next' | 'vite' | 'astro' | 'other';
  adapter: AdapterId;
  devCommand: string | null;
  hasSkill: boolean;
  storybookUp: boolean;
};

/** Screen shown until the dev server is found. Shows the start command and opens the page automatically once it is up */
export function Waiting({ status }: { status: Status }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const command = `cd ${status.dir}${status.devCommand ? ` && ${status.devCommand}` : ''}`;

  return (
    <div className={s.waiting}>
      <div className={s.waitingCard}>
        <h1 className={s.waitingTitle}>
          <span className={s.pulse} aria-hidden="true" />
          {t.waiting.title(status.target?.replace(/^https?:\/\//, '') ?? null)}
        </h1>
        <p className={s.waitingBody}>{t.waiting.body}</p>
        <div className={s.commandBox}>
          <span className={s.ellipsis} style={{ flex: 1 }}>
            {command}
          </span>
          <IconButton label={copied ? t.copied : t.copy} variant="raised" onClick={() => navigator.clipboard.writeText(command).then(() => setCopied(true))}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </div>
        <p className={s.waitingBody}>{t.waiting.targetHint}</p>
      </div>
    </div>
  );
}
