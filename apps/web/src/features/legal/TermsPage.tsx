import { Link } from 'react-router';
import { Bullets, LegalLayout, Section } from './LegalLayout';

/** Terms for using the app. Disputes: courts in Kerala, India. */
export default function TermsPage() {
  return (
    <LegalLayout title="Terms and conditions">
      <p>
        These terms apply to everyone who uses the Water Delivery app: business owners, their delivery staff and their clients. By creating an
        account or logging in, you agree to them.
      </p>

      <Section title="1. What the app does">
        <p>
          The app helps water-delivery businesses record orders, deliveries, empty cans, payments, credit and expenses. It is a record-keeping
          tool: no money is moved through the app. Amounts shown are what users have entered.
        </p>
      </Section>

      <Section title="2. Your account">
        <Bullets
          items={[
            'Keep your PIN to yourself. Anything done with your login is treated as done by you.',
            'Give correct details and keep your phone number up to date.',
            'Owners are responsible for the staff and client logins they create, and for turning them off when they are no longer needed.',
          ]}
        />
      </Section>

      <Section title="3. Business records">
        <Bullets
          items={[
            "Owners are responsible for the accuracy of what they and their staff record, and for having their clients' permission to store their details and contact them, including on WhatsApp.",
            'Owners remain responsible for their own accounts, invoices and taxes (such as GST). The app helps keep records but is not an accounting or tax service.',
            'Money and stock records are not deleted. Mistakes are corrected with a reversal or correction, which stays in the history.',
          ]}
        />
      </Section>

      <Section title="4. Acceptable use">
        <p>Do not:</p>
        <Bullets
          items={[
            'use the app for anything unlawful or to record false transactions;',
            "try to see another business's or another person's information;",
            'try to break, overload or get around the security of the app, or copy it with automated tools;',
            'share your login or create logins for people who are not part of your business.',
          ]}
        />
      </Section>

      <Section title="5. Availability">
        <p>
          The app is provided as it is and as available. It may sometimes be unavailable because of the internet, maintenance or problems with
          the services it runs on. Records made offline are saved on the phone and sent when it is back online. Backups are made daily, but
          businesses should also keep their own important records.
        </p>
      </Section>

      <Section title="6. Fees">
        <p>If the service is offered for a fee, the fee and how it is paid are agreed separately with the business.</p>
      </Section>

      <Section title="7. Responsibility">
        <p>
          As far as the law allows, the service is not responsible for indirect losses, lost profits or losses caused by wrong or incomplete
          information entered into the app, and its total responsibility for any claim is limited to the fees paid for the service in the three
          months before the claim.
        </p>
      </Section>

      <Section title="8. Suspending or closing accounts">
        <p>
          A login may be suspended if it is misused or puts other users at risk. Owners can turn off staff and client logins at any time, and can
          stop using the app whenever they choose.
        </p>
      </Section>

      <Section title="9. Privacy">
        <p>
          How information is handled is explained in the{' '}
          <Link to="/privacy" className="font-semibold text-brand-700">
            Privacy policy
          </Link>
          .
        </p>
      </Section>

      <Section title="10. Changes">
        <p>
          These terms may change as the app changes. The date above shows the latest version, and important changes will be announced in
          the app.
          Continuing to use the app after a change means you accept the new terms.
        </p>
      </Section>

      <Section title="11. Law and disputes">
        <p>These terms are governed by the laws of India. Any dispute will be handled by the courts in Kerala, India.</p>
      </Section>
    </LegalLayout>
  );
}
