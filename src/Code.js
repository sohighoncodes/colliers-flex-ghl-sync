function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Flex ↔ GHL Sync')
    .addItem('Run logging self-test', 'runLoggingSelfTest')
    .addItem('Test API connections', 'testApiConnections')
    .addSeparator()
    .addItem('Run sync now', 'runSyncNow')
    .addItem('Install 5-minute trigger', 'installSyncTrigger')
    .addItem('Remove sync triggers', 'removeSyncTriggers')
    .addToUi();
}

function runScheduledSync() {
  executeSync_('SCHEDULED');
}

function runSyncNow() {
  executeSync_('MANUAL');
}

function testApiConnections() {
  runConnectionTests_();
}

function runLoggingSelfTest() {
  const run = startRun_('MANUAL_LOGGING_SELF_TEST');
  try {
    const eventId = logEvent_(run, {
      entityType: 'system',
      eventType: 'SELF_TEST',
      action: 'WRITE_OPERATIONAL_LOGS',
      status: 'SUCCESS',
      message: 'Sync Runs and Sync Events logging test passed.',
      context: {
        spreadsheetId: SYNC_CONSTANTS.spreadsheetId,
        secretsIncluded: false
      }
    });
    finishRun_(run, 'SUCCESS', 'Logging self-test passed. Event ID: ' + eventId);
  } catch (error) {
    if (run && run.rowNumber) {
      logCaughtError_(run, 'LOGGING_SELF_TEST', error, {entityType: 'system'});
      finishRun_(run, 'FAILED', error.message || String(error));
    }
    throw error;
  }
}

function installSyncTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger('runScheduledSync')
    .timeBased()
    .everyMinutes(5)
    .create();
  SpreadsheetApp.getUi().alert('The 5-minute sync trigger is installed. SYNC_ENABLED remains controlled by the Config tab.');
}

function removeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runScheduledSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
