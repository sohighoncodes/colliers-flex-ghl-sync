function runCompanyReconciliationRecovery_(run, config) {
  const locationId = String(config.GHL_LOCATION_ID || '');
  if (!locationId) throw new Error('GHL_LOCATION_ID is missing from Config.');

  const maxCompanies = Math.max(1, Number(config.SYNC_MAX_COMPANIES_PER_RUN || config.SYNC_MAX_CUSTOMERS_PER_RUN || 10));
  const maxPages = Math.max(1, Number(config.SYNC_MAX_SOURCE_PAGES || 5));
  const overlapMinutes = Math.max(0, Number(config.SYNC_CURSOR_OVERLAP_MINUTES || 2));
  const initialLookbackHours = Math.max(1, Number(config.SYNC_INITIAL_LOOKBACK_HOURS || 24));

  let pending = getPendingCompanyReconciliation_();
  if (!pending || !pending.uuids || !pending.uuids.length) {
    const snapshotToIso = run.startedAt.toISOString();
    const companyCursor = getCursorIso_('company', 'updated_at_cursor', initialLookbackHours, overlapMinutes);
    const changedCompanies = listChangedFlexCompanies_(companyCursor, snapshotToIso, maxPages);

    pending = {
      companyCursor: companyCursor,
      snapshotToIso: snapshotToIso,
      changedCompanies: changedCompanies.length,
      uuids: changedCompanies
        .filter(function(company) { return company && company.uuid; })
        .map(function(company) { return String(company.uuid); })
    };
  }

  const batch = pending.uuids.slice(0, maxCompanies);
  const remaining = pending.uuids.slice(maxCompanies);
  const retry = [];
  let failures = 0;

  for (let i = 0; i < batch.length; i += 1) {
    const companyUuid = batch[i];
    try {
      syncFlexCompanyWebhookToGhl_(run, companyUuid, locationId);
    } catch (error) {
      failures += 1;
      retry.push(companyUuid);
      logCaughtError_(run, 'SYNC_COMPANY_RECOVERY', error, {
        entityType: 'company',
        flexUuid: companyUuid
      });
    }
  }

  const stillPending = retry.concat(remaining);
  if (stillPending.length) {
    pending.uuids = stillPending;
    setPendingCompanyReconciliation_(pending);
    logEvent_(run, {
      entityType: 'system',
      eventType: 'CURSOR_HELD',
      action: 'COMPANY_RECONCILIATION_CURSOR',
      status: 'SKIPPED',
      message: failures
        ? 'Some company recovery syncs failed; failed and unprocessed companies remain queued.'
        : 'Company recovery batch limit reached; remaining companies are queued for the next run.',
      context: {
        failures: failures,
        attempted: batch.length,
        remaining: stillPending.length
      }
    });
  } else {
    setSyncState_('company', 'updated_at_cursor', pending.snapshotToIso, new Date(), 'Advanced after company reconciliation window completed.');
    clearPendingCompanyReconciliation_();
  }

  return {
    changedCompanies: Number(pending.changedCompanies || 0),
    companiesAttempted: batch.length,
    failures: failures,
    remaining: stillPending.length,
    companyCursor: pending.companyCursor,
    snapshotToIso: pending.snapshotToIso
  };
}

function listChangedFlexCompanies_(fromIso, toIso, maxPages) {
  const all = [];
  const perPage = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = flexRequest_(
      '/api/v1/companies?per_page=' + perPage +
      '&page=' + page +
      '&sort_order=asc' +
      '&updated_at_datetime_from=' + encodeURIComponent(fromIso) +
      '&updated_at_datetime_to=' + encodeURIComponent(toIso)
    );
    const items = getCollectionItems_(response.body);
    Array.prototype.push.apply(all, items);
    if (!(response.body && response.body.next_page) || items.length === 0) break;
  }
  return all;
}

function getPendingCompanyReconciliation_() {
  const state = getSyncState_('system', 'company_reconciliation_pending');
  if (!state || !state.value) return null;
  try {
    const parsed = JSON.parse(String(state.value));
    return parsed && Array.isArray(parsed.uuids) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function setPendingCompanyReconciliation_(pending) {
  setSyncState_(
    'system',
    'company_reconciliation_pending',
    JSON.stringify(pending),
    '',
    'Pending company recovery reconciliation batch.'
  );
}

function clearPendingCompanyReconciliation_() {
  setSyncState_('system', 'company_reconciliation_pending', '', new Date(), 'No pending company recovery records.');
}
