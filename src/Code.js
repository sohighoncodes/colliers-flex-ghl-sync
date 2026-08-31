function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Flex ↔ GHL Sync')
    .addItem('Run logging self-test', 'runLoggingSelfTest')
    .addItem('Test API connections', 'testApiConnections')
    .addItem('Inspect Flex order schema', 'inspectFlexOrderSchema')
    .addItem('Inspect GHL field mappings', 'inspectGhlFieldMappings')
    .addSeparator()
    .addItem('Test latest Flex customer → GHL', 'testLatestFlexCustomerSync')
    .addItem('Test Flex customer 2874 → known GHL contact', 'testFlexCustomer2874Sync')
    .addItem('Test linked Flex company → existing GHL company', 'testKnownFlexCompanySync')
    .addSeparator()
    .addItem('Run sync now', 'runSyncNow')
    .addItem('Install 5-minute reconciliation trigger', 'installSyncTrigger')
    .addItem('Remove sync triggers', 'removeSyncTriggers')
    .addSeparator()
    .addItem('Show webhook receiver setup', 'showWebhookSetup')
    .addItem('Inspect Flex webhooks', 'inspectFlexWebhooks')
    .addItem('Register Flex webhook', 'registerFlexWebhook')
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

function inspectFlexOrderSchema() {
  runFlexOrderSchemaInspection_();
}

function inspectGhlFieldMappings() {
  runGhlFieldMappingInspection_();
}

function showWebhookSetup() {
  return showWebhookSetup_();
}

function inspectFlexWebhooks() {
  return inspectFlexWebhooks_();
}

function registerFlexWebhook() {
  return registerFlexWebhook_();
}

function testLatestFlexCustomerSync() {
  const result = runLatestFlexCustomerSyncTest_();
  SpreadsheetApp.getUi().alert(
    'Controlled sync test completed.\n\nFlex Customer UUID: ' + result.flexCustomerUuid +
    '\nGHL Contact ID: ' + result.ghlContactId +
    '\nOrder Count: ' + result.metrics.orderCount +
    '\nLifetime Value: ' + result.metrics.lifetimeValue
  );
}

function testFlexCustomer2874Sync() {
  const result = runTargetedCustomer2874SyncTest_();
  SpreadsheetApp.getUi().alert(
    'Targeted customer test completed.\n\nFlex Customer ID: ' + result.flexCustomerId +
    '\nFlex Customer UUID: ' + result.flexCustomerUuid +
    '\nGHL Contact ID: ' + result.ghlContactId +
    '\nCompany UUID: ' + (result.companyUuid || '[none]') +
    '\nCompany UUID Source: ' + result.companyUuidSource +
    '\nOrder Count: ' + result.metrics.orderCount +
    '\nLifetime Value: ' + result.metrics.lifetimeValue
  );
}

function testKnownFlexCompanySync() {
  const result = runKnownFlexCompanySyncTest_();
  SpreadsheetApp.getUi().alert(
    'Targeted company test completed.\n\nFlex Company UUID: ' + result.flexCompanyUuid +
    '\nGHL Business ID: ' + result.ghlBusinessId +
    '\nCompany Order Count: ' + result.metrics.orderCount +
    '\nCompany Lifetime Value: ' + result.metrics.lifetimeValue +
    '\nFirst Order Date: ' + result.metrics.firstOrderDate +
    '\nLast Order Date: ' + result.metrics.lastOrderDate
  );
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
  SpreadsheetApp.getUi().alert('The 5-minute reconciliation trigger is installed. Webhooks remain the primary near-real-time path; this trigger is the recovery safety net.');
}

function removeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runScheduledSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
