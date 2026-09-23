# Delivery date sync — 2026-09-23

## Mapping

Both fields are DATE fields on GHL contacts in Colliers Catering (`disULVGEDcwvApbCceP2`).

| Field | GHL key | GHL ID |
| --- | --- | --- |
| Flex First Order Delivery Date | `contact.flex_first_order_delivery_date` | `QfxWfMkUxc51TxV4HRC0` |
| Flex Latest Order Delivery Date | `contact.flex_latest_order_delivery_date` | `DhfdByYXNVysv9ZokInp` |

Select the earliest and latest valid `delivery_datetime` across the returned customer order history, independently of placement chronology. Only completed/invoiced orders with a delivery timestamp at or before the sync time qualify. Flex documents those states as completed; cancelled, not-converted, pending, new, approved, ready, unknown and future deliveries do not qualify. Format the date in `Australia/Sydney` (the verified GHL location timezone), including daylight saving. The timestamp is Flex's assigned delivery/pickup timestamp, not independently verified proof of delivery; this relies on Colliers maintaining completed/invoiced statuses accurately.

Missing/invalid delivery dates and histories with no qualifying deliveries send blanks to remove stale values in these two fields. Do not substitute the placement date. Existing UTC placement-date calculations, totals, their existing status filtering, company metrics, contact matching, retries, webhooks and reconciliation are preserved.

The shared contact payload builder handles both webhook and scheduled syncs. Existing contacts acquire the fields when next synchronized. Every refresh reads the paginated customer order history, so the first date is the earliest qualifying delivery returned by Flex, even when it predates this deployment. Records absent from Flex cannot be reconstructed.

## Deployment

The release is immutable **version 11**, adding source-status audit counts to version 10. The existing webhook deployment `AKfycbz8f1M74Vht5Ys4zuP_e7wW-dF70557Hcv1_5dYL5cpW_KjpROGWHmLMM9xmeuJkatSDA` now targets version 11; its URL and Cloudflare settings are unchanged. HEAD contains the same source for scheduled triggers. The unauthenticated endpoint still returns `unauthorized` as expected.

## Recovery

Before any source update, live HEAD was saved as immutable Apps Script **version 8**. The original webhook deployment uses **version 7**; HEAD and version 7 already differ, so both must be restored for a complete rollback. The local Git tag is `rollback/pre-delivery-dates-2026-09-23` (baseline commit `78598dac390007fb3424251d52ea9a4352fd8eb0`).

One-command full rollback from this repository:

```powershell
.\scripts\rollback-delivery-dates.ps1 -Apply
```

Omit `-Apply` to display the plan. The script downloads version 8 into a fresh temporary checkout, restores HEAD for time-based triggers, and re-points the existing webhook deployment to version 7. No API keys are required beyond the existing clasp login. GHL fields and their current values remain available; reverting code does not undo already synchronized data.

Emergency feature-only switch: in Apps Script Project Settings → Script Properties, set `FLEX_DELIVERY_DATE_SYNC_ENABLED` to `false`. This removes the two new fields from future payloads in both execution paths while allowing all legacy synchronization to continue. Remove the property or set it to `true` to re-enable.

## Verification

`npm test` passes 12 checks covering delivery chronology, completed/invoiced status eligibility, future-date exclusion, cancellation recalculation, missing/invalid dates, Sydney day boundaries and daylight saving, explicit blank values, the emergency switch, source audit counts, mapped-contact/upsert payloads, and full legacy metric/payload equality against the saved baseline. It also parses all Apps Script JavaScript together and checks the original web-app access settings.

Live version-10 verification: a natural `orders.updated` webhook synchronized a contact successfully. A scheduled canary synchronized existing Flex customer 2414, read 316 orders, and completed without failures on 2026-09-23 at 14:45 (Manila). Its legacy first/last order-date values were unchanged. New delivery fields were blank because no qualifying dates were found; audit counts were added in version 11 to make the reason visible in future Sync Events context.

Live version-11 verification at 14:50 (Manila): two contacts and one linked company synchronized successfully, with zero errors. Customer 2414's 316 orders all contained delivery timestamps, but statuses were 310 approved, 5 cancelled, 1 new. Customer 2874's three orders all contained delivery timestamps and were approved. Neither history had a completed/invoiced order; both new fields therefore remained blank. This is source eligibility, not a missing delivery field or API write failure. Broader backfill is pending resolution of this observed status mismatch.

The HEAD manifest did not contain `webapp` settings, while the working version-7 manifest did. This release explicitly carries forward its `USER_DEPLOYING` / `ANYONE_ANONYMOUS` settings so the existing Cloudflare webhook can continue to reach the same deployment URL. Its existing secret validation remains unchanged.
