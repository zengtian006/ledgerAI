import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { COGNITO, changePassword, reauthenticate } from '../auth.js';
import { downloadBlob, flag } from '../utils.js';
import { ChevronRight, DownloadIcon, LockIcon, ShieldIcon } from '../components/Icons.jsx';

const Row = ({ label, children }) => (
  <label className="flex min-h-[44px] items-center gap-3 px-4 py-[10px]">
    <span className="w-24 shrink-0 text-[17px]">{label}</span>
    {children}
  </label>
);
const valueCls = 'ios-input text-right text-ios-secondary focus:text-black';
const Footer = ({ children }) => <p className="px-4 pt-1.5 text-[13px] leading-[18px] text-ios-secondary">{children}</p>;

// Settings-style action row: coloured icon tile, title, trailing chevron
const NavRow = ({ icon: Icon, tint, children, as: Tag = 'button', ...props }) => (
  <Tag {...props} className="ios-press flex min-h-[44px] w-full items-center gap-3 px-4 py-[7px] text-left text-[17px] disabled:opacity-40">
    <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] text-white" style={{ background: tint }}>
      <Icon width={18} height={18} />
    </span>
    <span className="flex-1">{children}</span>
    <ChevronRight width={14} height={14} className="text-black/25" />
  </Tag>
);
const Stat = ({ value, label }) => (
  <div className="flex-1 text-center">
    <p className="text-[17px] font-semibold tabular-nums">{value}</p>
    <p className="text-[13px] text-ios-secondary">{label}</p>
  </div>
);

