const CONTACT_EMAIL = 'zengtian006@gmail.com';

const Section = ({ title, children }) => (
  <section className="mt-6">
    <h2 className="mb-2 text-[20px] font-semibold">{title}</h2>
    <div className="space-y-2 text-[16px] leading-relaxed">{children}</div>
  </section>
);

export default function Support() {
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-10">
        <h1 className="text-[32px] font-bold leading-tight">LedgerAI Support</h1>
        <p className="mt-5 text-[16px] leading-relaxed">
          LedgerAI helps you track spending by scanning receipts. Need help or want to report a problem? We’re happy to assist.
        </p>

        <Section title="Contact us">
          <p>
            Email <a className="text-ios-blue" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We usually reply within two business days.
            Please include the email address of your account and, if relevant, your iPhone model and iOS version.
          </p>
        </Section>

        <Section title="Common questions">
          <p><strong>I didn’t get my verification code.</strong> Check your spam folder, then use “Resend code” on the verification screen.</p>
          <p><strong>I forgot my password.</strong> Tap “Forgot password?” on the sign-in screen and follow the emailed instructions.</p>
          <p><strong>A receipt was read incorrectly.</strong> Open the receipt and edit the merchant, date, category, totals or items, then tap Save.</p>
          <p><strong>Can I change my country or currency?</strong> They are set when you create your account and can’t be changed afterwards.</p>
          <p><strong>How do I export my data?</strong> Go to Account → Export All Receipts to get a CSV file.</p>
          <p><strong>How do I delete my account?</strong> Go to Account → Delete Account. This permanently deletes your profile, receipts and stored images.</p>
        </Section>

        <Section title="Privacy">
          <p>Read our <a className="text-ios-blue" href="/privacy">Privacy Policy</a>.</p>
        </Section>
      </main>
    </div>
  );
}
