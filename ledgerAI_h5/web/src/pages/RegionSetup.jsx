import { useState } from 'react';
import { api } from '../api.js';
import { RegionFields, useRegion } from '../components/RegionFields.jsx';

// Shown once after sign-in when the account has no country yet (older accounts, or sign-up was interrupted)
export default function RegionSetup({ user, onSaved, onLogout }) {
  const region = useRegion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Use ${region.currency} as your currency?\n\nYou won’t be able to change your country or currency later.`)) return;
    setBusy(true);
    setError('');
    try {
      const { profile } = await api.updateProfile({ display_name: user.display_name ?? '', country: region.country, currency: region.currency });
      onSaved({ country: profile.country, currency: profile.currency });
    } catch (err) {
      setError(err.details?.[0] ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto flex h-full max-w-md flex-col justify-center space-y-4 bg-ios-bg px-4">
      <h1 className="text-[34px] font-bold tracking-tight">Where do you live?</h1>
      <div className="ios-group"><RegionFields region={region} /></div>
      <p className="px-4 text-[13px] text-ios-secondary">All your receipts, budgets and reports use this currency. It can’t be changed after you continue.</p>
      {error && <p className="px-4 text-[13px] text-ios-red">{error}</p>}
      <button disabled={busy || !region.complete} className="ios-btn h-[50px] w-full rounded-[14px] bg-ios-blue text-[17px] font-semibold text-white disabled:opacity-50">
        {busy ? 'Please wait…' : 'Continue'}
      </button>
      <button type="button" onClick={onLogout} className="ios-btn block w-full text-center text-[15px] text-ios-red">Sign Out</button>
    </form>
  );
}
