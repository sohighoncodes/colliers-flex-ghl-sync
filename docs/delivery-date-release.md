# Delivery date sync — 2026-09-23

## Mapping

Both fields are DATE fields on GHL contacts in Colliers Catering (`disULVGEDcwvApbCceP2`).

| Field | GHL key | GHL ID |
| --- | --- | --- |
| Flex First Order Delivery Date | `contact.flex_first_order_delivery_date` | `QfxWfMkUxc51TxV4HRC0` |
| Flex Latest Order Delivery Date | `contact.flex_latest_order_delivery_date` | `DhfdByYXNVysv9ZokInp` |

Select the earliest and latest valid `delivery_datetime` across the returned customer order history, independently of placement chronology. The user-approved revised rule is **order `status = approved` AND `payment_status = paid`** (case/whitespace normalized). Both conditions are required. All other order/payment states, including completed/invoiced, unpaid, partially paid, processing and refunded, are excluded. **Future scheduled delivery dates qualify**: there is no elapsed-time condition. These fields represent scheduled delivery dates of approved, fully paid orders, not proof of fulfillment. Format the date in `Australia/Sydney` (the verified GHL location timezone), including daylight saving.

Missing/invalid delivery dates and histories with no qualifying deliveries send blanks to remove stale values in these two fields. Do not substitute the placement date. Existing UTC placement-date calculations, totals, their existing status filtering, company metrics, contact matching, retries, webhooks and reconciliation are preserved.

The shared contact payload builder handles both webhook and scheduled syncs. Existing contacts acquire the fields when next synchronized. Every refresh reads the paginated customer order history, so the first date is the earliest qualifying delivery returned by Flex, even when it predates this deployment. Records absent from Flex cannot be reconstructed.

## Deployment

The approved/paid release is immutable **version 12**. Both live HEAD and version 12 were verified identical to local source (18 files), and the existing webhook deployment now targets version 12. The preceding release is immutable **version 11**; before this revision, live HEAD and webhook version 11 were verified identical to the saved Git baseline. This revision changes only delivery eligibility and diagnostic counts; webhook URL, Cloudflare settings, manifest, credentials, triggers and reconciliation behavior stay unchanged. Payment/status edits are picked up by the existing changed-order reconciliation; no date-passage recheck is needed because future delivery dates qualify.

## Recovery

To revert only the approved/paid rule to the previous completed/invoiced rule, restoring both HEAD and the webhook to immutable version 11:

```powershell
.\scripts\rollback-delivery-dates.ps1 -ToPreviousRule -Apply
```

Git baseline tag: `rollback/pre-approved-paid-delivery-dates-2026-09-23`. The command below still performs the original full rollback.

Before any source update, live HEAD was saved as immutable Apps Script **version 8**. The original webhook deployment uses **version 7**; HEAD and version 7 already differ, so both must be restored for a complete rollback. The local Git tag is `rollback/pre-delivery-dates-2026-09-23` (baseline commit `78598dac390007fb3424251d52ea9a4352fd8eb0`).

One-command full rollback from this repository:

```powershell
.\scripts\rollback-delivery-dates.ps1 -Apply
```

Omit `-Apply` to display the plan. The script downloads version 8 into a fresh temporary checkout, restores HEAD for time-based triggers, and re-points the existing webhook deployment to version 7. No API keys are required beyond the existing clasp login. GHL fields and their current values remain available; reverting code does not undo already synchronized data.

Emergency feature-only switch: in Apps Script Project Settings → Script Properties, set `FLEX_DELIVERY_DATE_SYNC_ENABLED` to `false`. This removes the two new fields from future payloads in both execution paths while allowing all legacy synchronization to continue. Remove the property or set it to `true` to re-enable.

## Verification

`npm test` passes 13 checks covering delivery chronology, approved-and-paid eligibility, future-date inclusion, cancellation/refund recalculation, missing/invalid dates, Sydney day boundaries and daylight saving, explicit blank values, the emergency switch, source audit counts, mapped-contact/upsert payloads, and full legacy metric/payload equality against the saved baseline. It also parses all Apps Script JavaScript together and checks the original web-app access settings.

Read-only live-data checks for version 12: order 2849 qualifies with delivery date `2026-07-22`. Customer 2414 has 304 approved/paid orders out of 316, with expected first/latest delivery dates `2025-01-23` / `2026-09-10`. Customer 3111 has one approved but unpaid order (3364), so both delivery dates should stay blank.

Live version-10 verification: a natural `orders.updated` webhook synchronized a contact successfully. A scheduled canary synchronized existing Flex customer 2414, read 316 orders, and completed without failures on 2026-09-23 at 14:45 (Manila). Its legacy first/last order-date values were unchanged. New delivery fields were blank because no qualifying dates were found; audit counts were added in version 11 to make the reason visible in future Sync Events context.

Historical version-11 verification at 14:50 (Manila): two contacts and one linked company synchronized successfully, with zero errors. Customer 2414's 316 orders all contained delivery timestamps, but statuses were 310 approved, 5 cancelled, 1 new. Customer 2874's three orders all contained delivery timestamps and were approved. Neither history had a completed/invoiced order; both new fields therefore remained blank. The user subsequently confirmed that fulfillment statuses are not maintained and selected approved AND paid as the replacement rule.

The HEAD manifest did not contain `webapp` settings, while the working version-7 manifest did. This release explicitly carries forward its `USER_DEPLOYING` / `ANYONE_ANONYMOUS` settings so the existing Cloudflare webhook can continue to reach the same deployment URL. Its existing secret validation remains unchanged.
