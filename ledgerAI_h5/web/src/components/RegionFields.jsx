import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { flag } from '../utils.js';

// Country + currency state; the currency follows the country until the user picks one explicitly.
export function useRegion() {
  const [lists, setLists] = useState({ countries: [], currencies: [] });
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('');
  useEffect(() => { api.countries().then(setLists).catch(() => {}); }, []);
  const pickCountry = (code) => {
    setCountry(code);
    setCurrency(lists.countries.find((c) => c.code === code)?.currency ?? currency);
  };
  return { lists, country, currency, setCurrency, pickCountry, complete: Boolean(country && currency) };
}

const selectCls = 'ios-input text-right text-ios-secondary focus:text-black appearance-none [text-align-last:right]';

// Two rows for an `ios-group`
export function RegionFields({ region, rowClass = 'flex items-center px-4 py-3', labelClass = 'w-28 shrink-0 text-[17px]' }) {
  const { lists, country, currency, setCurrency, pickCountry } = region;
  return (
    <>
      <label className={rowClass}>
        <span className={labelClass}>Country</span>
        <select required value={country} onChange={(e) => pickCountry(e.target.value)} className={selectCls}>
          {!country && <option value="">Select…</option>}
          {lists.countries.map((c) => <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>)}
        </select>
      </label>
      <label className={rowClass}>
        <span className={labelClass}>Currency</span>
        <select required value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectCls}>
          {!currency && <option value="">Select…</option>}
          {lists.currencies.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
    </>
  );
}

// Remembers the sign-up choice until the account can sign in (Cognito needs the emailed code first)
const pendingKey = (email) => `ledgerai.region.${email.trim().toLowerCase()}`;
export const rememberRegion = (email, country, currency) => localStorage.setItem(pendingKey(email), JSON.stringify({ country, currency }));
export function takePendingRegion(email) {
  const raw = localStorage.getItem(pendingKey(email));
  localStorage.removeItem(pendingKey(email));
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
