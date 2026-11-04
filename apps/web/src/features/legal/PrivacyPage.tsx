import { Bullets, LegalLayout, Section } from './LegalLayout';

/** What the app stores, why, where, for how long, and people's rights (India: DPDP Act 2023). */
export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy policy">
      <p>
        Water Delivery is an app that water-delivery businesses use to keep their own records: clients, deliveries, empty cans, payments and
        expenses. It is used by business owners, their delivery staff and their clients (shops). This policy explains what information the app
        holds, why, and what you can do about it.
      </p>

      <Section title="Who is responsible for your information">
        <p>
          Each business decides what it records about its own clients and staff and is responsible for that information. The app stores and
          processes it on the business's behalf, only to provide the service. One business can never see another business's information.
        </p>
      </Section>

      <Section title="What the app stores">
        <Bullets
          items={[
            <>
              <b>Accounts:</b> name, phone number and, for owners, the business name and address. Your PIN is never stored, only a one-way
              scrambled version of it. If you turn on fingerprint / Face ID login or PIN recovery, the app stores the public key of that device or
              an encrypted recovery key.
            </>,
            <>
              <b>Client records</b> entered by a business: shop name, owner name, phone number, address, map link, prices, notes, and any login
              given to the client.
            </>,
            <>
              <b>Business records:</b> orders, deliveries, cans delivered and collected, damaged cans, payments and how they were made, balances,
              expenses, stock, and regular delivery schedules, with who recorded each one and when.
            </>,
            <>
              <b>Devices:</b> if you turn on notifications, a registration for your phone or browser so notifications can reach it; the type of
              device and browser you log in from.
            </>,
            <>
              <b>Security records:</b> login attempts and the network (IP) address they came from, used to stop people guessing PINs, and a log
              of sensitive changes such as reversed payments and stock corrections.
            </>,
            <>
              <b>Usage statistics:</b> which screens are opened and how fast they load, with the type of device, browser and country. These are
              collected without cookies and without your name or phone number.
            </>,
          ]}
        />
      </Section>

      <Section title="How it is used">
        <Bullets
          items={[
            'To run the service: show each person the records they are allowed to see and keep balances, cans and stock correct.',
            'To send notifications you have turned on, such as a new order, a delivery or a payment.',
            'To keep accounts safe: limit PIN attempts, detect misuse and keep a record of sensitive changes.',
            'To make backups, so records can be recovered after a fault.',
            'To find and fix problems and make the app faster.',
          ]}
        />
        <p>
          Your information is not sold, not used for advertising, and not used to send you marketing messages. Payment reminders and receipts
          are sent by the business owner from their own WhatsApp, only when they choose to.
        </p>
      </Section>

      <Section title="Where it is stored and who helps run the app">
        <Bullets
          items={[
            <>
              <b>Supabase</b> (database), in Mumbai, India.
            </>,
            <>
              <b>Vercel</b> (hosting, and the usage statistics above).
            </>,
            <>
              <b>Notification services</b> of Google (Firebase, Chrome), Apple and Mozilla, which receive only what is needed to deliver a
              notification to your device.
            </>,
            <>
              <b>GitHub</b>, which stores the daily database backup in a private repository for 14 days.
            </>,
          ]}
        />
        <p>
          These providers handle information only to provide their service to the app. Opening a location uses Google Maps, and sending a
          reminder uses WhatsApp; those apps have their own privacy policies.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          Records are kept while the business uses the app. Money and stock records are never edited or deleted, only corrected with a new
          entry, so the books always add up; this also keeps the history a business may need for its accounts and taxes. When a member of staff
          or a client login is removed, they can no longer log in, but the work already recorded stays in the business's records. Backups are
          kept for 14 days.
        </p>
      </Section>

      <Section title="How it is protected">
        <Bullets
          items={[
            'All connections are encrypted (HTTPS).',
            'PINs are stored only in scrambled form; recovery keys are encrypted.',
            'Every business sees only its own records; staff see only their own work; clients see only their own orders, payments and balance.',
            'Repeated wrong PINs lock the account for a while.',
          ]}
        />
      </Section>

      <Section title="Cookies">
        <p>
          The app uses one essential cookie to keep you logged in. It does not use advertising or tracking cookies. To work offline, it keeps
          a copy of recent information on your phone; logging out removes it.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Under India's Digital Personal Data Protection Act, 2023, you can ask to:</p>
        <Bullets
          items={[
            'see a summary of the personal information held about you;',
            'correct or complete it;',
            'erase it, except records the business must keep (for example, payments and deliveries);',
            'have a complaint about how it is handled addressed;',
            'nominate someone to act for you if you are unable to.',
          ]}
        />
        <p>
          Staff and clients: contact the business that gave you your login; it can correct most details in the app straight away. Business
          owners: contact the app support that gave you access to the service.
        </p>
      </Section>

      <Section title="Children">
        <p>The app is meant for businesses and their staff and is not intended for anyone under 18.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If this policy changes, the date above changes too, and important changes will be announced in the app.
        </p>
      </Section>
    </LegalLayout>
  );
}
