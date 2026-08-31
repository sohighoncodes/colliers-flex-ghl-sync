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