export default function Account({ user, onLogout, onProfileSaved }) {
  const [profile, setProfile] = useState(null);
  const [lists, setLists] = useState({ countries: [], currencies: [] });
  const [form, setForm] = useState({ display_name: user.display_name ?? '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'error', text }
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [pw, setPw] = useState({ old: '', next: '' });

  useEffect(() => {
    api.countries().then(setLists).catch(() => {});
    api.getProfile().then(({ profile: p }) => {
      setProfile(p);
      setForm({ display_name: p.display_name ?? '' });
    }).catch(() => {});
  }, []);

  const countryByCode = useMemo(() => new Map(lists.countries.map((c) => [c.code, c])), [lists]);
  const saved = profile ?? user;
  const country = countryByCode.get(saved.country);
  const dirty = form.display_name !== (saved.display_name ?? '');

  useEffect(() => { if (dirty) setNotice(null); }, [dirty]);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const { profile: p } = await api.updateProfile({ display_name: form.display_name });
      setProfile(p);
      onProfileSaved({ display_name: p.display_name });
      setNotice({ kind: 'ok', text: 'Saved' });
    } catch (e) {
      setNotice({ kind: 'error', text: e.details?.[0] ?? e.message });
    } finally {
      setSaving(false);
    }
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      downloadBlob(await api.exportCsv({}), 'ledgerai-all-receipts.csv');
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async (e) => {
    e.preventDefault();
    try {
      await reauthenticate(user.email, password);
      await api.deleteAccount(password);
      onLogout();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  };

  const updatePassword = async (e) => {
    e.preventDefault();
    try {
      await changePassword(pw.old, pw.next);
      setChangingPw(false);
      setPw({ old: '', next: '' });
      setNotice({ kind: 'ok', text: 'Password updated' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  };

  const name = form.display_name.trim();
  const initials = (name || user.email).slice(0, 1).toUpperCase();
  const memberSince = saved.created_at ? new Date(saved.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null;

  return (
    <div style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
      <h1 className="px-4 pb-2 pt-2 text-[34px] font-bold tracking-tight">Account</h1>
      <div className="space-y-6 px-4 pb-4">
        <div className="flex flex-col items-center pb-1 pt-2">
          <span className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-b from-[#a0a0a8] to-[#78787f] text-[40px] font-semibold text-white">{initials}</span>
          <p className="mt-3 max-w-full truncate text-[22px] font-semibold leading-7">{name || 'Your Name'}</p>
          <p className="max-w-full truncate text-[15px] text-ios-secondary">{user.email}</p>
          <div className="ios-card mt-5 flex w-full py-3">
            <Stat value={saved.receipt_count ?? '–'} label="Receipts" />
            {memberSince && <><span className="my-1 w-px bg-black/10" /><Stat value={memberSince} label="Member since" /></>}
          </div>
        </div>

        <section>
          <p className="ios-header">Personal</p>
          <div className="ios-group">
            <Row label="Name">
              <input value={form.display_name} maxLength={80} placeholder="Optional" autoComplete="name" onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={valueCls} />
            </Row>
          </div>
        </section>

        <section>
          <p className="ios-header">Region</p>
          <div className="ios-group">
            <Row label="Country"><span className="flex-1 truncate text-right text-ios-secondary">{country ? `${flag(country.code)} ${country.name}` : '–'}</span></Row>
            <Row label="Currency"><span className="flex-1 text-right text-ios-secondary">{saved.currency}</span></Row>
          </div>
          <Footer>Set when you signed up and can’t be changed.</Footer>
        </section>

        {(dirty || notice) && (
          <div className="space-y-2">
            {dirty && (
              <button onClick={save} disabled={saving} className="ios-btn h-[50px] w-full rounded-[14px] bg-ios-blue text-[17px] font-semibold text-white disabled:opacity-60">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            )}
            {notice && <p className={`px-4 text-center text-[15px] ${notice.kind === 'ok' ? 'text-ios-green' : 'text-ios-red'}`}>{notice.text}</p>}
          </div>
        )}

        <section>
          <p className="ios-header">Data</p>
          <div className="ios-group">
            <NavRow icon={DownloadIcon} tint="#34c759" onClick={exportAll} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export All Receipts (CSV)'}
            </NavRow>
          </div>
        </section>

        {COGNITO && (
          <section>
            <p className="ios-header">Security</p>
            {changingPw ? (
              <form onSubmit={updatePassword} className="space-y-2">
                <div className="ios-group">
                  <Row label="Current">
                    <input required type="password" autoComplete="current-password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} className={valueCls} />
                  </Row>
                  <Row label="New">
                    <input required minLength={8} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={valueCls} />
                  </Row>
                  <button className="ios-press w-full py-3 text-center text-[17px] font-semibold text-ios-blue">Update Password</button>
                  <button type="button" onClick={() => { setChangingPw(false); setPw({ old: '', next: '' }); }} className="ios-press w-full py-3 text-center text-[17px] text-ios-secondary">Cancel</button>
                </div>
                <Footer>At least 8 characters, with upper and lower case letters and a number.</Footer>
              </form>
            ) : (
              <div className="ios-group">
                <NavRow icon={LockIcon} tint="#8e8e93" onClick={() => setChangingPw(true)}>Change Password</NavRow>
              </div>
            )}
          </section>
        )}

        {user.is_admin && (
          <div className="ios-group">
            <NavRow as="a" href="/admin" icon={ShieldIcon} tint="#007aff">Admin Dashboard</NavRow>
          </div>
        )}

        <div className="ios-group">
          <button onClick={onLogout} className="ios-press w-full py-3 text-center text-[17px] text-ios-red">Sign Out</button>
        </div>

        <section>
          {deleting ? (
            <form onSubmit={deleteAccount} className="space-y-2">
              <div className="ios-group">
                <Row label="Password">
                  <input autoFocus required type="password" autoComplete="current-password" placeholder="Confirm" value={password} onChange={(e) => setPassword(e.target.value)} className={valueCls} />
                </Row>
                <button className="ios-press w-full py-3 text-center text-[17px] font-semibold text-ios-red">Delete Account Permanently</button>
                <button type="button" onClick={() => { setDeleting(false); setPassword(''); }} className="ios-press w-full py-3 text-center text-[17px] text-ios-blue">Cancel</button>
              </div>
              <Footer>This deletes your account, all receipts and their images. It can’t be undone.</Footer>
            </form>
          ) : (
            <div>
              <button onClick={() => setDeleting(true)} className="ios-btn mx-auto block py-2 text-[15px] text-ios-red">Delete Account…</button>
            </div>
          )}
        </section>

        <p className="px-4 text-center text-[13px] text-ios-secondary">Receipts are processed with Google Gemini.</p>
      </div>
    </div>
  );
}
