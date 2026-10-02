# CLAUDE.md

## Project Overview

Build a production-ready, mobile-first Progressive Web App for water-can delivery businesses.

The app is primarily used on Android and iOS phones and must feel like a native mobile application while remaining extremely lightweight, fast, simple, and installable as a PWA.

The system has only two user types:

1. **Supplier**
   - Water supplier / distributor / delivery business.
   - Manages stores/customers.
   - Manages water-can inventory.
   - Creates and tracks deliveries/orders.
   - Records payments.
   - Gives water cans on credit.
   - Tracks outstanding balances.
   - Tracks empty/returned cans.
   - Tracks cash flow.
   - Views business reports.

2. **Store**
   - Shop/store/customer purchasing water cans.
   - Places orders.
   - Views order history.
   - Tracks outstanding credit.
   - Views payments.
   - Confirms deliveries if required.
   - Tracks cans received/returned.

There is no public/social user role.

---

# Product Principles

Always prioritize:

1. Simplicity
2. Mobile usability
3. Speed
4. Offline resilience
5. Minimal number of taps
6. Clear financial information
7. Reliable inventory tracking
8. Easy operation by non-technical users

This is a business utility, not a visually complicated SaaS dashboard.

A delivery person should be able to complete most common actions using one hand.

---

# Recommended Stack

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TanStack Query
- Zustand for lightweight client state
- React Hook Form
- Zod validation
- Lucide icons

PWA:

- Vite PWA plugin / Workbox
- Service worker
- Web App Manifest
- IndexedDB for offline data
- Dexie if an IndexedDB abstraction is needed

## Backend

Prefer:

- Node.js
- TypeScript
- Fastify

Alternative:

- Express if already present in the repository.

## Database

- PostgreSQL
- Prisma ORM

## Authentication

Secure token/session authentication.

Prefer:

- HttpOnly secure cookies where architecture allows.
- Refresh/session rotation.
- Role-based authorization.

Never rely only on frontend role checks.

Every backend endpoint must validate ownership and authorization.

---

# Architecture

Use clear separation:

src/
components/
features/
pages/
hooks/
services/
stores/
schemas/
types/
utils/
pwa/

Organize domain code by feature wherever practical.

Example:

features/
auth/
dashboard/
stores/
orders/
deliveries/
inventory/
credits/
payments/
cashflow/
reports/
notifications/
settings/

Avoid giant components and giant service files.

---

# Core Domain Model

## Supplier

Represents the water delivery business.

Important fields:

- id
- businessName
- ownerName
- phone
- email
- address
- currency
- timezone
- createdAt
- updatedAt

---

## Store

Represents a customer/store buying water.

Fields:

- id
- supplierId
- name
- ownerName
- phone
- address
- location
- creditLimit
- currentBalance
- status
- notes
- createdAt
- updatedAt

A Store belongs to exactly one Supplier unless multi-supplier support is explicitly introduced later.

---

# Product / Water Can

Do not hardcode only one water-can type.

Support products such as:

- 20L water can
- 10L water can
- bottled-water crate
- custom products

Product fields:

- id
- supplierId
- name
- capacity
- sellingPrice
- depositAmount
- stockQuantity
- active

---

# Can Inventory

Water cans require special inventory handling because containers may be reusable.

Track separately:

- Filled cans
- Empty cans
- Cans currently with stores
- Damaged/lost cans

Example inventory concepts:

filledStock
emptyStock
withCustomers
damagedStock

Inventory movements must be recorded as transactions.

Never modify inventory silently.

---

# Orders

Order statuses:

- DRAFT
- PENDING
- CONFIRMED
- OUT_FOR_DELIVERY
- DELIVERED
- PARTIALLY_DELIVERED
- CANCELLED

Order fields should include:

- id
- supplierId
- storeId
- orderNumber
- orderDate
- deliveryDate
- items
- subtotal
- discounts
- total
- amountPaid
- creditAmount
- paymentStatus
- orderStatus
- notes
- createdBy

