function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedToken = String(props.getProperty('WEBHOOK_INTERNAL_SECRET') || '').trim();
  const suppliedToken = e && e.parameter ? String(e.parameter.token || '').trim() : '';
  if (!expectedToken || !suppliedToken || !constantTimeEquals_(expectedToken, suppliedToken)) {
    return jsonOutput_({ok: false, error: 'unauthorized'});
  }

  const mode = e && e.parameter ? String(e.parameter.mode || 'health') : 'health';
  const flexKey = String(props.getProperty(SYNC_CONSTANTS.propertyKeys.flexApiKey) || '').trim();
  const ghlToken = String(props.getProperty(SYNC_CONSTANTS.propertyKeys.ghlToken) || '').trim();

  if (mode === 'health') {
    return jsonOutput_({
      ok: true,
      mode: 'health',
      hasFlexKey: !!flexKey,
      flexKeyLength: flexKey.length,
      hasGhlToken: !!ghlToken,
      ghlTokenLength: ghlToken.length,
      hasInternalSecret: !!expectedToken
    });
  }

  if (mode === 'flex-test') {
    const customerUuid = e && e.parameter ? String(e.parameter.customerUuid || '').trim() : '';
    if (!customerUuid) return jsonOutput_({ok: false, error: 'missing_customerUuid'});

    try {
      const result = flexRequest_('/api/v1/customers/' + encodeURIComponent(customerUuid), {method: 'get', maxAttempts: 1});
      return jsonOutput_({
        ok: true,
        mode: 'flex-test',
        httpStatus: result.status,
        customerUuid: customerUuid
      });
    } catch (error) {
      return jsonOutput_({
        ok: false,
        mode: 'flex-test',
        customerUuid: customerUuid,
        httpStatus: error && error.httpStatus ? error.httpStatus : (error && error.status ? error.status : null),
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  return jsonOutput_({ok: false, error: 'unsupported_mode'});
}

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = String(props.getProperty('WEBHOOK_INTERNAL_SECRET') || '');
    const suppliedToken = e && e.parameter ? String(e.parameter.token || '') : '';
    if (!expectedToken || !suppliedToken || !constantTimeEquals_(expectedToken, suppliedToken)) {
      return jsonOutput_({ok: false, error: 'unauthorized'});
    }

    const raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (!raw) return jsonOutput_({ok: false, error: 'empty_body'});

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (parseError) {
      return jsonOutput_({ok: false, error: 'invalid_json'});
    }

    const eventType = String(payload.type || '');
    const eventId = String(payload.event_id || payload.event_uuid || '');
    const item = payload.item || {};
    if (!eventType || !eventId) {
      return jsonOutput_({ok: false, error: 'missing_event_type_or_id'});
    }

    if (!isSupportedFlexWebhookEvent_(eventType)) {
      recordWebhookEvent_(eventId, eventType, item, 'IGNORED', 'Unsupported event type.');
      return jsonOutput_({ok: true, ignored: true, eventId: eventId});
    }

    if (isWebhookEventProcessed_(eventId)) {
      return jsonOutput_({ok: true, duplicate: true, eventId: eventId});
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      return jsonOutput_({ok: false, retry: true, error: 'sync_busy'});
    }

    let run;
    try {
      run = startRun_('FLEX_WEBHOOK:' + eventType);
      const config = getConfig_();
      if (!isSyncEnabled_(config)) {
        recordWebhookEvent_(eventId, eventType, item, 'DEFERRED', 'SYNC_ENABLED is FALSE.');
        finishRun_(run, 'SKIPPED', 'Webhook received while sync disabled.');
        return jsonOutput_({ok: true, deferred: true, eventId: eventId});
      }

      const locationId = String(config.GHL_LOCATION_ID || '');
      if (!locationId) throw new Error('GHL_LOCATION_ID is missing from Config.');

      if (eventType.indexOf('companies.') === 0) {
        const companyUuid = String(item.uuid || '');
        if (!companyUuid) {
          recordWebhookEvent_(eventId, eventType, item, 'IGNORED', 'Webhook does not contain a company UUID.');
          finishRun_(run, 'SKIPPED', 'No company UUID available for company webhook event.');
          return jsonOutput_({ok: true, ignored: true, eventId: eventId});
        }

        syncFlexCompanyWebhookToGhl_(run, companyUuid, locationId);
        markWebhookEventProcessed_(eventId, eventType, item, 'SUCCESS', 'Processed by company webhook sync.');
        finishRun_(run, 'SUCCESS', 'Processed Flex webhook ' + eventType + ' event ' + eventId + '.');
        return jsonOutput_({ok: true, eventId: eventId, companyUuid: companyUuid});
      }

      const customerUuid = resolveWebhookCustomerUuid_(eventType, item);
      if (!customerUuid) {
        recordWebhookEvent_(eventId, eventType, item, 'IGNORED', 'Webhook does not contain a customer UUID.');
        finishRun_(run, 'SKIPPED', 'No customer UUID available for supported webhook event.');
        return jsonOutput_({ok: true, ignored: true, eventId: eventId});
      }

      const result = syncFlexCustomerToGhl_(run, customerUuid, locationId);
      markWebhookEventProcessed_(eventId, eventType, item, result && result.skipped ? 'SKIPPED' : 'SUCCESS', 'Processed by webhook sync.');
      finishRun_(run, 'SUCCESS', 'Processed Flex webhook ' + eventType + ' event ' + eventId + '.');
      return jsonOutput_({ok: true, eventId: eventId, customerUuid: customerUuid, skipped: !!(result && result.skipped)});
    } catch (error) {
      if (run) {
        logCaughtError_(run, 'FLEX_WEBHOOK', error, {
          entityType: 'webhook',
          flexUuid: item && item.uuid ? item.uuid : '',
          context: {eventId: eventId, eventType: eventType}
        });
        finishRun_(run, 'FAILED', error.message || String(error));
      }
      recordWebhookEvent_(eventId, eventType, item, 'FAILED', error.message || String(error));
      return jsonOutput_({ok: false, retry: true, eventId: eventId, error: 'processing_failed'});
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonOutput_({ok: false, error: 'receiver_error'});
  }
}

function isSupportedFlexWebhookEvent_(eventType) {
  return [
    'customers.created',
    'customers.updated',
    'customers.subscribed',
    'customers.unsubscribed',
    'orders.placed',
    'orders.updated',
    'orders.approved',
    'orders.invoiced',
    'orders.cancelled',
    'orders.deleted',
    'companies.created',
    'companies.updated'
  ].indexOf(String(eventType || '')) >= 0;
}

function resolveWebhookCustomerUuid_(eventType, item) {
  if (String(eventType).indexOf('customers.') === 0) return String(item.uuid || '');
  if (String(eventType).indexOf('orders.') === 0) return String(item.customer_uuid || '');
  return '';
}

function ensureWebhookEventsSheet_() {
  const ss = SpreadsheetApp.openById(SYNC_CONSTANTS.spreadsheetId);
  let sheet = ss.getSheetByName('Webhook Events');
  if (!sheet) {
    sheet = ss.insertSheet('Webhook Events');
    sheet.getRange(1, 1, 1, 8).setValues([[
      'Event ID', 'Event Type', 'Received At', 'Item UUID', 'Customer UUID', 'Status', 'Message', 'Raw Reference'
    ]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function isWebhookEventProcessed_(eventId) {
  const sheet = ensureWebhookEventsSheet_();
  if (sheet.getLastRow() <= 1) return false;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    if (String(ids[i][0]) === String(eventId)) {
      const status = String(sheet.getRange(i + 2, 6).getDisplayValue() || '');
      return status === 'SUCCESS' || status === 'SKIPPED' || status === 'IGNORED';
    }
  }
  return false;
}

function markWebhookEventProcessed_(eventId, eventType, item, status, message) {
  recordWebhookEvent_(eventId, eventType, item, status, message);
}

function recordWebhookEvent_(eventId, eventType, item, status, message) {
  const sheet = ensureWebhookEventsSheet_();
  const itemUuid = item && item.uuid ? String(item.uuid) : '';
  const customerUuid = item && item.customer_uuid ? String(item.customer_uuid) :
    (String(eventType).indexOf('customers.') === 0 ? itemUuid : '');

  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      if (String(ids[i][0]) === String(eventId)) {
        sheet.getRange(i + 2, 2, 1, 7).setValues([[
          eventType, new Date(), itemUuid, customerUuid, status, truncate_(message || '', 5000), ''
        ]]);
        return;
      }
    }
  }

  sheet.appendRow([
    eventId,
    eventType,
    new Date(),
    itemUuid,
    customerUuid,
    status,
    truncate_(message || '', 5000),
    ''
  ]);
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
