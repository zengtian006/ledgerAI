import { useState } from 'react';
import { api } from '../api.js';
import { RegionFields, rememberRegion, takePendingRegion, useRegion } from '../components/RegionFields.jsx';
import { COGNITO, confirmSignUp, forgotPassword, resendCode, resetPassword, signIn, signUp } from '../auth.js';

const PASSWORD_HINT = COGNITO
  ? 'At least 8 characters, with upper and lower case letters and a number.'
  : 'Use at least 8 characters.';

const Field = ({ label, children }) => (
  <label className="flex items-center px-4 py-3">
    <span className="w-28 shrink-0 text-[17px]">{label}</span>
    {children}
  </label>
);

const SUBMIT_LABEL = {
  login: 'Sign In',
  register: 'Create Account',
  confirm: 'Verify',
  forgot: 'Send Code',
  reset: 'Update Password',
};

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const region = useRegion();

  const go = (next, msg = '') => {
    setMode(next);
    setError('');
    setNotice(msg);
    setCode('');
  };

  const finishSignIn = async () => {
    await signIn(email, password);
    let { user } = await api.me();
    const pending = user.country ? null : takePendingRegion(email);
    if (pending) {
      try {
        const { profile } = await api.updateProfile({ display_name: user.display_name ?? '', ...pending });
        user = { ...user, country: profile.country, currency: profile.currency };
      } catch { /* the region setup screen asks instead */ }
    }
    onAuth(user);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'login') {
        try {
          await finishSignIn();
        } catch (err) {
          if (err.code !== 'UserNotConfirmedException') throw err;
          await resendCode(email);
          go('confirm', `Your email isn’t verified yet. We sent a new code to ${email}.`);
        }
      } else if (mode === 'register') {
        rememberRegion(email, region.country, region.currency);
        const { confirmed } = await signUp(email, password);
        if (confirmed) await finishSignIn();
        else go('confirm', `We sent a 6-digit code to ${email}.`);
      } else if (mode === 'confirm') {
        await confirmSignUp(email, code);
        await finishSignIn();
      } else if (mode === 'forgot') {
        await forgotPassword(email);
        go('reset', `If ${email} has an account, we sent a code to it.`);
      } else if (mode === 'reset') {
        await resetPassword(email, code, password);
        setPassword('');
        go('login', 'Password updated. Sign in with your new password.');
      }
    } catch (err) {
      setError(err.details?.[0] ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    try {
      await resendCode(email);
      setNotice(`We sent a new code to ${email}.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const showEmail = mode !== 'confirm';
  const showPassword = mode === 'login' || mode === 'register' || mode === 'reset';
  const showCode = mode === 'confirm' || mode === 'reset';

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center bg-ios-bg px-4">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-[22px] bg-gradient-to-b from-[#4cd964] to-[#1fa84a] text-5xl shadow-lg shadow-green-600/20">
          🧾
        </div>
        <h1 className="text-[28px] font-bold tracking-tight">LedgerAI</h1>
        <p className="mt-1 text-[15px] text-ios-secondary">Snap receipts. Understand your spending.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="ios-group">
          {showEmail && (
            <Field label="Email">
              <input type="email" required autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="ios-input" />
            </Field>
          )}
          {showCode && (
            <Field label="Code">
              <input required inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} className="ios-input" />
            </Field>
          )}
          {showPassword && (
            <Field label={mode === 'reset' ? 'New password' : 'Password'}>
              <input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Required" value={password} onChange={(e) => setPassword(e.target.value)} className="ios-input" />
            </Field>
          )}
        </div>
        {mode === 'register' && (
          <>
            <div className="ios-group"><RegionFields region={region} /></div>
            <p className="px-4 text-[13px] text-ios-secondary">Your country sets your currency for all receipts and reports. It can’t be changed after you sign up.</p>
          </>
        )}
        {(mode === 'register' || mode === 'reset') && <p className="px-4 text-[13px] text-ios-secondary">{PASSWORD_HINT}</p>}
        {notice && <p className="px-4 text-[13px] text-ios-secondary">{notice}</p>}
        {error && <p className="px-4 text-[13px] text-ios-red">{error}</p>}
        <button disabled={busy || (mode === 'register' && !region.complete)} className="ios-btn h-[50px] w-full rounded-[14px] bg-ios-blue text-[17px] font-semibold text-white disabled:opacity-50">
          {busy ? 'Please wait…' : SUBMIT_LABEL[mode]}
        </button>
      </form>

      <div className="mt-5 flex flex-col items-center gap-3 text-[15px] text-ios-blue">
        {mode === 'confirm' && <button onClick={resend} className="ios-btn">Resend code</button>}
        {mode === 'login' && COGNITO && <button onClick={() => go('forgot')} className="ios-btn">Forgot password?</button>}
        {mode === 'login' && <button onClick={() => go('register')} className="ios-btn">New here? Create Account</button>}
        {mode !== 'login' && <button onClick={() => go('login')} className="ios-btn">Back to Sign In</button>}
      </div>
    </div>
  );
}