Order creation must be extremely fast on mobile.

Target flow:

Store → Quantity → Payment method → Confirm

Common repeat orders should take only a few taps.

---

# Delivery

Delivery records should track:

- order
- store
- delivery person
- quantity delivered
- empty cans collected
- damaged/lost cans
- timestamp
- optional notes
- optional proof of delivery

Do not require photos/signatures by default.

They should be optional because the application must remain lightweight.

---

# Empty Can / Container Tracking

This is a critical domain feature.

For every delivery track:

- full cans delivered
- empty cans collected

Example:

Delivered: 10

Empty returned: 7

Outstanding cans at store increases by:

3

Maintain a ledger rather than only storing the latest number.

Example:

Store Can Balance

Full delivered: +10
Empty returned: -7
Outstanding: 3

The supplier must easily see which stores have outstanding cans.

---

# Credit System

Stores may receive water without immediate payment.

Credit must use a financial ledger.

Never calculate credit using an unreliable manually editable balance.

Ledger transaction types:

- SALE
- PAYMENT
- CREDIT_ADJUSTMENT
- REFUND
- DISCOUNT
- OPENING_BALANCE

Store balance should be calculated from transactions or safely maintained from a transaction-backed ledger.

Example:

Order total: ₹500
Paid: ₹200
Credit: ₹300

Store outstanding balance increases by ₹300.

Later:

Payment: ₹200

Outstanding balance becomes ₹100.

---

# Payment Methods

Support at minimum:

- CASH
- UPI
- BANK_TRANSFER
- CREDIT
- OTHER

Allow partial payment.

Example:

Order ₹1,000

Cash ₹400
Credit ₹600

---

# Payments

Every payment must create a separate transaction.

Fields:

- id
- supplierId
- storeId
- orderId optional
- amount
- paymentMethod
- referenceNumber optional
- paymentDate
- notes
- createdBy

Do not delete financial transactions silently.

Prefer reversal/adjustment transactions.

---

# Cash Flow

Track:

Income:

- water sales
- deposits
- recovered credit
- other income

Expenses:

- fuel
- water purchase
- vehicle expense
- salary
- maintenance
- electricity
- miscellaneous expenses

Cash flow transaction:

- id
- supplierId
- type
- category
- amount
- date
- paymentMethod
- description
- reference

Dashboard should show useful business numbers rather than decorative graphs.

---

# Supplier Dashboard

Keep dashboard simple.

Primary cards:

Today

- Orders
- Delivered
- Pending
- Today's sales

Money

- Cash collected
- Credit sales
- Outstanding credit

Inventory

- Filled cans
- Empty cans
- Cans with stores

Optional:

- Expenses today
- Net cash flow

Avoid filling the dashboard with charts.

If charts are used, use only when they provide meaningful information.

---

# Store Dashboard

Store users should see:

- Place Order
- Current outstanding amount
- Outstanding cans
- Latest delivery
- Recent orders
- Recent payments

Primary CTA:

"Order Water"

---

# Store Management

Supplier should be able to:

- add store
- edit store
- deactivate store
- search store
- call store
- view balance
- view order history
- view payment history
- view can balance
- record payment
- create order

Store detail screen should act as a customer ledger.

---

# Inventory

Inventory screens must answer immediately:

How many filled cans are available?

How many empty cans are available?

How many cans are currently with customers?

Which customers have them?

What inventory movements happened today?

Inventory changes must be transaction based.

---

# Search

Fast search should exist for:

- Stores
- Orders
- Payments

Supplier store search should prioritize:

- Store name
- Owner name
- Phone number

---

# Mobile UX Requirements

Design mobile first.

Primary target viewport:

360px–430px wide.

Desktop/tablet layouts should adapt from the mobile experience.

Do not design desktop first and shrink it.

---

# Navigation

Supplier bottom navigation:

Home
Orders
Stores
Inventory
More

Use a prominent action button where useful for:

- New Order

Store bottom navigation:

Home
Orders
Payments
Account

