'use client';
import { useState } from 'react';

const NEW_ACCOUNT = '__new__';

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const lastFour = (s: string) => s.match(/(\d{4})\D*$/)?.[1];

/** The tracked account a statement's printed label refers to, so "CHECKING ...1234"
 *  lands on "Checking 1234" instead of starting a second account. Returns the label
 *  as read when nothing matches, or when its last four digits fit more than one. */
export function matchKnownAccount(read: string | null | undefined, known: string[]): string {
  const label = read?.trim();
  if (!label) return '';
  const same = known.find((k) => normalize(k) === normalize(label));
  if (same) return same;
  const digits = lastFour(label);
  const byDigits = digits ? known.filter((k) => lastFour(k) === digits) : [];
  return byDigits.length === 1 ? byDigits[0] : label;
}

interface Props {
  accounts: string[];
  value: string;
  onChange: (account: string) => void;
}

export function AccountSelect({ accounts, value, onChange }: Props) {
  const [typing, setTyping] = useState(accounts.length === 0 || (value !== '' && !accounts.includes(value)));
  const field = 'bg-bg border border-border rounded px-2 py-1.5 text-sm text-text';

  const pick = (picked: string) => {
    setTyping(picked === NEW_ACCOUNT);
    onChange(picked === NEW_ACCOUNT ? '' : picked);
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted">Account</span>
      {accounts.length > 0 && (
        <select aria-label="Account" value={typing ? NEW_ACCOUNT : value} onChange={(e) => pick(e.target.value)} className={field}>
          <option value="" disabled>Choose an account</option>
          {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          <option value={NEW_ACCOUNT}>New account…</option>
        </select>
      )}
      {typing && (
        <input
          aria-label="New account name"
          autoFocus={accounts.length > 0 && value === ''}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Checking 1234"
          className={`${field} w-48`}
        />
      )}
    </div>
  );
}
