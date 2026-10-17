// Builds docs/testing/Water-Delivery-Test-Plan.pdf: business and technical test cases for a
// manual tester. Run: npm run docs:test-plan
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const APP_URL = 'https://project-h2-o-ten.vercel.app';

/* ────────────────────────────── Test cases ────────────────────────────── */
// Each case: { id, title, role, priority, pre, steps[], expected[] }. Keep steps one action each.

const businessCases = [
  {
    group: 'Getting a business started',
    cases: [
      {
        id: 'BU-01',
        title: 'A new owner sets up their business',
        role: 'Owner',
        priority: 'High',
        pre: 'A phone number that has never been used in the app.',
        steps: [
          `Open ${APP_URL} on the phone and tap "Create an account".`,
          'Enter business name, your name and phone number; tap Continue.',
          'Enter a 6-digit PIN twice and finish.',
          'If offered Face ID / fingerprint, tap "Not now".',
          'Go to More → Products → + Add: "20L can", 20 litres, returnable, deposit 150. Save.',
          'Add a second product "1L bottle crate", not returnable.',
          'More → Inventory → 20L can → Add stock: 100 filled, 20 empty. Save.',
        ],
        expected: [
          'You land on the Home screen with the business name at the top.',
          'Both products are listed in Products; the crate shows "Not returned".',
          'Inventory shows 20L can: Filled 100, Empty 20, With clients 0, Damaged 0.',
          'Home → Cans shows Filled 100, Empty 20.',
        ],
      },
      {
        id: 'BU-02',
        title: 'Moving clients over from the paper notebook',
        role: 'Owner',
        priority: 'High',
        pre: 'BU-01 done.',
        steps: [
          'Clients → + Add. Name "Sri Ganesh Stores", type Store, price 20L can ₹40, crate ₹120, phone 98470 11111.',
          'Under "Cans already at this client" set 20L can = 6.',
          'Open "Already supplying this client?" and enter ₹350 they already owe.',
          'Tap "Add client".',
          'Add "Anitha Menon", type Home, price 20L can ₹45 (no old balance or cans).',
          'Add "City Hospital", type Other, type the word "Hospital", credit limit ₹500.',
        ],
        expected: [
          'Sri Ganesh shows Owes ₹350 and 6 cans with client; its Money history has "Opening balance ₹350"; Cans history has "Opening count +6".',
          'Inventory → With clients for 20L can goes up by 6 (filled/empty do not change).',
          'Anitha shows Settled and 0 cans; City Hospital shows type "Hospital".',
          'The second client form already had the first client\'s prices filled in.',
        ],
      },
      {
        id: 'BU-03',
        title: 'Adding delivery staff and giving them their login',
        role: 'Owner, Staff',
        priority: 'High',
        pre: 'BU-01 done. A second phone (or a private browser window) for the staff member.',
        steps: [
          'More → Delivery staff → + Add. Name "Raju", phone 96000 00001; keep the suggested PIN (note it).',
          'Tap "Add staff" and read the share screen.',
          'On the second phone log in with Raju\'s phone and PIN.',
        ],
        expected: [
          'Raju appears in Delivery staff with 0 deliveries today.',
          'Raju\'s app opens on "Hi Raju" (Today screen), with bottom bar Today · Clients · + · Expenses · More.',
          'Raju cannot see Reports, Inventory, Cash flow, Payments, Products or Delivery staff anywhere.',
        ],
      },
    ],
  },
  {
    group: 'A normal delivery day',
    cases: [
      {
        id: 'BU-04',
        title: 'Owner plans the day: orders for later, given to staff',
        role: 'Owner, Staff',
        priority: 'High',
        pre: 'BU-02, BU-03 done. Notifications turned on for Raju\'s phone (see TC-NOTIF-01).',
        steps: [
          'Tap + → choose "City Hospital" → switch to "For later".',
          'Set 20L can = 10, When = Today, Delivered by = Raju, note "Back gate". Tap "Create order".',
          'Create another for "Anitha Menon": 2 cans, Tomorrow, Delivered by = Raju.',
          'Open Orders → Pending.',
        ],
        expected: [
          'Both orders are listed with status Confirmed and "Raju" shown.',
          'Raju\'s phone gets a notification for the order(s) given to him.',
          'Raju\'s Today screen lists City Hospital under "To deliver" (today\'s order). Tomorrow\'s order is not shown today.',
          'No money or cans change until delivery: client balances and Inventory are unchanged.',
        ],
      },
      {
        id: 'BU-05',
        title: 'Staff delivers an assigned order with empties and part payment',
        role: 'Staff, Owner',
        priority: 'High',
        pre: 'BU-04 done.',
        steps: [
          'On Raju\'s phone, Today → City Hospital → Deliver.',
          'Check 20L can shows 10 (ordered). Set empties collected = 8.',
          'Payment: Part paid, amount ₹200, Cash.',
          'Tap "Confirm delivery".',
          'On the owner\'s phone keep the Home screen open while Raju confirms.',
        ],
        expected: [
          'Raju sees the Delivered screen with the order number, Total ₹(10 × hospital price), Paid ₹200, Empties 8.',
          'Owner Home updates by itself within about 10 seconds: Orders, Sales, Cans delivered, Collected today change.',
          'City Hospital: balance increases by total − ₹200; cans with client +2 (10 out, 8 back).',
          'Inventory: Filled −10, Empty +8, With clients +2.',
          'Raju\'s Today: Deliveries 1, Cans 10, Collected ₹200, Cash to hand over ₹200; the order leaves "To deliver".',
        ],
      },
      {
        id: 'BU-06',
        title: 'Quick delivery at the door: paid in full, UPI',
        role: 'Owner or Staff',
        priority: 'High',
        pre: 'BU-02 done.',
        steps: [
          'Tap + → search "Anitha" (try typing just "ani" — the list filters as you type).',
          'Deliver now: 20L can = 2; empties = tap "Same as delivered (2)".',
          'Payment: Paid full, UPI. Confirm.',
          'Tap "Send receipt on WhatsApp".',
        ],
        expected: [
          'Total ₹90 (2 × ₹45); Anitha\'s balance stays Settled; cans with client unchanged (2 out, 2 back).',
          'WhatsApp opens with a receipt to Anitha\'s number listing cans, empties, total, paid and balance.',
          'More → Payments lists ₹90 UPI for Anitha.',
        ],
      },
      {
        id: 'BU-07',
        title: 'Credit delivery and a client over their credit limit',
        role: 'Owner',
        priority: 'High',
        pre: 'City Hospital has credit limit ₹500 (BU-02).',
        steps: [
          '+ → City Hospital → Deliver now: enough cans that the bill takes them over ₹500. Payment: Credit.',
          'Look at the summary before confirming, then confirm.',
        ],
        expected: [
          'A warning "Over this client\'s credit limit of ₹500." is shown; you can still confirm.',
          '"Added to credit" equals the whole bill; client balance after = old balance + bill.',
          'Home → Credit given today increases by the bill.',
        ],
      },
      {
        id: 'BU-08',
        title: 'Paying more than the bill clears older dues',
        role: 'Owner',
        priority: 'High',
        pre: 'Sri Ganesh owes ₹350 (BU-02).',
        steps: ['+ → Sri Ganesh → 20L can = 5 (₹200). Part paid: ₹550 Cash. Confirm.'],
        expected: [
          'Summary before confirming shows the client balance after = ₹0 (350 + 200 − 550).',
          'Sri Ganesh shows Settled. Money history shows the sale +₹200 and the payment −₹550 with running balances.',
          'Cash flow (Today) shows ₹200 as "Water sales" and ₹350 as "Old dues collected".',
        ],
      },
      {
        id: 'BU-09',
        title: 'Damaged cans handed back are charged to the client',
        role: 'Owner or Staff',
        priority: 'High',
        pre: 'Sri Ganesh has cans with them.',
        steps: [
          '+ → Sri Ganesh → 20L can = 4, empties = 1.',
          'Tap "Some cans came back damaged" → Damaged 20L can = 2.',
          'Try to confirm without a charge; then enter Charge per damaged can = ₹150. Credit. Confirm.',
        ],
        expected: [
          'Without a charge the app says "Enter what the client pays for each damaged 20L can."',
          'Total = 4 × ₹40 + 2 × ₹150 = ₹460; summary shows "Includes 2 damaged cans ₹300".',
          'Cans with client: +4 −1 −2 = +1. Inventory: Damaged +2, Empty +1.',
          'Money history has a separate line "2 damaged 20L can". Cans history has "Damaged cans taken back".',
        ],
      },
      {
        id: 'BU-10',
        title: 'Collecting empties and old dues without a delivery',
        role: 'Owner or Staff',
        priority: 'High',
        pre: 'A client who owes money and holds cans.',
        steps: [
          'Clients → open the client → Empties → enter 3 → Save.',
          'Payment → tap "Full balance" (or type an amount) → Cash → Save payment.',
        ],
        expected: [
          'Cans with client −3; Inventory Empty +3, With clients −3.',
          'Balance goes down by the payment; Cash flow shows "Old dues collected".',
          'If done by staff: appears in their Today under "What you did today" and in Cash to hand over.',
        ],
      },
      {
        id: 'BU-11',
        title: 'Staff expense and end-of-day cash handover',
        role: 'Staff, Owner',
        priority: 'High',
        pre: 'Raju has collected cash today (BU-05).',
        steps: [
          'On Raju\'s phone: Expenses → + Add → Fuel → ₹100 → Cash → Save.',
          'Raju reads "Cash to hand over" on Today.',
          'Owner: More → Delivery staff → Raju.',
        ],
        expected: [
          'Cash to hand over = cash collected − cash spent (e.g. ₹200 − ₹100 = ₹100). UPI collections are shown but not counted as cash.',
          'Owner sees the same figure, "Staff expense ₹100", and the list of what Raju did today.',
          'The next morning Raju\'s Today starts at zero again; the owner still sees yesterday in reports.',
        ],
      },
      {
        id: 'BU-12',
        title: 'Refilling empties at the plant',
        role: 'Owner',
        priority: 'High',
        pre: 'Inventory has empties.',
        steps: ['More → Inventory → 20L can → Refill → 20 → Save.'],
        expected: ['Filled +20, Empty −20. Today\'s movements list shows the refill.'],
      },
    ],
  },
  {
    group: 'Clients using their own app',
    cases: [
      {
        id: 'BU-13',
        title: 'Giving a client app access; client orders water',
        role: 'Owner, Client',
        priority: 'High',
        pre: 'A third phone for the client.',
        steps: [
          'Owner: open Sri Ganesh → scroll to Client app → Give access → phone 98460 44444 and a 6-digit PIN.',
          'Client phone: log in with that phone and PIN; turn on notifications (Account → Notifications).',
          'Client: Order water → 20L can 8 → Today → note "Before 10am" → Send order.',
          'Owner: Orders → Pending → open the order → Accept → Out for delivery → Deliver → confirm.',
        ],
        expected: [
          'Client home shows Owes / Settled, Cans with you, recent orders and payments.',
          'Owner\'s phone gets "new order" notification; order shows as Pending, then Confirmed.',
          'Client gets notifications when accepted/on the way and when delivered (with new balance).',
          'Client\'s My orders shows the order as delivered with the paid status; Statement shows the sale.',
        ],
      },
      {
        id: 'BU-14',
        title: 'Client cancels before the supplier accepts; cannot after',
        role: 'Client, Owner',
        priority: 'Medium',
        pre: 'BU-13 done.',
        steps: [
          'Client places a new order and immediately opens it → Cancel order.',
          'Client places another; owner taps Accept; client tries to cancel.',
        ],
        expected: [
          'First order: cancelled; owner gets a "client cancelled" notification.',
          'After Accept the client sees: "Your supplier has already accepted this order. Please call them to change it."',
        ],
      },
      {
        id: 'BU-15',
        title: 'Payment reminder to a client who owes money',
        role: 'Owner, Client',
        priority: 'Medium',
        pre: 'Client with app access owes money; client notifications on.',
        steps: ['Owner: open the client → "Send payment reminder".'],
        expected: [
          'Client phone receives a payment reminder that opens the Statement.',
          'If the client has notifications off, the owner is told to call or WhatsApp instead.',
        ],
      },
    ],
  },
  {
    group: 'Mistakes and changes',
    cases: [
      {
        id: 'BU-16',
        title: 'Cancelling a delivery entered for the wrong client',
        role: 'Owner',
        priority: 'High',
        pre: 'A delivered order with a cash payment.',
        steps: ['Orders → open the order → Cancel delivery → give a reason → confirm.'],
        expected: [
          'Status becomes Cancelled with the reason shown.',
          'The sale is removed from the client balance; cans and stock go back to before the delivery.',
          'The cash really received stays on the client\'s account (counts against their dues).',
          'Nothing is erased: the order and its history still show, marked cancelled.',
        ],
      },
      {
        id: 'BU-17',
        title: 'Reversing a payment and an expense entered by mistake',
        role: 'Owner',
        priority: 'High',
        pre: 'A recorded payment and an expense.',
        steps: [
          'More → Payments → open the payment → Reverse payment → confirm.',
          'More → Cash flow & expenses → open the expense → Reverse entry → confirm.',
        ],
        expected: [
          'Client balance goes back up by the payment; the payment shows as reversed.',
          'The expense is cancelled out by an opposite entry; totals return to before.',
          'Payments that came from client payments cannot be reversed from Cash flow (only from Payments).',
        ],
      },
      {
        id: 'BU-18',
        title: 'Correcting cans at a client after a physical count',
        role: 'Owner',
        priority: 'High',
        pre: 'A client holding cans.',
        steps: ['Open the client → next to Cans with client tap Correct → enter the real count → Review change → Confirm.'],
        expected: [
          'The review shows "old → new". After confirming, the client shows the new count.',
          'Cans history has a correction line "corrected from X to Y". Inventory With clients changes by the difference.',
          'Staff do not see the Correct button.',
        ],
      },
      {
        id: 'BU-19',
        title: 'Price change for one client',
        role: 'Owner',
        priority: 'Medium',
        pre: 'A client with past orders.',
        steps: ['Open the client → pencil ✎ → change the 20L can price → Save. Deliver to them again.'],
        expected: [
          'The new delivery uses the new price.',
          'Past orders keep the old price and old totals.',
        ],
      },
      {
        id: 'BU-20',
        title: 'Delivering more than was ordered',
        role: 'Staff or Owner',
        priority: 'High',
        pre: 'An order for 10 cans.',
        steps: ['Deliver it with 20L can = 15.'],
        expected: [
          'Bill is for 15 cans.',
          'Orders list shows "15 cans"; order page shows "15 × 20L can" with "ordered 10".',
          'Client app and staff day show 15.',
        ],
      },
      {
        id: 'BU-21',
        title: 'Partial delivery, then the rest',
        role: 'Staff or Owner',
        priority: 'Medium',
        pre: 'An order for 10 cans.',
        steps: ['Deliver 6. Open the order again. Deliver the remaining 4.'],
        expected: [
          'After 6: status Partly delivered, bill for 6, order page "6 delivered so far".',
          'After 4 more: Delivered, bill for 10.',
        ],
      },
      {
        id: 'BU-22',
        title: 'A member of staff leaves',
        role: 'Owner',
        priority: 'High',
        pre: 'Raju has an open order given to him and past deliveries.',
        steps: [
          'Delivery staff → Raju → Turn off (and later: Turn login back on).',
          'Then Delivery staff → Raju → Delete Raju → Delete.',
        ],
        expected: [
          'Turn off: Raju is logged out and can\'t log in; his open order comes back unassigned.',
          'Delete: Raju disappears from the staff list; his phone can be used to add a new staff member.',
          'Reports and order history still show Raju\'s past deliveries under his name.',
        ],
      },
      {
        id: 'BU-23',
        title: 'Stock goes below zero because refills were not recorded',
        role: 'Owner',
        priority: 'High',
        pre: 'Inventory with few filled cans and many empties.',
        steps: [
          'Deliver more filled cans than Inventory shows (e.g. Filled 5, deliver 11, collect empties).',
          'Open More → Inventory.',
          'Tap "Record refill of N empties" → Save.',
        ],
        expected: [
          'The delivery is still saved (real deliveries are never refused); Home shows a stock warning.',
          'Inventory explains "N more filled cans went out than the app knows you had" with fixes.',
          'The refill amount is pre-filled; after saving, Filled is back to 0 and the warning is gone.',
        ],
      },
    ],
  },
  {
    group: 'Reports and month end',
    cases: [
      {
        id: 'BU-24',
        title: 'Business summary for different periods, PDF and CSV',
        role: 'Owner',
        priority: 'High',
        pre: 'Several days of deliveries, payments and expenses.',
        steps: [
          'More → Reports → Business summary. Switch 7 days / 1 month / 3 months / 1 year.',
          'Tap Download PDF; open it. Tap Download CSV; open it in Excel or Google Sheets.',
        ],
        expected: [
          'Sales, Collected and Cans delivered match the Daily sales report for the same dates.',
          '"Owed to you" matches the Who owes money report total.',
          'PDF: A4 pages, business name, dates, every section, page numbers; ₹ and Malayalam/Hindi names display correctly.',
          'CSV opens with ₹ and names readable; one row per figure with a Section column.',
        ],
      },
      {
        id: 'BU-25',
        title: 'Other reports',
        role: 'Owner',
        priority: 'Medium',
        pre: 'Data from earlier cases.',
        steps: [
          'Daily sales (Last 7 days / This month / Last month), Monthly sales, Who owes money, Cans with clients, Stock movement, Payments received, Cash flow.',
          'Download each CSV.',
        ],
        expected: [
          'Who owes money lists only clients with dues, biggest first, with last paid date and WhatsApp button.',
          'Stock movement: Opening + movements = Closing for each product; Closing equals Inventory.',
          'Sum of a day\'s payments in Payments received equals Collected for that day in Daily sales.',
        ],
      },
    ],
  },
  {
    group: 'Login trouble and phones',
    cases: [
      {
        id: 'BU-26',
        title: 'Owner forgets the PIN and resets it with the authenticator',
        role: 'Owner',
        priority: 'High',
        pre: 'Google Authenticator (or Microsoft Authenticator / Authy) on the phone.',
        steps: [
          'More → Login & security → Set up PIN recovery → enter PIN → Continue.',
          'Tap "Open in authenticator app" (or copy the setup key and add it by hand: + → Enter setup key → Time-based).',
          'Come back, enter the 6-digit code → Verify and turn on. Download the recovery codes; tick "I\'ve saved…"; Done.',
          'Log out. Login → Forgot PIN? → phone → Authenticator app → current code → new PIN twice → Save.',
          'Log in with the new PIN.',
        ],
        expected: [
          'Setup shows issuer "Water Delivery", account = phone number, setup key in groups of 4, Type Time-based.',
          '10 recovery codes shown once; Login & security then shows "On · 10 recovery codes left".',
          'After the reset: "PIN changed", every device logged out; the old PIN no longer works.',
        ],
      },
      {
        id: 'BU-27',
        title: 'Staff member forgets the PIN',
        role: 'Owner, Staff',
        priority: 'Medium',
        pre: 'Staff member exists.',
        steps: ['Owner: Delivery staff → person → Reset PIN → share the new PIN.'],
        expected: ['Staff is logged out everywhere; logs in with the new PIN.'],
      },
      {
        id: 'BU-28',
        title: 'A day with no signal',
        role: 'Staff',
        priority: 'High',
        pre: 'Staff logged in; app opened once online.',
        steps: [
          'Turn on Airplane mode. Open the app from its icon.',
          'Record a delivery, a payment and an expense.',
          'Turn Airplane mode off and wait.',
        ],
        expected: [
          'App opens; banner "You\'re offline. Showing saved information."; clients and balances visible.',
          'Each entry is accepted; a bar says "N entries saved on this phone, waiting to sync".',
          'Back online: entries send by themselves; Waiting to sync shows "Everything is synced"; the owner sees them; nothing is duplicated.',
        ],
      },
    ],
  },
];

