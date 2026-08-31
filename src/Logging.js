function startRun_(triggerName) {
  const run = {
    id: newId_('run'),
    startedAt: new Date(),
    startedAtMs: Date.now(),
    trigger: triggerName,
    status: 'RUNNING',
    customersChecked: 0,
    customersSynced: 0,
    companiesChecked: 0,
    companiesSynced: 0,
    ordersChecked: 0,
    ordersProcessed: 0,
    eventsSuccess: 0,
    eventsFailed: 0,
    notes: ''
  };

  const sheet = getSheet_(SYNC_CONSTANTS.sheets.runs);
  sheet.appendRow([
    run.id, run.startedAt, '', run.trigger, run.status,
    0, 0, 0, 0, 0, 0, 0, 0, '', ''
  ]);
  run.rowNumber = sheet.getLastRow();
  return run;
}

function finishRun_(run, status, notes) {
  run.status = status;
  run.notes = truncate_(notes || '', 5000);
  const finishedAt = new Date();
  const row = [
    run.id,
    run.startedAt,
    finishedAt,
    run.trigger,
    run.status,
    run.customersChecked,
    run.customersSynced,
    run.companiesChecked,
    run.companiesSynced,
    run.ordersChecked,
    run.ordersProcessed,
    run.eventsSuccess,
    run.eventsFailed,
    elapsedMs_(run.startedAtMs),
    run.notes
  ];
  getSheet_(SYNC_CONSTANTS.sheets.runs).getRange(run.rowNumber, 1, 1, row.length).setValues([row]);
}

function logEvent_(run, event) {
  const row = [
    event.eventId || newId_('evt'),
    run.id,
    new Date(),
    event.entityType || 'system',
    event.flexUuid || '',
    event.flexId || '',
    event.eventType || '',
    event.action || '',
    event.ghlRecordType || '',
    event.ghlRecordId || '',
    event.companyUuid || '',
    event.status || 'SUCCESS',
    event.attempt || 1,
    event.durationMs || 0,
    truncate_(event.message || '', 5000),
    safeJson_(event.context || {})
  ];
  getSheet_(SYNC_CONSTANTS.sheets.events).appendRow(row);
  if (row[11] === 'SUCCESS') run.eventsSuccess += 1;
  else run.eventsFailed += 1;
  return row[0];
}

function logError_(run, eventId, errorData) {
  const row = [
    newId_('err'),
    run.id,
    eventId || '',
    new Date(),
    errorData.entityType || 'system',
    errorData.flexUuid || '',
    errorData.flexId || '',
    errorData.operation || '',
    errorData.httpMethod || '',
    errorData.endpoint || '',
    errorData.httpStatus || '',
    errorData.errorCode || '',
    truncate_(errorData.message || 'Unknown error', 5000),
    errorData.attempt || 1,
    errorData.retryable === true,
    false,
    '',
    '',
    safeJson_(errorData.context || {})
  ];
  getSheet_(SYNC_CONSTANTS.sheets.errors).appendRow(row);
  return row[0];
}

function logCaughtError_(run, operation, error, context) {
  const eventId = logEvent_(run, {
    entityType: (context && context.entityType) || 'system',
    flexUuid: context && context.flexUuid,
    flexId: context && context.flexId,
    eventType: 'ERROR',
    action: operation,
    status: 'FAILED',
    attempt: error.attempt || 1,
    message: error.message || String(error),
    context: context || {}
  });

  return logError_(run, eventId, {
    entityType: (context && context.entityType) || 'system',
    flexUuid: context && context.flexUuid,
    flexId: context && context.flexId,
    operation: operation,
    httpMethod: error.httpMethod,
    endpoint: error.endpoint,
    httpStatus: error.httpStatus,
    errorCode: error.errorCode,
    message: error.message || String(error),
    attempt: error.attempt || 1,
    retryable: error.retryable === true,
    context: {
      request: error.requestContext,
      response: error.responseBody,
      stack: error.stack
    }
  });
}
