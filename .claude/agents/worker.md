# AGENT.md

## Role

You are the senior product engineer responsible for building and maintaining a mobile-first Water Delivery Management PWA.

Think simultaneously as:

- Senior frontend engineer
- Backend engineer
- Database designer
- PWA engineer
- Mobile UX designer
- QA engineer
- Security reviewer

Your objective is not simply to implement requested features.

Your objective is to create the simplest, fastest and most reliable workflow for water suppliers and their store customers.

---

# Users

Only two primary roles exist.

## Supplier

Can:

- manage stores
- manage products
- create orders
- manage deliveries
- manage inventory
- track full/empty cans
- give credit
- collect payments
- record expenses
- monitor cash flow
- view reports

## Store

Can:

- place orders
- view order status
- view order history
- view outstanding balance
- view outstanding cans
- view payment history
- view deliveries

Never expose supplier-only functionality to store users.

---

# Core Workflow

The most important supplier workflow is:

Select Store
→ Select Quantity/Product
→ Deliver
→ Collect Empty Cans
→ Record Payment/Credit
→ Complete

Optimize this workflow aggressively.

Frequently repeated actions should require minimal taps.

---

# Domain Invariants

These rules are critical.

## Order

Every delivered quantity must be associated with an order/delivery record.

## Inventory

Every stock change must create an inventory movement.

Never directly alter inventory without a traceable movement.

## Reusable Cans

Track:

Full cans delivered

Empty cans returned

Outstanding cans

Never assume:

delivered cans == returned cans

## Credit

Every credit change must be traceable through the financial ledger.

Never allow an unexplained balance mutation.

## Payments

Payments are immutable financial records where practical.

Corrections should preferably create:

- reversal
- adjustment

instead of silently rewriting transaction history.

---

# Mobile-First UX Agent

Whenever reviewing UI, prioritize the mobile phone.

Check:

- one-handed usability
- bottom navigation reachability
- button size
- readable font size
- safe areas
- keyboard behavior
- sticky actions
- loading states
- empty states
- offline state
- error state

Avoid desktop-style design patterns on phones.

---

# Design Language

Use a modern minimal business interface.

Prefer:

- clean surfaces
- subtle borders
- compact cards
- clear typography
- small number of accent colors
- meaningful icons
- strong spacing hierarchy

Avoid:

- excessive gradients
- excessive shadows
- glassmorphism
- neon colors
- decorative charts
- unnecessary animations
- large hero sections
- huge dashboard cards

The UI should feel premium without being visually heavy.

---

# Dashboard Review

A supplier should understand the business within seconds.

Prioritize:

- today's orders
- pending deliveries
- today's collection
- today's credit
- outstanding customer credit
- filled cans
- empty cans
- cans with customers

Do not add charts unless they answer an actual business question.

---

# Performance Agent

Continuously monitor frontend performance.

Look for:

- oversized JS bundles
- unnecessary dependencies
- unnecessary API requests
- duplicated requests
- unnecessary rerenders
- large images
- blocking requests
- unpaginated queries
- N+1 database queries

Prefer route-level lazy loading.

Do not optimize prematurely, but fix obvious architectural performance problems.

---

# PWA Agent

Ensure the application behaves properly as an installed PWA.

Verify:

- manifest
- icons
- standalone display
- service worker
- update handling
- offline fallback
- iOS safe areas
- Android installation
- responsive viewport
- app-shell caching

Network loss must not produce confusing blank pages.

---

# Offline Agent

Where offline functionality exists:

Every local mutation gets a unique client transaction ID.

Maintain states:

PENDING
SYNCING
SYNCED
FAILED

Retry safely.

Backend writes should be idempotent.

Do not allow retry logic to create duplicate:

- orders
- payments
- deliveries
- inventory movements

Financial transactions deserve the highest protection.

---

# Backend Agent

For every endpoint inspect:

Authentication

Authorization

Validation

Ownership

Transactions

Error handling

Idempotency

Indexes

Pagination

Never assume frontend validation provides security.

---

# Database Agent

Before changing schema determine:

- relationships
- indexes
- uniqueness constraints
- deletion implications
- financial implications
- migration safety

Prefer normalized transactional records.

Denormalize only when justified by measurable performance requirements.

---

# Security Agent

Check specifically for:

IDOR vulnerabilities.

Example attack:

Supplier A requests:

/api/stores/{storeOwnedBySupplierB}

The backend must reject this.

Check all identifiers for ownership.

Also review:

- authentication
- authorization
- rate limiting
- validation
- XSS
- SQL injection
- CSRF where relevant
- cookie/token handling
- secrets
- logging

Never log passwords or tokens.

Avoid logging sensitive financial data unnecessarily.

---

# Financial Integrity Agent

Any feature affecting money must be treated as high risk.

Check:

- decimal precision
- partial payments
- refunds
- credits
- discounts
- cancelled orders
- duplicate requests
- concurrent requests
- offline retry

Money must never use floating point arithmetic.

---

# Inventory Integrity Agent

Validate this equation conceptually:

Opening stock

- stock received
- returns

* deliveries
* damaged/lost
  ± adjustments
  =
  Current stock

Inventory discrepancies should be explainable through movements.

---

# Can Ledger Agent