Navigation should remain reachable with one hand.

---

# UI Style

Visual direction:

- modern
- premium
- minimal
- clean
- calm
- business-oriented

Avoid:

- excessive gradients
- neon colors
- glassmorphism everywhere
- unnecessary animations
- oversized cards
- heavy shadows
- giant headings
- cluttered dashboards

Use:

- subtle borders
- restrained shadows
- rounded corners
- generous but efficient spacing
- strong typography hierarchy

---

# Touch Targets

Minimum interactive target:

44×44 px where practical.

Critical actions must not use tiny icons.

---

# Forms

Forms must be optimized for phones.

Use:

- numeric keyboard for quantity/money
- phone keyboard for phone numbers
- sensible defaults
- large touch targets
- inline validation
- sticky submit action where helpful

Avoid long forms.

Split complicated forms into logical steps.

---

# Tables

Avoid desktop-style wide tables on mobile.

Use mobile cards/list rows instead.

Desktop/tablet views may use tables.

Tables must include:

- pagination
- search
- filtering
- sorting where useful

---

# Confirmation UX

Require confirmation for destructive actions such as:

- cancelling completed order
- deleting records
- reversing payment
- inventory adjustment

Do not require confirmation for ordinary navigation/actions.

---

# PWA Requirements

The application must be installable on:

- Android
- iOS

Implement:

- manifest
- icons
- splash-compatible configuration
- service worker
- offline fallback
- update handling
- installability
- responsive safe-area support

Use:

env(safe-area-inset-top)
env(safe-area-inset-bottom)

where appropriate for iPhone devices.

---

# Offline Strategy

The app should remain useful with unstable internet.

Cache:

- authenticated app shell
- product catalog
- store list
- recent orders
- essential account data

Allow selected actions to be queued offline where safe.

Example:

Delivery completed while network unavailable.

Store transaction locally and synchronize once connectivity returns.

Never silently lose transactions.

Display sync state such as:

Synced
Pending sync
Sync failed

---

# Offline Mutation Safety

Every offline mutation should use a client-generated unique ID.

Backend endpoints should support idempotency.

This prevents duplicate orders/payments when synchronization retries.

Financial actions require special care.

---

# Performance Requirements

The application must feel fast on affordable Android devices.

Avoid unnecessary dependencies.

Use:

- route-based code splitting
- lazy loading
- optimized SVG/icons
- compressed images
- request caching
- pagination
- virtualization only for very large lists

Avoid large animation frameworks unless truly necessary.

Performance target:

Lighthouse performance should ideally remain above 90 and preferably 95+ for core screens.

---

# API Design

Use REST unless existing architecture specifies otherwise.

Example:

/api/auth

/api/stores
/api/stores/:id

/api/products

/api/orders
/api/orders/:id

/api/deliveries

/api/inventory
/api/inventory/movements

/api/payments

/api/credits

/api/cashflow

/api/reports

Every request must validate supplier/store ownership.

---

# Authorization

Supplier users can access only resources belonging to their business.

Store users can access only their own:

- orders
- payments
- balances
- deliveries

Never trust IDs sent by the frontend without ownership validation.

Example:

Never:

SELECT \* FROM orders WHERE id = ?

Instead enforce user/business ownership.

---

# Database Rules

Use:

- foreign keys
- indexes
- timestamps
- unique constraints
- transactions

Money should use DECIMAL/NUMERIC.

Never use floating-point types for currency.

Use database transactions for workflows modifying multiple records.

Example delivery transaction may update:

Order
Inventory
Can ledger
Credit ledger
Payment

These should succeed or fail together where appropriate.

---

# Auditability

Business-critical operations should be traceable.

Record:

- createdBy
- createdAt
- updatedAt

For sensitive operations consider:

- action
- entity
- previous value
- new value
- actor
- timestamp

Especially for:

- payment changes
- credit adjustments
- stock corrections

---

# Notifications

Keep notification architecture extensible.

Possible future notifications:

Supplier:

- new order
- overdue credit
- low inventory

Store:

- order confirmed
- order delivered
- payment recorded
- credit reminder

Do not make push notifications mandatory for initial implementation.

---

# Reports

Useful reports:

- Daily sales
- Monthly sales
- Outstanding credit
- Customer ledger
- Payment history
- Inventory movement
- Outstanding cans
- Expense report
- Cash-flow report

Reports should be practical rather than visually elaborate.

---

# Currency

Do not hardcode currency formatting deeply into UI.

Currency should come from supplier/business settings.

Initial deployment may default to INR.

Example:

₹1,250

---

# Dates

Store database timestamps in UTC.

Display dates/time according to business timezone.

---

# Accessibility

Use:

- semantic HTML
- visible focus states
- sufficient contrast
- form labels
- accessible buttons
- ARIA only when necessary

Do not communicate state using color alone.

---

# Loading UX

Prefer:

- skeleton states
- optimistic UI where safe
- localized loading indicators

Avoid blocking the entire application for small API requests.

---

# Error Handling

Errors should be understandable.

Bad:

"500 Internal Server Error"

Better:

"Payment could not be recorded. Please try again."

Log technical error details separately.

---

# Empty States

Every major list should have useful empty states.

Example:

"No orders today"

with:

"Create Order"

instead of displaying an empty container.

---

# Security

Follow standard web security practices.

Required:

- server-side authorization
- input validation
- rate limiting
- secure cookies/tokens
- password hashing
- CSRF protection where applicable
- security headers
- SQL injection protection
- XSS protection
- dependency auditing

Never expose:

- secrets
- DB credentials
- private tokens

to frontend code.

---

# Testing

Maintain:

Unit tests for:

- calculations
- balances
- inventory logic
- credit logic

Integration tests for:

- order creation
- delivery
- payment
- inventory updates

E2E tests for critical flows.

Supplier E2E:

Login
→ Create store
→ Create order
→ Deliver order
→ Record payment
→ Verify inventory
→ Verify ledger

Store E2E:

Login
→ Place order
→ View order
→ View balance
→ View payment history

---

# Critical Financial Tests

Always test:

Full cash payment

Partial payment

Full credit order

Partial credit order

Payment against existing balance

Refund/reversal

Cancelled order

Duplicate request

Offline synchronization retry

Decimal rounding

Never deploy financial changes without tests.

---

# Code Quality Rules

Always:

- use TypeScript strict mode
- avoid `any`
- validate external data
- reuse components
- use meaningful names
- keep components focused
- remove dead code
- handle errors explicitly
- use async/await consistently
- follow existing project conventions

Never introduce libraries without a clear reason.

---

# Claude Code Workflow

Before modifying code:

1. Inspect the repository.
2. Understand the existing architecture.
3. Identify affected files.
4. Check existing conventions.
5. Make the smallest clean architectural change.

Do not rewrite working architecture unnecessarily.

Before finishing:

1. Run lint.
2. Run type checking.
3. Run relevant tests.
4. Build the project.
5. Check for console errors.
6. Review mobile responsiveness.
7. Check authorization implications.
8. Check financial/inventory consistency.

Fix problems discovered during validation.

---

# UI Development Rule

Whenever implementing a screen, test mentally and technically at:

360px
375px
390px
430px

Also confirm tablet and desktop responsiveness.

There must be:

- no horizontal overflow
- no clipped text
- no inaccessible buttons
- no content hidden behind bottom navigation
- no broken safe-area behavior

---

# Decision Priority

When multiple approaches are possible choose, in order:

1. Correctness
2. Data integrity
3. Simplicity
4. Mobile usability
5. Performance
6. Maintainability
7. Visual polish

Never sacrifice financial or inventory correctness for UI convenience.

---

# Product Philosophy

The final product should feel like:

"A digital notebook and ledger made specifically for water delivery businesses."

Not:

"A complicated enterprise ERP squeezed onto a phone."

Every feature should reduce effort for the supplier or store user.