const technicalCases = [
  {
    group: 'Login, sessions and security (TC-AUTH)',
    cases: [
      { id: 'TC-AUTH-01', title: 'Signup validation', priority: 'High', steps: ['Try: empty business name; 1-letter name; 9-digit phone; PIN 5 digits; PINs that differ; a phone already registered.'], expected: ['Each shows a clear message next to the field; duplicate phone says it is already registered.'] },
      { id: 'TC-AUTH-02', title: 'Wrong PIN lockout', priority: 'High', steps: ['Enter a wrong PIN 5 times for one phone.', 'Try the right PIN.'], expected: ['Each wrong try: "Phone number or PIN is incorrect."', 'After 5: "Too many wrong PINs. Try again in 15 minutes." even with the right PIN; works after the wait.'] },
      { id: 'TC-AUTH-03', title: 'Unknown phone looks the same as a wrong PIN', priority: 'High', steps: ['Log in with a phone that has no account.'], expected: ['Same message as a wrong PIN ("Phone number or PIN is incorrect.").'] },
      { id: 'TC-AUTH-04', title: 'Staying logged in and logging out', priority: 'High', steps: ['Log in; close the app fully; reopen.', 'More → Log out; press Back.'], expected: ['Still logged in after reopening.', 'After logout the app shows Login; Back does not show private screens.'] },
      { id: 'TC-AUTH-05', title: 'Change PIN signs out other devices', priority: 'High', pre: 'Same account logged in on two phones.', steps: ['Phone A: Login & security → Change PIN (current + new).', 'Use phone B.'], expected: ['Phone A shows "PIN changed. Other devices were logged out."', 'Phone B is sent to Login. New PIN must differ from the current one.'] },
      { id: 'TC-AUTH-06', title: 'Face ID / fingerprint', priority: 'Medium', steps: ['After a PIN login accept the Face ID/fingerprint offer.', 'Log out; tap "Log in with Face ID/fingerprint".', 'Login & security → remove the device.'], expected: ['Biometric login works; after removing the device the button no longer works and PIN is needed.'] },
      { id: 'TC-AUTH-07', title: 'PIN recovery: setup survives the app reloading', priority: 'High', steps: ['Start setup; after the key appears, switch to the authenticator app and back (or pull to refresh / close and reopen).'], expected: ['The page shows "Finish setting up" with the code box; "Show the setup key again" shows the SAME key; codes from the authenticator work.'] },
      { id: 'TC-AUTH-08', title: 'PIN recovery: wrong, expired and reused codes', priority: 'High', steps: ['In setup enter 000000.', 'In Forgot PIN use a recovery code; later try the same code again.', 'Enter 5 wrong codes for one phone in Forgot PIN.', 'Start a reset and wait 15 minutes before entering the code.'], expected: ['Wrong code: clear message, can retry.', 'Used recovery code: refused the second time.', 'After 5 wrong: "Too many wrong codes. Try again in N minutes."', 'Waiting too long: "This PIN reset has expired. Please start again."'] },
      { id: 'TC-AUTH-09', title: 'PIN recovery: no account information leaks', priority: 'High', steps: ['Forgot PIN with a phone that has no account (or has no recovery set up); enter a code.'], expected: ['Same screens and messages as for a real account; nothing says the account does not exist.'] },
      { id: 'TC-AUTH-10', title: 'PIN recovery: replace, new codes, turn off', priority: 'Medium', steps: ['Login & security → New recovery codes (PIN + code).', 'Replace authenticator app (PIN + current code) and verify the new one.', 'Turn off PIN recovery (PIN + code).'], expected: ['Old recovery codes stop working after new ones are made.', 'Old authenticator codes stop working after replacing.', 'Turning off needs both PIN and code; afterwards Forgot PIN cannot succeed.'] },
      { id: 'TC-AUTH-11', title: 'New PIN rules in the reset', priority: 'High', steps: ['In the "Choose a new PIN" step try: 5 digits; two different PINs; the old PIN; then a valid new one. Use Show/Hide.'], expected: ['Messages: "PIN must be exactly 6 digits", "The two PINs are different", "Choose a new PIN, not the one you had before." Show/Hide reveals digits.'] },
    ],
  },
  {
    group: 'Who can see what (TC-ACCESS)',
    cases: [
      { id: 'TC-ACCESS-01', title: 'Staff cannot open owner screens', priority: 'High', steps: ['As staff, type these addresses after the app address: /reports, /inventory, /cashflow, /payments, /stores/new, /staff, /products.', 'Open a client page.'], expected: ['Owner-only addresses show "This page doesn\'t exist". Staff see client balance and cans but no Money/Cans history, no edit pencil, no Client app section, no Correct button.'] },
      { id: 'TC-ACCESS-02', title: 'Staff see only their own day', priority: 'High', steps: ['Two staff members each record work. Each opens Today and Clients.'], expected: ['Each sees only their own deliveries, payments and expenses for today; orders given to the other are not shown.'] },
      { id: 'TC-ACCESS-03', title: 'A client sees only their own data', priority: 'High', steps: ['As a client open an order link that belongs to another client (copy the address from the owner\'s phone).'], expected: ['Not found / no data. Statement, orders and payments show only their own.'] },
      { id: 'TC-ACCESS-04', title: 'Two businesses never see each other', priority: 'High', pre: 'Two owner accounts (two businesses).', steps: ['From business B open addresses of business A\'s client, order and staff pages.'], expected: ['Not found for every one. Lists and reports of B never show A\'s data.'] },
      { id: 'TC-ACCESS-05', title: 'Logged out', priority: 'High', steps: ['Log out, then open a private page address such as /stores or /reports directly.'], expected: ['Redirected to Login.'] },
    ],
  },
  {
    group: 'Money and calculations (TC-CALC)',
    cases: [
      { id: 'TC-CALC-01', title: 'Bill, paid and credit for each payment type', priority: 'High', steps: ['For one client price ₹40, deliver 5 cans with: Paid full; Part paid ₹100; Credit; Part paid ₹300 when they already owe ₹150.'], expected: ['Totals ₹200 each. Added to credit: ₹0 / ₹100 / ₹200 / ₹0, and the ₹300 case clears ₹100 of old dues (balance after = old + 200 − 300).'] },
      { id: 'TC-CALC-02', title: 'Decimals and rounding', priority: 'Medium', steps: ['Set a price of ₹33.33 and deliver 3 cans; pay ₹50.50.'], expected: ['Total ₹99.99; credit ₹49.49; no rounding drift in balance or reports.'] },
      { id: 'TC-CALC-03', title: 'Client balance always equals its history', priority: 'High', steps: ['After several deliveries, payments, reversals: compare the client balance with the last running balance in Money history.'], expected: ['They are identical. Owes / Advance shown correctly (Advance after over-payment).'] },
      { id: 'TC-CALC-04', title: 'First sale of a product the client has no price for', priority: 'Medium', steps: ['Add a new product; deliver it to an existing client.'], expected: ['Delivery screen asks "Price per … for this client" once; the price is saved for that client for next time.'] },
      { id: 'TC-CALC-05', title: 'Staff cash to hand over', priority: 'High', steps: ['Staff: cash payments ₹500 + UPI ₹300; cash expense ₹100; UPI expense ₹50.'], expected: ['Cash to hand over = ₹400 (500 − 100). UPI is shown separately and not counted.'] },
      { id: 'TC-CALC-06', title: 'Dashboard figures', priority: 'High', steps: ['Compare Home → Today/Money with Daily sales (today), Payments (today), Cash flow (today).'], expected: ['Sales, Collected today, Expenses today and Net cash today match the reports.'] },
    ],
  },
  {
    group: 'Cans and stock (TC-STOCK)',
    cases: [
      { id: 'TC-STOCK-01', title: 'Cans-with-client formula', priority: 'High', steps: ['New client with 6 cans already there; deliver 10 with 7 empties; collect 2 empties later; take back 1 damaged.'], expected: ['Cans with client = 6 + 10 − 7 − 2 − 1 = 6.'] },
      { id: 'TC-STOCK-02', title: 'Every container is accounted for', priority: 'High', steps: ['Note Filled + Empty + With clients + Damaged. Do deliveries, returns, refill, damage. Recount.'], expected: ['The total only changes with Add stock (up) or Lost (down).'] },
      { id: 'TC-STOCK-03', title: 'More empties than the client has', priority: 'Medium', steps: ['Enter empties collected greater than (cans held + delivered).'], expected: ['Warning "More cans back than recorded at this client…"; can still save.'] },
      { id: 'TC-STOCK-04', title: 'Inventory actions', priority: 'High', steps: ['Add stock (filled/empty); Refill more than available empties; Damaged/lost from Empty and from Filled; Correct count without a reason, then with a reason.'], expected: ['Refill more than empties is refused. Correct count needs a reason and shows a review step. Each action appears in Today\'s movements.'] },
      { id: 'TC-STOCK-05', title: 'Non-returnable products', priority: 'Medium', steps: ['Deliver bottle crates; try entering empties for crates.'], expected: ['Crates reduce Filled but never add cans with client; no empties/damaged fields for crates.'] },
      { id: 'TC-STOCK-06', title: 'Low stock alert', priority: 'Low', pre: 'Owner notifications on.', steps: ['Deliver until Filled drops below 10.'], expected: ['Owner gets a "running low" notification; Home Filled shows in warning colour.'] },
    ],
  },
  {
    group: 'Duplicates, double taps and offline (TC-SYNC)',
    cases: [
      { id: 'TC-SYNC-01', title: 'Double tap on Confirm', priority: 'High', steps: ['On a slow connection tap "Confirm delivery" twice quickly.'], expected: ['Only one order is created; the button shows a spinner and cannot be pressed again.'] },
      { id: 'TC-SYNC-02', title: 'Offline entries sync exactly once', priority: 'High', steps: ['Offline: record a quick delivery, an order delivery, a payment, empties, an expense; as a client place an order. Go online; also force-close and reopen the app before going online.'], expected: ['All entries arrive once each, with the time they were recorded. Order numbers appear after sync.'] },
      { id: 'TC-SYNC-03', title: 'Entry rejected by the server', priority: 'Medium', steps: ['Offline: deliver to a client; meanwhile the owner deactivates that client; go online.'], expected: ['The entry shows as failed in Waiting to sync with the reason, and "Try again" / "Discard" buttons (Discard asks to confirm). Nothing is lost silently.'] },
      { id: 'TC-SYNC-04', title: 'Live updates on the owner phone', priority: 'Medium', steps: ['Owner keeps Home, Clients or Inventory open while staff deliver.'], expected: ['Numbers update within about 10 seconds without refreshing.'] },
    ],
  },
  {
    group: 'Notifications (TC-NOTIF)',
    cases: [
      { id: 'TC-NOTIF-01', title: 'Turn on and test (Android, installed app)', priority: 'High', steps: ['Open the installed app from its icon → More → Notifications → Turn on → Allow → Send a test.'], expected: ['A test notification appears within a few seconds, even with the app closed. If not, follow the on-screen Android checklist (Chrome notifications allowed, battery Unrestricted) and test again.'] },
      { id: 'TC-NOTIF-02', title: 'Turn on (iPhone)', priority: 'High', steps: ['In Safari (not installed) open Notifications.', 'Add to Home Screen, open from the icon, turn on.'], expected: ['Before installing: "Add the app to your Home Screen first". After: works like Android.'] },
      { id: 'TC-NOTIF-03', title: 'Who gets what', priority: 'High', steps: ['Trigger each: client places an order; client cancels; owner gives an order to staff; delivery to a client with app; payment recorded for that client; payment reminder; stock below 10.'], expected: ['Owner: new client order, client cancel, low stock. Staff: order given to them. Client: accepted/on the way, delivered with balance, payment received, reminder. Tapping a notification opens the right screen.'] },
      { id: 'TC-NOTIF-04', title: 'Shared phone and logout', priority: 'Medium', steps: ['Turn on notifications as owner; log out; log in as staff on the same phone.'], expected: ['After logout the owner\'s notifications stop on that phone; staff notifications work after they turn them on.'] },
      { id: 'TC-NOTIF-05', title: 'Blocked permission', priority: 'Low', steps: ['Block notifications for the site in browser settings; open Notifications.'], expected: ['Shows "Blocked" with how to allow them.'] },
    ],
  },
  {
    group: 'Installed app and phone behaviour (TC-PWA)',
    cases: [
      { id: 'TC-PWA-01', title: 'Install on Android (Chrome)', priority: 'High', steps: ['Open the site in Chrome; use the app\'s Install prompt or Chrome menu → Install app.'], expected: ['Icon on the home screen; opens full screen without the Chrome address bar.'] },
      { id: 'TC-PWA-02', title: 'Install on iPhone (Safari) and from WhatsApp', priority: 'High', steps: ['Open the link in Safari; open it from a WhatsApp chat.'], expected: ['Safari: install steps sheet (Share → Add to Home Screen). WhatsApp: asked to open in Safari first.'] },
      { id: 'TC-PWA-03', title: 'Bottom bar and scrolling', priority: 'High', steps: ['On long screens (Clients, Orders, reports) scroll fast up and down, pull past the top and bottom; open and close the keyboard.'], expected: ['Bottom bar stays fixed at the bottom; nothing hidden behind it; no rubber-band gap; content never scrolls sideways.'] },
      { id: 'TC-PWA-04', title: 'Android Back button', priority: 'Medium', steps: ['Navigate several screens deep; press Back repeatedly; open a sheet and press Back.'], expected: ['Back goes to the previous screen; a sheet closes before leaving the screen; the app is never left in a broken state.'] },
      { id: 'TC-PWA-05', title: 'App update', priority: 'Medium', steps: ['After a new version is deployed, open the app.'], expected: ['"A new version is ready." with Later / Update; Update reloads without losing a half-filled form.'] },
      { id: 'TC-PWA-06', title: 'Notch and home bar (safe areas)', priority: 'Medium', steps: ['iPhone with notch and Android with gesture bar: check top and bottom of every main screen.'], expected: ['Nothing is under the status bar, notch or home indicator.'] },
      { id: 'TC-PWA-07', title: 'App left in the background', priority: 'Medium', steps: ['Mid-form, switch to WhatsApp or Google Authenticator for a minute; come back.'], expected: ['The form is still there, or you return to a sensible point (PIN recovery setup resumes with the same key).'] },
    ],
  },
  {
    group: 'Screens, sizes and accessibility (TC-UI)',
    cases: [
      { id: 'TC-UI-01', title: 'Small and large phones', priority: 'High', steps: ['Use phones (or browser device mode) at 360, 375, 390 and 430 px wide on every main screen.'], expected: ['No sideways scrolling, no cut-off text, buttons fully visible and at least finger-sized.'] },
      { id: 'TC-UI-02', title: 'Large text', priority: 'Medium', steps: ['Set the phone\'s font size to the largest; check Home, delivery screen, client page.'], expected: ['Text wraps instead of overlapping; all actions reachable.'] },
      { id: 'TC-UI-03', title: 'Tablet and desktop', priority: 'Low', steps: ['Open on a tablet and a laptop browser.'], expected: ['Layout widens sensibly; navigation available; nothing stretched or broken.'] },
      { id: 'TC-UI-04', title: 'Search', priority: 'High', steps: ['Clients and New order: type one letter at a time of a name; search by owner name, phone digits (3+), and type ("Home", "Hospital").'], expected: ['Results narrow with every letter; all four search kinds work; "No matching clients" when nothing matches.'] },
      { id: 'TC-UI-05', title: 'Empty states and errors', priority: 'Medium', steps: ['New business: open each list. Turn off the network and open a screen never opened before.'], expected: ['Helpful empty messages with an action (e.g. "Add client"); friendly error with Retry instead of technical text.'] },
      { id: 'TC-UI-06', title: 'Screen reader basics', priority: 'Low', steps: ['TalkBack (Android) or VoiceOver (iPhone) on login, delivery and client screens.'], expected: ['Buttons and fields are announced with sensible names; PIN boxes announce as one field.'] },
    ],
  },
  {
    group: 'Data checks and backup (TC-DATA)',
    cases: [
      { id: 'TC-DATA-01', title: 'Totals agree across screens', priority: 'High', steps: ['At the end of a test day compare: Home vs Daily sales; Who owes money total vs Home outstanding; Inventory vs Stock movement closing; Business summary vs each report.'], expected: ['Every pair matches exactly.'] },
      { id: 'TC-DATA-02', title: 'Nothing can be deleted silently', priority: 'High', steps: ['Look for any way to delete a delivery, payment, expense or stock entry.'], expected: ['Only cancel/reverse/correct actions exist; each leaves a visible history line.'] },
      { id: 'TC-DATA-03', title: 'Nightly backup (admin)', priority: 'Medium', steps: ['GitHub → repository → Actions → Database backup: check last night\'s run.'], expected: ['Green run with a backup artifact and the "books add up" check showing 0 mismatches.'] },
    ],
  },
  {
    group: 'Speed (TC-PERF)',
    cases: [
      { id: 'TC-PERF-01', title: 'Everyday speed on a budget Android phone', priority: 'Medium', steps: ['On 4G: open the app, open Clients, search, record a delivery, open Business summary for 1 year.'], expected: ['App opens in about 2 seconds after the first visit; screens respond within about 1 second; 1-year summary within a few seconds.'] },
      { id: 'TC-PERF-02', title: 'Many clients', priority: 'Low', steps: ['With 200+ clients, scroll and search the client list.'], expected: ['Smooth scrolling; search results appear as you type.'] },
    ],
  },
];

