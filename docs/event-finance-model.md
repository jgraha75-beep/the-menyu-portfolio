# Event finance model

## Source-of-truth boundary

- Check-in owns registration and spectator payments.
- Finance projects those payments as immutable system transactions; it does not duplicate or edit them.
- The finance ledger owns merchandise and drink revenue, venue expenses, staff payouts, other costs, refunds, and signed adjustments.
- Expected and actual amounts are whole Japanese yen. Negative amounts are allowed only for adjustments.

## Calculation

```text
gross revenue = registration + spectator + merchandise + drink + adjustments
net profit = gross revenue - venue and other event costs - staff payouts - refunds
variance = actual - expected
```

Expected registration revenue comes from the configured division fee and participant count. Actual registration revenue comes from recorded payment fields. Spectator expectations and actuals currently share the recorded event totals because spectator forecasts are not yet modeled separately.

## Lifecycle

1. `open`: permitted finance managers can add rows and preview/import cost files.
2. `review`: a manager has recorded the final review. Any new finance entry reopens the review.
3. `closed`: finance is locked and the event moves to `completed`.
4. A closed record can change only through:
   - a correction, which appends a signed delta and keeps the original row, or
   - an Event-lead reopen with a recorded reason, which returns finance to `open` and the event to `active`.

Archived events are read-only, including finance.

## Permissions and audit

| Action | General staff | Finance lead | Event lead |
| --- | --- | --- | --- |
| View finance and export | Yes | Yes | Yes |
| Add/import/review/close | No | Yes | Yes |
| Correct a closed record | No | Yes | Yes |
| Reopen a closed event | No | No | Yes |

Manual entries, imports, reviews, closes, corrections, and reopens all create activity-log entries with staff identity and event revision. Corrections also store the original transaction ID, prior amount, replacement amount, delta, reason, and timestamp.

## Persistence

The event aggregate is the recovery source of truth for the complete finance state. Supabase receives a queryable projection of manual, imported, and correction transactions in `financial_transactions`. Operational payment rows are derived at read/export time and are therefore not copied into that table.