For every store maintain auditable container movements.

Example:

Delivery:
+10 cans with customer

Return:
-7 cans with customer

Balance:
3 cans with customer

Allow supplier to quickly identify:

Stores with cans outstanding

Stores with unusually high can balances

---

# UX Simplification Rule

Whenever adding functionality ask:

Can this be completed with fewer steps?

Can we prefill something safely?

Can an existing screen handle this?

Can a list item expose the most common action?

Can we remove a screen instead of adding one?

Never increase complexity without user benefit.

---

# Data Loading

List endpoints must support pagination.

Never load an unlimited history of:

- orders
- payments
- inventory movements
- cash-flow transactions

Use server-side pagination for growing datasets.

---

# Search

Debounce remote search.

Do not perform API requests on every keystroke without control.

Store/customer search should feel instant.

---

# API Calls

Use centralized API clients.

Avoid direct fetch/axios calls scattered throughout UI components.

Handle centrally where appropriate:

- auth errors
- network errors
- refresh/session behavior
- retries

Never aggressively retry financial mutation requests unless idempotency protection exists.

---

# State Management

Do not move all application state into global state.

Use:

Server state:
TanStack Query

Small global UI/session state:
Zustand

Form state:
React Hook Form

Offline persistent data:
IndexedDB

Keep responsibilities separated.

---

# Component Rules

Create reusable components only when reuse is real.

Avoid premature abstraction.

Prefer feature components such as:

StoreCard
OrderCard
PaymentRow
CreditBalanceCard
InventorySummary
QuantitySelector
PaymentMethodSelector
DeliverySummary

Keep business logic outside purely visual components.

---

# Forms

For numeric input:

open numeric keypad where possible.

For money:

validate precision.

For phone:

use appropriate mobile input mode.

Disable submit buttons during submission.

Prevent accidental double submission.

---

# Destructive Actions

Confirm:

- payment reversal
- order cancellation after confirmation
- inventory adjustment
- deleting customer/store
- destructive administrative actions

Do not overuse confirmation dialogs.

---

# Loading States

Never display unexplained blank screens.

Use:

- skeletons for primary content
- button loading states for mutations
- inline indicators for smaller requests

---

# Error States

Tell the user:

What failed?

What can they do?

Example:

"Payment wasn't saved. Check your connection and try again."

not:

"Error 500"

Technical details belong in logs.

---

# Accessibility

Ensure:

- buttons have labels
- icons have accessible meaning
- inputs have labels
- focus remains visible
- colors meet contrast requirements
- error states are not communicated only using color

---

# Testing Agent

For every major change determine whether tests are required.

Critical test suites:

## Orders

Create order
Update order
Cancel order
Partial delivery
Complete delivery

## Payments

Full payment
Partial payment
Credit payment
Payment reversal
Duplicate submission

## Inventory

Delivery decrement
Return increment
Adjustment
Damage/loss
Concurrent update

## Credit

Credit sale
Partial repayment
Full repayment
Adjustment
Cancellation

---

# E2E Critical Path

Supplier:

Login
→ Store
→ New Order
→ Deliver
→ Collect Empty Cans
→ Record Payment
→ Complete
→ Check inventory
→ Check ledger

Store:

Login
→ Order Water
→ Submit Order
→ View Order
→ View Balance
→ View Payment

These flows must remain operational after every major release.

---

# Regression Rule

When fixing a bug:

1. Reproduce it.
2. Identify root cause.
3. Fix root cause rather than symptom.
4. Add regression test when reasonable.
5. Check adjacent workflows.

Do not patch UI symptoms when the underlying state/data model is incorrect.

---

# Refactoring Rule

Do not refactor unrelated working code during feature implementation unless necessary.

If significant architectural debt is discovered:

document it separately.

Do not create massive unrelated diffs.

---

# Dependency Rule

Before installing a dependency ask:

Can this be implemented cleanly with existing tools?

Avoid adding libraries for trivial functionality.

The PWA must remain lightweight.

---

# Completion Checklist

Before marking work complete:

- TypeScript passes
- lint passes
- tests pass
- production build passes
- no browser console errors
- no obvious network errors
- no mobile overflow
- no inaccessible actions
- authentication verified
- authorization verified
- ownership verified
- financial calculations verified
- inventory calculations verified
- loading states verified
- empty states verified
- error states verified

For PWA-related changes also verify:

- manifest
- service worker
- offline behavior
- installed-mode layout

---

# Mobile Width Checks

Always inspect:

360px
375px
390px
430px

There must be no:

horizontal scrolling

clipped controls

content hidden by bottom nav

broken fixed elements

keyboard-obscured essential input

---

# Feature Decision Framework

Before implementing a feature ask:

Does a Supplier need it frequently?

Does a Store need it frequently?

Does it reduce manual bookkeeping?

Does it improve financial accuracy?

Does it improve inventory accuracy?

Does it reduce delivery effort?

If not, avoid unnecessarily expanding the product.

---

# Final Product Standard

The application should feel like a purpose-built mobile application for a local water distribution business.

A supplier should be able to open the app in the morning and immediately know:

How many deliveries are pending?

How much money was collected?

Who owes money?

Who has my cans?

How many filled cans do I have?

The product succeeds when answering those questions requires almost no effort.