const smoke = [
  'Log in with PIN on Android (installed app) and iPhone (installed app).',
  'Home numbers load; bottom bar fixed while scrolling.',
  'Quick delivery: cans + empties + part payment; balance and cans update.',
  'Deliver an order given to staff from the staff phone; owner Home updates by itself.',
  'Client app: place an order; owner accepts and delivers.',
  'Record a payment and reverse it.',
  'Add an expense; Cash flow shows it.',
  'Inventory: refill; numbers move as expected.',
  'Business summary: switch periods; Download PDF and CSV open.',
  'Notifications: Send a test arrives (Android and iPhone).',
  'Offline: record a delivery in Airplane mode; it syncs once when back online.',
  'Forgot PIN with a recovery code works; old PIN refused.',
  'Staff cannot open /reports; client cannot open another client\'s order.',
  'No sideways scrolling at 360 px on Home, New delivery, Client page, Reports.',
];

/* ────────────────────────────── HTML ────────────────────────────── */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const count = (groups) => groups.reduce((n, g) => n + g.cases.length, 0);

function caseHtml(c, business) {
  const meta = [business ? `<span><b>Role</b> ${esc(c.role)}</span>` : '', `<span class="prio ${c.priority.toLowerCase()}">${c.priority}</span>`].join('');
  return `
  <article class="case" id="${c.id}">
    <header><span class="id">${c.id}</span><h3>${esc(c.title)}</h3><span class="meta">${meta}</span></header>
    ${c.pre ? `<p class="pre"><b>Before you start:</b> ${esc(c.pre)}</p>` : ''}
    <div class="cols">
      <div><h4>Steps</h4><ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
      <div><h4>Expected result</h4><ul>${c.expected.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
    </div>
    <footer><span>Result: ☐ Pass ☐ Fail ☐ Blocked</span><span>Device: ____________</span><span>Bug ID: ________</span></footer>
  </article>`;
}

