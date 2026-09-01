function executeSync_(triggerName) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  let run;
  try {
    run = startRun_(triggerName);
    const config = getConfig_();

    if (!isSyncEnabled_(config)) {
      logEvent_(run, {
        entityType: 'system',
        eventType: 'SYNC_SKIPPED',
        action: 'CHECK_SYNC_ENABLED',
        status: 'SKIPPED',
        message: 'SYNC_ENABLED is FALSE. No Flex or GHL records were changed.'
      });
      finishRun_(run, 'SKIPPED', 'Sync disabled in Config.');
      return;
    }

    const summary = runReconciliationBatch_(run, config);
    const companySummary = runCompanyReconciliationRecovery_(run, config);
    const status = summary.failures > 0 || summary.remaining > 0 ||
      companySummary.failures > 0 || companySummary.remaining > 0 ? 'PARTIAL' : 'SUCCESS';

    finishRun_(run, status,
      'Reconciliation completed. Changed customers: ' + summary.changedCustomers +
      '; changed orders: ' + summary.changedOrders +
      '; customers attempted: ' + summary.uniqueCustomers +
      '; customer skipped: ' + summary.skipped +
      '; changed companies: ' + companySummary.changedCompanies +
      '; companies attempted: ' + companySummary.companiesAttempted +
      '; failures: ' + (summary.failures + companySummary.failures) +
      '; remaining queued: ' + (summary.remaining + companySummary.remaining) + '.');
  } catch (error) {
    if (run) {
      logCaughtError_(run, 'EXECUTE_SYNC', error, {entityType: 'system'});
      finishRun_(run, 'FAILED', error.message || String(error));
    } else {
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

function runConnectionTests_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync process is already running.');

  const run = startRun_('MANUAL_CONNECTION_TEST');
  try {
    const config = getConfig_();
    if (!config.GHL_LOCATION_ID) throw new Error('GHL_LOCATION_ID is missing from Config.');

    testFlexConnection_(run);
    testGhlConnection_(run, config.GHL_LOCATION_ID);
    finishRun_(run, 'SUCCESS', 'Both read-only API connection tests passed.');
  } catch (error) {
    logCaughtError_(run, 'CONNECTION_TEST', error, {entityType: 'system'});
    finishRun_(run, 'FAILED', error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}
