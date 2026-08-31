const GHL_CONTACT_FIELD_IDS = Object.freeze({
  flexCustomerUuid: 'Jfbcm0jtadMvzeUJNyeb',
  flexCustomerId: 'SHFM7B6J0Z0G7RMGgNO0',
  flexAccountId: 'oXysSV0pouhqSM5XKol0',
  lifetimeValue: 'qRoxX2Vt9VVIhV4Bv719',
  orderCount: 'uwwKp21G1u6QZSXAIsEz',
  firstOrderDate: '6DbWOP7w8JdpPlh2bZMW',
  lastOrderDate: 'U58XvqZbP5sY6OFnKBLB',
  flexLatestOrderDate: '5hiylYnpqgYcxFNLjhq3',
  daysSinceLastOrder: 'ZfdhDRJhdob1a0mRdeNo',
  flexLatestOrderId: 'hKJXtE9UBiVAY1rV94DS',
  flexLatestOrderUuid: 'sQVec8kZPJvQbJMpNCOs',
  flexLatestOrderStatus: 'ZCMLgGPeGDtPGXsnuffV',
  flexHasOrder: 'c46Eq8a74cJijt4CqOUa',
  flexLookupStatus: 'jq5le0sNV3laFCizPYzl',
  flexLookupMethod: 'yoLC3yoh1x26v0Qz2cMu',
  flexLastLookupAt: 'zAiJ3Qi0kXAyef3FesUJ'
});