const groupHtml = (groups, business, prefix) =>
  groups
    .map(
      (g, i) => `
  <section class="group">
    <h2 id="${prefix}-${i}">${esc(g.group)}</h2>
    ${g.cases.map((c) => caseHtml(c, business)).join('')}
  </section>`,
    )
    .join('');

const edition = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
const allIds = [...businessCases, ...technicalCases].flatMap((g) => g.cases);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Water Delivery – Test plan</title>
<style>
  @page { size: A4; margin: 15mm 14mm 17mm; }
  :root { --ink:#111827; --muted:#5b6474; --line:#e5e7eb; --brand:#0f5c6b; --soft:#e7f2f4; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin:0; color:var(--ink); font: 9.6pt/1.45 -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
  h1,h2,h3,h4 { margin:0; line-height:1.2; }
  .part { break-before: page; }
  .cover { height: 260mm; display:flex; flex-direction:column; }
  .brand { display:flex; gap:3mm; align-items:center; font-weight:700; font-size:12pt; }
  .logo { width:10mm; height:10mm; border-radius:3mm; background:var(--brand); color:#fff; display:grid; place-items:center; }
  .cover h1 { font-size:32pt; margin:24mm 0 4mm; letter-spacing:-0.5pt; }
  .cover .sub { font-size:13pt; color:var(--muted); max-width:150mm; }
  .stats { margin-top:14mm; display:grid; grid-template-columns:repeat(3,1fr); gap:4mm; }
  .stat { border:0.3mm solid var(--line); border-radius:3mm; padding:4mm; }
  .stat b { display:block; font-size:20pt; color:var(--brand); }
  .cover .meta { margin-top:auto; color:var(--muted); display:flex; justify-content:space-between; }
  h2 { font-size:16pt; color:var(--brand); margin:0 0 3mm; break-after: avoid; }
  .part > h2.big { font-size:22pt; margin-bottom:2mm; }
  p { margin:0 0 2.5mm; }
  ul, ol { margin:0; padding-left:4.5mm; }
  li { margin:0 0 1mm; }
  table.t { width:100%; border-collapse:collapse; margin:2mm 0 5mm; font-size:9.2pt; break-inside:avoid; }
  table.t th, table.t td { border:0.25mm solid var(--line); padding:1.8mm 2.2mm; text-align:left; vertical-align:top; }
  table.t th { background:var(--soft); }
  .group { margin-bottom: 4mm; }
  .case { border:0.3mm solid #d7dce3; border-radius:2.5mm; margin:0 0 4mm; break-inside:avoid; overflow:hidden; }
  .case header { display:flex; align-items:center; gap:3mm; background:#f6f7f9; padding:2.2mm 3mm; border-bottom:0.3mm solid var(--line); }
  .case .id { font-weight:800; color:var(--brand); white-space:nowrap; font-size:9pt; }
  .case h3 { font-size:10.5pt; flex:1; }
  .case .meta { display:flex; gap:3mm; align-items:center; color:var(--muted); font-size:8.5pt; white-space:nowrap; }
  .prio { font-weight:700; padding:0.5mm 2mm; border-radius:9mm; font-size:8pt; }
  .prio.high { background:#fde8e7; color:#b42318; } .prio.medium { background:#fff3dc; color:#9a5b00; } .prio.low { background:#ecf3ff; color:#1d4ed8; }
  .case .pre { margin:2mm 3mm 0; color:var(--muted); }
  .cols { display:grid; grid-template-columns: 1.05fr 1fr; gap:4mm; padding:2.5mm 3mm; }
  .cols h4 { font-size:8.5pt; text-transform:uppercase; letter-spacing:0.4pt; color:var(--muted); margin-bottom:1.2mm; }
  .case footer { display:flex; justify-content:space-between; padding:1.6mm 3mm; border-top:0.3mm dashed var(--line); color:var(--muted); font-size:8.5pt; }
  .toc { columns:2; column-gap:8mm; font-size:9pt; }
  .toc a { color:var(--ink); text-decoration:none; }
  .toc .g { font-weight:700; color:var(--brand); margin-top:2mm; break-after:avoid; }
  .box { background:var(--soft); border-radius:2.5mm; padding:3mm 4mm; margin:2mm 0 4mm; break-inside:avoid; }
  .check li { list-style:none; margin-left:-4.5mm; }
  .check li::before { content:"☐  "; }
  .runlog td { height:8mm; }
</style></head><body>

<section class="cover">
  <div class="brand"><span class="logo">💧</span> Water Delivery</div>
  <h1>Test plan</h1>
  <p class="sub">Business use cases and technical test cases for manual testing of the Water Delivery app (owner, delivery staff and client apps), on Android and iPhone.</p>
  <div class="stats">
    <div class="stat"><b>${count(businessCases)}</b>business use cases</div>
    <div class="stat"><b>${count(technicalCases)}</b>technical test cases</div>
    <div class="stat"><b>${smoke.length}</b>smoke checks per release</div>
  </div>
  <div class="meta"><span>App: ${APP_URL}</span><span>Edition: ${edition}</span></div>
</section>

<section class="part">
  <h2 class="big">1 · How to use this plan</h2>
  <p>Part 2 has <b>business use cases</b>: real working days for the owner, delivery staff and clients, end to end. Part 3 has <b>technical test cases</b> grouped by area. Part 4 is a short <b>smoke test</b> to run on every new release. Part 5 has templates for logging results and reporting bugs.</p>
  <h2>Test environment</h2>
  <table class="t">
    <tr><th>Item</th><th>What to use</th></tr>
    <tr><td>App address</td><td>${APP_URL} (ask the owner whether to use production or a separate test copy; never test with real clients' data)</td></tr>
    <tr><td>Phones</td><td>One Android phone with Chrome (budget model if possible), one iPhone with Safari, a laptop with Chrome. Install the app on both phones (TC-PWA-01, TC-PWA-02).</td></tr>
    <tr><td>Accounts</td><td>Create your own test business (BU-01). For access tests create a second business. Add 2 staff and give 1 client app access. Write all phones and PINs in the table below.</td></tr>
    <tr><td>Apps</td><td>Google Authenticator (or Microsoft Authenticator / Authy) for PIN recovery tests; WhatsApp for receipts.</td></tr>
    <tr><td>Data</td><td>Use made-up client names; include at least one Malayalam or Hindi name to check PDFs.</td></tr>
  </table>
  <table class="t runlog">
    <tr><th style="width:24%">Account</th><th style="width:20%">Role</th><th style="width:28%">Phone</th><th>PIN</th></tr>
    <tr><td>Business A owner</td><td>Owner</td><td></td><td></td></tr>
    <tr><td>Raju</td><td>Staff</td><td></td><td></td></tr>
    <tr><td>Second staff</td><td>Staff</td><td></td><td></td></tr>
    <tr><td>Client with app</td><td>Client</td><td></td><td></td></tr>
    <tr><td>Business B owner</td><td>Owner</td><td></td><td></td></tr>
  </table>
  <h2>Priorities and results</h2>
  <table class="t">
    <tr><th>Priority</th><th>Meaning</th></tr>
    <tr><td><span class="prio high">High</span></td><td>Money, cans, stock, login or access. Must pass before a release.</td></tr>
    <tr><td><span class="prio medium">Medium</span></td><td>Important everyday behaviour; a failure needs a fix soon.</td></tr>
    <tr><td><span class="prio low">Low</span></td><td>Polish and edge cases.</td></tr>
  </table>
  <div class="box"><b>Recording a result.</b> Tick Pass, Fail or Blocked under each case and note the device. For every Fail, write a bug report (Part 5) with screenshots or a screen recording, and put its ID on the case.</div>
  <h2>Key rules the app follows (check these everywhere)</h2>
  <ul>
    <li><b>Balance</b> = everything a client was billed minus everything they paid. "Owes ₹…" in red, "Advance ₹…" in green.</li>
    <li><b>Cans with a client</b> = cans already there + full cans delivered − empties collected − damaged cans taken back.</li>
    <li><b>Nothing is deleted.</b> Mistakes are cancelled, reversed or corrected, and each leaves a history line.</li>
    <li><b>Staff see only today and their own work</b>; their screen starts fresh each morning.</li>
    <li><b>Works offline</b>: deliveries, order deliveries, payments, empties, expenses and client orders are saved on the phone and sent once when back online.</li>
  </ul>
</section>

<section class="part">
  <h2 class="big">Contents</h2>
  <div class="toc">
    <p class="g">2 · Business use cases</p>
    ${businessCases.map((g) => `<p class="g" style="color:var(--ink);font-weight:600">${esc(g.group)}</p>${g.cases.map((c) => `<div><a href="#${c.id}">${c.id} ${esc(c.title)}</a></div>`).join('')}`).join('')}
    <p class="g">3 · Technical test cases</p>
    ${technicalCases.map((g) => `<p class="g" style="color:var(--ink);font-weight:600">${esc(g.group)}</p>${g.cases.map((c) => `<div><a href="#${c.id}">${c.id} ${esc(c.title)}</a></div>`).join('')}`).join('')}
    <p class="g">4 · Smoke test for every release</p>
    <p class="g">5 · Bug report and run log</p>
  </div>
</section>

<section class="part">
  <h2 class="big">2 · Business use cases</h2>
  <p>Run these in order the first time: later cases use the data from earlier ones. Each is a real piece of a working day.</p>
  ${groupHtml(businessCases, true, 'bu')}
</section>

<section class="part">
  <h2 class="big">3 · Technical test cases</h2>
  <p>Grouped by area. Run on both Android (installed app, Chrome) and iPhone (installed app, Safari) unless the case names one.</p>
  ${groupHtml(technicalCases, false, 'tc')}
</section>

<section class="part">
  <h2 class="big">4 · Smoke test for every release</h2>
  <p>About 30 minutes. If any line fails, stop and report before wider testing.</p>
  <table class="t">
    <tr><th style="width:8%">#</th><th>Check</th><th style="width:13%">Android</th><th style="width:13%">iPhone</th></tr>
    ${smoke.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s)}</td><td>☐</td><td>☐</td></tr>`).join('')}
  </table>
</section>

<section class="part">
  <h2 class="big">5 · Bug report template</h2>
  <table class="t">
    <tr><th style="width:28%">Field</th><th>What to write</th></tr>
    <tr><td>Bug ID</td><td>BUG-001, BUG-002 …</td></tr>
    <tr><td>Test case</td><td>e.g. BU-05 or TC-CALC-01</td></tr>
    <tr><td>Title</td><td>One line: what is wrong (e.g. "Cash to hand over includes UPI payments")</td></tr>
    <tr><td>Severity</td><td>Critical (money/cans/stock wrong, data lost, can't log in) · Major · Minor · Cosmetic</td></tr>
    <tr><td>Device</td><td>Phone model, Android/iOS version, browser, installed app or browser tab</td></tr>
    <tr><td>Account / role</td><td>Owner / Staff / Client and the phone number used (never the PIN)</td></tr>
    <tr><td>Steps to reproduce</td><td>Numbered, from a known starting point</td></tr>
    <tr><td>Expected</td><td>What should happen (from the test case)</td></tr>
    <tr><td>Actual</td><td>What happened, with exact messages</td></tr>
    <tr><td>Evidence</td><td>Screenshots or a screen recording; time it happened</td></tr>
    <tr><td>Happens</td><td>Always / sometimes (how often) / once</td></tr>
  </table>
  <h2>Run log</h2>
  <table class="t runlog">
    <tr><th style="width:14%">Date</th><th style="width:16%">Tester</th><th style="width:16%">Build / version</th><th style="width:18%">Devices</th><th style="width:12%">Passed</th><th style="width:12%">Failed</th><th>Notes</th></tr>
    ${Array.from({ length: 10 }, () => '<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}
  </table>
  <h2>Results summary</h2>
  <table class="t">
    <tr><th>ID</th><th>Title</th><th style="width:12%">Priority</th><th style="width:20%">Result</th></tr>
    ${allIds.map((c) => `<tr><td>${c.id}</td><td>${esc(c.title)}</td><td>${c.priority}</td><td>☐ P ☐ F ☐ B</td></tr>`).join('')}
  </table>
</section>
</body></html>`;

writeFileSync(path.join(DIR, 'test-plan.html'), html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: path.join(DIR, 'Water-Delivery-Test-Plan.pdf'),
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;font:8px Helvetica,Arial,sans-serif;color:#6b7280;padding:0 14mm;display:flex;justify-content:space-between"><span>Water Delivery · Test plan</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  outline: true,
  tagged: true,
});
await browser.close();
console.log(`Test plan: ${count(businessCases)} business + ${count(technicalCases)} technical cases`);
