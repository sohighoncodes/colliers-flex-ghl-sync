function flexRequest_(path, options) {
  const apiKey = getRequiredSecret_(SYNC_CONSTANTS.propertyKeys.flexApiKey);
  const requestOptions = options || {};
  return apiRequest_({
    url: SYNC_CONSTANTS.flexBaseUrl + path,
    method: requestOptions.method || 'get',
    payload: requestOptions.payload,
    maxAttempts: requestOptions.maxAttempts,
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json'
    }
  });
}

function ghlRequest_(path, options) {
  const token = getRequiredSecret_(SYNC_CONSTANTS.propertyKeys.ghlToken);
  const requestOptions = options || {};
  return apiRequest_({
    url: SYNC_CONSTANTS.ghlBaseUrl + path,
    method: requestOptions.method || 'get',
    payload: requestOptions.payload,
    maxAttempts: requestOptions.maxAttempts,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Version': requestOptions.apiVersion || SYNC_CONSTANTS.ghlApiVersion,
      'Accept': 'application/json'
    }
  });
}

function testFlexConnection_(run) {
  const startedAtMs = Date.now();
  const response = flexRequest_('/api/v1/orders?per_page=1&sort_order=desc');
  logEvent_(run, {
    entityType: 'system',
    eventType: 'CONNECTION_TEST',
    action: 'FLEX_API_READ',
    status: 'SUCCESS',
    attempt: response.attempt,
    durationMs: elapsedMs_(startedAtMs),
    message: 'Flex API connection successful.',
    context: {httpStatus: response.status}
  });
  return response;
}

function testGhlConnection_(run, locationId) {
  const startedAtMs = Date.now();
  const response = ghlRequest_('/locations/' + encodeURIComponent(locationId), {method: 'get'});
  logEvent_(run, {
    entityType: 'system',
    eventType: 'CONNECTION_TEST',
    action: 'GHL_API_READ',
    ghlRecordType: 'location',
    ghlRecordId: locationId,
    status: 'SUCCESS',
    attempt: response.attempt,
    durationMs: elapsedMs_(startedAtMs),
    message: 'GHL API connection successful.',
    context: {httpStatus: response.status}
  });
  return response;
}

function runFlexOrderSchemaInspection_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync process is already running.');

  const run = startRun_('MANUAL_FLEX_SCHEMA_INSPECTION');
  try {
    const startedAtMs = Date.now();
    const response = flexRequest_('/api/v1/orders?per_page=1&sort_order=desc');
    logEvent_(run, {
      entityType: 'order',
      eventType: 'SCHEMA_INSPECTION',
      action: 'READ_FLEX_ORDER_SHAPE',
      status: 'SUCCESS',
      attempt: response.attempt,
      durationMs: elapsedMs_(startedAtMs),
      message: 'Captured the latest Flex order response structure without logging field values or customer PII.',
      context: {
        httpStatus: response.status,
        responseShape: describeShape_(response.body)
      }
    });
    finishRun_(run, 'SUCCESS', 'Flex order schema inspection passed.');
  } catch (error) {
    logCaughtError_(run, 'FLEX_ORDER_SCHEMA_INSPECTION', error, {entityType: 'order'});
    finishRun_(run, 'FAILED', error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function summarizeCustomFields_(responseBody) {
  const candidates = []
    .concat((responseBody && responseBody.customFields) || [])
    .concat((responseBody && responseBody.fields) || []);

  return candidates
    .filter(function(field) { return field && !field.folder; })
    .map(function(field) {
      return {
        id: field.id || '',
        name: field.name || '',
        fieldKey: field.fieldKey || '',
        objectKey: field.objectKey || field.model || '',
        dataType: field.dataType || ''
      };
    });
}

function runGhlFieldMappingInspection_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync process is already running.');

  const run = startRun_('MANUAL_GHL_FIELD_INSPECTION');
  try {
    const config = getConfig_();
    const locationId = config.GHL_LOCATION_ID;
    if (!locationId) throw new Error('GHL_LOCATION_ID is missing from Config.');

    const contactResponse = ghlRequest_(
      '/locations/' + encodeURIComponent(locationId) + '/customFields?model=contact',
      {method: 'get', apiVersion: 'v3'}
    );
    const contactFields = summarizeCustomFields_(contactResponse.body);
    logEvent_(run, {
      entityType: 'contact',
      eventType: 'FIELD_INSPECTION',
      action: 'READ_GHL_CONTACT_FIELDS',
      ghlRecordType: 'custom_field',
      status: 'SUCCESS',
      attempt: contactResponse.attempt,
      durationMs: contactResponse.durationMs,
      message: 'Captured GHL contact field IDs, names, keys, and data types.',
      context: {fieldCount: contactFields.length, fields: contactFields}
    });

    const companyResponse = ghlRequest_(
      '/custom-fields/object-key/business?locationId=' + encodeURIComponent(locationId),
      {method: 'get', apiVersion: '2021-07-28'}
    );
    const companyFields = summarizeCustomFields_(companyResponse.body);
    logEvent_(run, {
      entityType: 'company',
      eventType: 'FIELD_INSPECTION',
      action: 'READ_GHL_COMPANY_FIELDS',
      ghlRecordType: 'custom_field',
      status: 'SUCCESS',
      attempt: companyResponse.attempt,
      durationMs: companyResponse.durationMs,
      message: 'Captured GHL company field IDs, names, keys, and data types.',
      context: {fieldCount: companyFields.length, fields: companyFields}
    });

    finishRun_(run, 'SUCCESS', 'GHL contact and company field inspection passed.');
  } catch (error) {
    logCaughtError_(run, 'GHL_FIELD_MAPPING_INSPECTION', error, {entityType: 'system'});
    finishRun_(run, 'FAILED', error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}