function runLatestFlexCustomerSyncTest_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync process is already running.');

  const run = startRun_('MANUAL_LATEST_CUSTOMER_SYNC_TEST');
  try {
    const config = getConfig_();
    if (!config.GHL_LOCATION_ID) throw new Error('GHL_LOCATION_ID is missing from Config.');

    const latestOrderResponse = flexRequest_('/api/v1/orders?per_page=1&sort_order=desc&sort_field=created_at');
    const latestOrders = getCollectionItems_(latestOrderResponse.body);
    if (!latestOrders.length) throw new Error('Flex returned no orders for the controlled sync test.');

    const seedOrder = latestOrders[0];
    if (!seedOrder.customer_uuid) throw new Error('Latest Flex order has no customer_uuid.');

    run.ordersChecked += 1;
    const customerResponse = flexRequest_('/api/v1/customers/' + encodeURIComponent(seedOrder.customer_uuid));
    const customer = customerResponse.body;
    if (!customer || !customer.uuid) throw new Error('Flex customer response is missing uuid.');
    if (!customer.email) throw new Error('Flex customer ' + customer.uuid + ' has no email; refusing to create/upsert a GHL contact without a deterministic email match.');
    run.customersChecked += 1;

    const orders = listAllFlexCustomerOrders_(customer.uuid);
    run.ordersChecked += orders.length;
    const metrics = aggregateCustomerOrders_(orders);

    const payload = buildGhlContactPayload_(customer, metrics, config.GHL_LOCATION_ID);
    const existingMap = findEntityMap_('customer', customer.uuid, customer.id);
    let response;
    let action;

    if (existingMap && existingMap.values[5]) {
      const ghlContactId = String(existingMap.values[5]);
      response = ghlRequest_('/contacts/' + encodeURIComponent(ghlContactId), {
        method: 'put',
        apiVersion: 'v3',
        payload: removeLocationId_(payload)
      });
      action = 'UPDATE_GHL_CONTACT_BY_ENTITY_MAP';
    } else {
      response = ghlRequest_('/contacts/upsert', {
        method: 'post',
        apiVersion: 'v3',
        payload: payload
      });
      action = 'UPSERT_GHL_CONTACT_BY_EMAIL';
    }

    const responseContact = response.body && response.body.contact;
    const ghlContactId = responseContact && responseContact.id;
    if (!ghlContactId) throw new Error('GHL contact write succeeded but response did not include contact.id.');

    upsertEntityMap_({
      entityType: 'customer',
      flexUuid: customer.uuid,
      flexId: customer.id,
      flexExternalRef: customer.external_reference_id,
      ghlRecordType: 'contact',
      ghlRecordId: ghlContactId,
      parentFlexCompanyUuid: customer.company_uuid,
      syncStatus: 'SYNCED',
      notes: 'Controlled latest-customer sync test.'
    });

    run.customersSynced += 1;
    run.ordersProcessed += orders.length;

    logEvent_(run, {
      entityType: 'customer',
      flexUuid: customer.uuid,
      flexId: customer.id,
      eventType: 'SYNC_TEST',
      action: action,
      ghlRecordType: 'contact',
      ghlRecordId: ghlContactId,
      companyUuid: customer.company_uuid,
      status: 'SUCCESS',
      attempt: response.attempt,
      durationMs: response.durationMs,
      message: response.body && response.body.new === true
        ? 'Created GHL contact from the latest Flex order customer.'
        : 'Updated/upserted GHL contact from the latest Flex order customer.',
      context: {
        createdNewGhlContact: response.body && response.body.new === true,
        totalCustomerOrders: orders.length,
        nonCancelledOrderCount: metrics.orderCount,
        lifetimeValue: metrics.lifetimeValue,
        firstOrderDate: metrics.firstOrderDate,
        lastOrderDate: metrics.lastOrderDate,
        latestOrderId: metrics.latestOrderId,
        latestOrderUuid: metrics.latestOrderUuid,
        latestOrderStatus: metrics.latestOrderStatus
      }
    });

    finishRun_(run, 'SUCCESS', 'Controlled latest Flex customer → GHL contact sync test passed.');
    return {flexCustomerUuid: customer.uuid, ghlContactId: ghlContactId, metrics: metrics};
  } catch (error) {
    logCaughtError_(run, 'LATEST_CUSTOMER_SYNC_TEST', error, {entityType: 'customer'});
    finishRun_(run, 'FAILED', error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function listAllFlexCustomerOrders_(customerUuid) {
  const perPage = 100;
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = flexRequest_(
      '/api/v1/customers/' + encodeURIComponent(customerUuid) +
      '/orders?per_page=' + perPage + '&page=' + page + '&sort_order=desc&sort_field=created_at'
    );
    const items = getCollectionItems_(response.body);
    Array.prototype.push.apply(all, items);
    if (!(response.body && response.body.next_page) || items.length === 0) break;
    if (page === 100) throw new Error('Customer order pagination exceeded 100 pages; aborting for safety.');
  }
  return all;
}

function getCollectionItems_(body) {
  if (body && Array.isArray(body.items)) return body.items;
  if (Array.isArray(body)) return body;
  return [];
}

function aggregateCustomerOrders_(orders) {
  const sorted = (orders || []).slice().sort(function(a, b) {
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });
  const eligible = sorted.filter(function(order) {
    return String(order.status || '').toLowerCase() !== 'cancelled';
  });
  const latest = eligible.length ? eligible[eligible.length - 1] : null;
  const first = eligible.length ? eligible[0] : null;
  const lifetimeValue = eligible.reduce(function(total, order) {
    const value = Number(order.grand_total || 0);
    return total + (isNaN(value) ? 0 : value);
  }, 0);

  return {
    lifetimeValue: Math.round(lifetimeValue * 100) / 100,
    orderCount: eligible.length,
    firstOrderDate: first ? toDateOnly_(first.created_at) : '',
    lastOrderDate: latest ? toDateOnly_(latest.created_at) : '',
    daysSinceLastOrder: latest ? daysSince_(latest.created_at) : '',
    latestOrderId: latest ? (latest.order_id || latest.id || '') : '',
    latestOrderUuid: latest ? (latest.uuid || '') : '',
    latestOrderStatus: latest ? (latest.status || '') : '',
    hasOrder: eligible.length > 0 ? 'Yes' : 'No'
  };
}

function buildGhlContactPayload_(customer, metrics, locationId) {
  const phone = customer.mobile || customer.phone || '';
  const customFields = [
    ghlField_(GHL_CONTACT_FIELD_IDS.flexCustomerUuid, customer.uuid),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexCustomerId, customer.id),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexAccountId, customer.account_id),
    ghlField_(GHL_CONTACT_FIELD_IDS.lifetimeValue, metrics.lifetimeValue),
    ghlField_(GHL_CONTACT_FIELD_IDS.orderCount, metrics.orderCount),
    ghlField_(GHL_CONTACT_FIELD_IDS.firstOrderDate, metrics.firstOrderDate),
    ghlField_(GHL_CONTACT_FIELD_IDS.lastOrderDate, metrics.lastOrderDate),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexLatestOrderDate, metrics.lastOrderDate),
    ghlField_(GHL_CONTACT_FIELD_IDS.daysSinceLastOrder, metrics.daysSinceLastOrder),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexLatestOrderId, metrics.latestOrderId),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexLatestOrderUuid, metrics.latestOrderUuid),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexLatestOrderStatus, metrics.latestOrderStatus),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexHasOrder, metrics.hasOrder),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexLookupStatus, 'Linked'),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexLookupMethod, 'Flex customer UUID / email upsert'),
    ghlField_(GHL_CONTACT_FIELD_IDS.flexLastLookupAt, nowIso_())
  ].filter(function(field) { return field !== null; });

  return {
    locationId: String(locationId),
    firstName: customer.first_name || '',
    lastName: customer.last_name || '',
    email: customer.email,
    phone: phone,
    address1: customer.address1 || '',
    city: customer.suburb || '',
    state: customer.state || '',
    postalCode: customer.postcode || '',
    country: customer.country || '',
    companyName: customer.company || '',
    source: 'Flex Catering Sync',
    createNewIfDuplicateAllowed: false,
    customFields: customFields
  };
}

function ghlField_(id, value) {
  if (value === undefined || value === null || value === '') return null;
  return {id: id, fieldValue: value};
}

function removeLocationId_(payload) {
  const copy = {};
  Object.keys(payload).forEach(function(key) {
    if (key !== 'locationId' && key !== 'createNewIfDuplicateAllowed') copy[key] = payload[key];
  });
  return copy;
}

function toDateOnly_(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function daysSince_(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}
