const CONTACT_EMAIL = 'zengtian006@gmail.com';
const UPDATED = 'November 4, 2026';

const Section = ({ title, children }) => (
  <section className="mt-6">
    <h2 className="mb-2 text-[20px] font-semibold">{title}</h2>
    <div className="space-y-2 text-[16px] leading-relaxed">{children}</div>
  </section>
);

const List = ({ items }) => (
  <ul className="list-disc space-y-1 pl-5">
    {items.map((t) => <li key={t}>{t}</li>)}
  </ul>
);

export default function Privacy() {
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-10">
        <h1 className="text-[32px] font-bold leading-tight">LedgerAI Privacy Policy</h1>
        <p className="mt-1 text-[14px] text-ios-secondary">Last updated: {UPDATED}</p>

        <p className="mt-5 text-[16px] leading-relaxed">
          LedgerAI helps you track spending by scanning receipts. This policy explains what information the LedgerAI
          iOS app and website (www.ledgerai.click) collect, how it is used, and the choices you have.
        </p>

        <Section title="Information we collect">
          <List items={[
            'Account information: your email address and a password (handled by Amazon Cognito), plus an optional display name, country and preferred currency.',
            'Receipts you add: the receipt photo, and the details read from it, such as merchant, date, totals, tax, category and line items. You can edit these details.',
            'Budgets and settings you set in the app.',
            'Basic usage and diagnostic data: when you were last active and records of AI requests (type, success or failure, duration and token counts) used to operate and improve the service.',
          ]} />
          <p>We do not collect your precise location, contacts, advertising identifiers or payment card details.</p>
        </Section>

        <Section title="How we use your information">
          <List items={[
            'To provide the app: store your receipts, show analytics and reports, and let you export your data.',
            'To read receipts and write spending insights using AI (see “AI processing” below).',
            'To secure your account, prevent abuse and fix problems.',
          ]} />
          <p>We do not sell your data, share it for advertising, or track you across other companies’ apps and websites.</p>
        </Section>

        <Section title="AI processing">
          <p>
            When you scan a receipt, the image is sent to Google’s Gemini API to extract its details. To generate
            insights, a summary of your spending data is sent to the same service. This content is used only to return
            results to you.
          </p>
        </Section>

        <Section title="Device permissions">
          <List items={[
            'Camera: used only when you choose to photograph a receipt.',
            'Photos: used only for images you select to add as receipts.',
            'Face ID / Touch ID: used only on your device to lock the app. Biometric data never leaves your device and is not accessible to us.',
          ]} />
        </Section>

        <Section title="Where your data is stored">
          <p>
            Your data is stored on Amazon Web Services infrastructure (United States). Data is encrypted in transit
            using HTTPS, and receipt images are accessed through short-lived signed links. Service providers that
            process data on our behalf are Amazon Web Services and Google (Gemini).
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            We keep your data while your account is active. You can delete your account at any time from
            Account in the app or on the website. This permanently deletes your profile, receipts, line items,
            budgets, insights and stored receipt images. Anonymous, aggregate usage counts that cannot identify you may be kept.
            You can also delete individual receipts at any time.
          </p>
        </Section>

        <Section title="Your choices and rights">
          <p>
            You can view and edit your information in the app, export all your receipts as CSV, and delete your account.
            Depending on where you live, you may have additional rights to access, correct or erase your personal data
            {CONTACT_EMAIL ? '; contact us to exercise them' : ''}.
          </p>
        </Section>

        <Section title="Children">
          <p>LedgerAI is not directed to children under 13, and we do not knowingly collect their information.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>If we make material changes, we will update the date above and, where appropriate, notify you in the app.</p>
        </Section>

        {CONTACT_EMAIL && (
          <Section title="Contact">
            <p>Questions about this policy? Email <a className="text-ios-blue" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
          </Section>
        )}
      </main>
    </div>
  );
}
