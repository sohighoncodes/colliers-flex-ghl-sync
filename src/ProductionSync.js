function runReconciliationBatch_(run, config) {
  const locationId = String(config.GHL_LOCATION_ID || '');
  if (!locationId) throw new Error('GHL_LOCATION_ID is missing from Config.');

  const maxCustomers = Math.max(1, Number(config.SYNC_MAX_CUSTOMERS_PER_RUN || 50));
  const maxPages = Math.max(1, Number(config.SYNC_MAX_SOURCE_PAGES || 5));
  const overlapMinutes = Math.max(0, Number(config.SYNC_CURSOR_OVERLAP_MINUTES || 2));
  const initialLookbackHours = Math.max(1, Number(config.SYNC_INITIAL_LOOKBACK_HOURS || 24));
  const snapshotToIso = run.startedAt.toISOString();

  const customerCursor = getCursorIso_('customer', 'updated_at_cursor', initialLookbackHours, overlapMinutes);
  const orderCursor = getCursorIso_('order', 'updated_at_cursor', initialLookbackHours, overlapMinutes);
  const customerUuids = {};

  const changedCustomers = listChangedFlexCustomers_(customerCursor, snapshotToIso, maxPages);
  changedCustomers.forEach(function(customer) {
    if (customer && customer.uuid) customerUuids[customer.uuid] = true;
  });

  const changedOrders = listChangedFlexOrders_(orderCursor, snapshotToIso, maxPages);
  changedOrders.forEach(function(order) {
    if (order && order.customer_uuid) customerUuids[order.customer_uuid] = true;
  });
  run.ordersChecked += changedOrders.length;

  const uuids = Object.keys(customerUuids).slice(0, maxCustomers);
  let failures = 0;

  for (let i = 0; i < uuids.length; i += 1) {
    const customerUuid = uuids[i];
    try {
      syncFlexCustomerToGhl_(run, customerUuid, locationId);
    } catch (error) {
      failures += 1;
      logCaughtError_(run, 'SYNC_CUSTOMER', error, {
        entityType: 'customer',
        flexUuid: customerUuid
      });
    }
  }

  if (failures === 0 && uuids.length < maxCustomers) {
    setSyncState_('customer', 'updated_at_cursor', snapshotToIso, new Date(), 'Advanced after successful reconciliation batch.');
    setSyncState_('order', 'updated_at_cursor', snapshotToIso, new Date(), 'Advanced after successful reconciliation batch.');
  } else if (failures > 0) {
    logEvent_(run, {
      entityType: 'system',
      eventType: 'CURSOR_HELD',
      action: 'RECONCILIATION_CURSOR',
      status: 'SKIPPED',
      message: 'One or more customer syncs failed, so source cursors were not advanced. The next run will retry the same window.',
      context: {failures: failures, customersAttempted: uuids.length}
    });
  } else {
    logEvent_(run, {
      entityType: 'system',
      eventType: 'CURSOR_HELD',
      action: 'RECONCILIATION_CURSOR',
      status: 'SKIPPED',
      message: 'Customer run limit was reached, so source cursors were not advanced. The next run will continue replaying the same safe window.',
      context: {maxCustomers: maxCustomers, customersAttempted: uuids.length}
    });
  }

  return {
    changedCustomers: changedCustomers.length,
    changedOrders: changedOrders.length,
    uniqueCustomers: uuids.length,
    failures: failures,
    customerCursor: customerCursor,
    orderCursor: orderCursor,
    snapshotToIso: snapshotToIso
  };
}

function getCursorIso_(entityType, stateKey, initialLookbackHours, overlapMinutes) {
  const state = getSyncState_(entityType, stateKey);
  let base;
  if (state && state.value) {
    base = new Date(state.value);
  } else {
    base = new Date(Date.now() - initialLookbackHours * 3600000);
  }
  if (isNaN(base.getTime())) base = new Date(Date.now() - initialLookbackHours * 3600000);
  return new Date(base.getTime() - overlapMinutes * 60000).toISOString();
}

function listChangedFlexCustomers_(fromIso, toIso, maxPages) {
  const all = [];
  const perPage = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const path = '/api/v1/customers?per_page=' + perPage +
      '&page=' + page +
      '&sort_order=asc&sort_field=updated_at' +
      '&updated_at_datetime_from=' + encodeURIComponent(fromIso) +
      '&updated_at_datetime_to=' + encodeURIComponent(toIso);
    const response = flexRequest_(path);
    const items = getCollectionItems_(response.body);
    Array.prototype.push.apply(all, items);
    if (!(response.body && response.body.next_page) || items.length === 0) break;
  }
  return all;
}

function listChangedFlexOrders_(fromIso, toIso, maxPages) {
  const all = [];
  const perPage = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const path = '/api/v1/orders?per_page=' + perPage +
      '&page=' + page +
      '&sort_order=asc&sort_field=created_at' +
      '&updated_at_datetime_from=' + encodeURIComponent(fromIso) +
      '&updated_at_datetime_to=' + encodeURIComponent(toIso);
    const response = flexRequest_(path);
    const items = getCollectionItems_(response.body);
    Array.prototype.push.apply(all, items);
    if (!(response.body && response.body.next_page) || items.length === 0) break;
  }
  return all;
}

function syncFlexCustomerToGhl_(run, customerUuid, locationId) {
  const customerResponse = flexRequest_('/api/v1/customers/' + encodeURIComponent(customerUuid));
  const customer = customerResponse.body;
  if (!customer || !customer.uuid) throw new Error('Flex customer lookup returned no customer uuid for ' + customerUuid + '.');
  run.customersChecked += 1;

  const orders = listAllFlexCustomerOrders_(customer.uuid);
  run.ordersChecked += orders.length;
  const metrics = aggregateCustomerOrders_(orders);

  const contactResult = upsertProductionGhlContact_(customer, metrics, locationId);
  const ghlContactId = contactResult.ghlContactId;

  let fullLatestOrder = null;
  if (!customer.company_uuid && metrics.latestOrderUuid) {
    fullLatestOrder = flexRequest_('/api/v1/orders/' + encodeURIComponent(metrics.latestOrderUuid)).body;
  }
  const companyUuid = customer.company_uuid || (fullLatestOrder && fullLatestOrder.company_uuid) || '';

  upsertEntityMap_({
    entityType: 'customer',
    flexUuid: customer.uuid,
    flexId: customer.id,
    flexExternalRef: customer.external_reference_id,
    ghlRecordType: 'contact',
    ghlRecordId: ghlContactId,
    parentFlexCompanyUuid: companyUuid,
    syncStatus: 'SYNCED',
    notes: 'Production reconciliation sync.'
  });

  run.customersSynced += 1;
  run.ordersProcessed += orders.length;

  logEvent_(run, {
    entityType: 'customer',
    flexUuid: customer.uuid,
    flexId: customer.id,
    eventType: 'SYNC',
    action: contactResult.action,
    ghlRecordType: 'contact',
    ghlRecordId: ghlContactId,
    companyUuid: companyUuid,
    status: 'SUCCESS',
    attempt: contactResult.response.attempt,
    durationMs: contactResult.response.durationMs,
    message: 'Synced Flex customer to GHL contact.',
    context: {
      companyUuid: companyUuid,
      orderCount: metrics.orderCount,
      lifetimeValue: metrics.lifetimeValue,
      firstOrderDate: metrics.firstOrderDate,
      lastOrderDate: metrics.lastOrderDate,
      latestOrderUuid: metrics.latestOrderUuid,
      latestOrderStatus: metrics.latestOrderStatus
    }
  });

  if (companyUuid) {
    syncFlexCompanyToGhl_(run, companyUuid, ghlContactId, locationId);
  }

  return {customer: customer, metrics: metrics, ghlContactId: ghlContactId, companyUuid: companyUuid};
}

function upsertProductionGhlContact_(customer, metrics, locationId) {
  const payload = buildGhlContactPayload_(customer, metrics, locationId);
  const map = findEntityMap_('customer', customer.uuid, customer.id);
  let response;
  let action;

  if (map && map.values[5]) {
    const ghlContactId = String(map.values[5]);
    response = ghlRequest_('/contacts/' + encodeURIComponent(ghlContactId), {
      method: 'put',
      apiVersion: 'v3',
      payload: removeLocationId_(payload)
    });
    action = 'UPDATE_GHL_CONTACT_BY_ENTITY_MAP';
    return {ghlContactId: ghlContactId, response: response, action: action};
  }

  if (!customer.email && !customer.mobile && !customer.phone) {
    throw new Error('Flex customer ' + customer.uuid + ' has no entity map, email, or phone. Refusing non-deterministic GHL contact creation.');
  }

  response = ghlRequest_('/contacts/upsert', {
    method: 'post',
    apiVersion: 'v3',
    payload: payload
  });
  const contact = response.body && response.body.contact;
  if (!contact || !contact.id) throw new Error('GHL contact upsert returned no contact.id.');
  action = response.body && response.body.new === true ? 'CREATE_GHL_CONTACT_BY_UPSERT' : 'UPSERT_EXISTING_GHL_CONTACT';
  return {ghlContactId: contact.id, response: response, action: action};
}

function syncFlexCompanyToGhl_(run, companyUuid, ghlContactId, locationId) {
  const companyResponse = flexRequest_('/api/v1/companies/' + encodeURIComponent(companyUuid));
  const company = companyResponse.body;
  if (!company || !company.uuid) throw new Error('Flex company lookup returned no company uuid for ' + companyUuid + '.');
  run.companiesChecked += 1;

  const orders = listAllFlexCompanyOrders_(companyUuid);
  run.ordersChecked += orders.length;
  const metrics = aggregateCustomerOrders_(orders);

  const contactResponse = ghlRequest_('/contacts/' + encodeURIComponent(ghlContactId), {method: 'get', apiVersion: 'v3'});
  const currentContact = contactResponse.body && contactResponse.body.contact;
  const businessResolution = resolveGhlBusiness_(company, companyUuid, currentContact, locationId);
  const businessId = businessResolution.businessId;

  const corePayload = {
    name: company.name || '',
    phone: company.phone || '',
    email: company.email || '',
    website: company.website || '',
    address: company.address1 || '',
    city: company.suburb || '',
    postalCode: company.postcode || '',
    state: company.state || '',
    country: company.country || '',
    description: 'Synced from Flex Catering. Flex Company UUID: ' + companyUuid
  };

  const businessWrite = ghlRequest_('/businesses/' + encodeURIComponent(businessId), {
    method: 'put',
    apiVersion: 'v3',
    payload: corePayload
  });

  const objectWrite = ghlRequest_(
    '/objects/business/records/' + encodeURIComponent(businessId) + '?locationId=' + encodeURIComponent(locationId),
    {
      method: 'put',
      apiVersion: 'v3',
      payload: {
        properties: {
          flex_company_uuid: companyUuid,
          flex_company_source: 'Flex Catering Sync',
          company_order_count: metrics.orderCount,
          company_lifetime_value: {currency: 'default', value: metrics.lifetimeValue},
          company_first_order_date: metrics.firstOrderDate,
          last_order_date: metrics.lastOrderDate
        }
      }
    }
  );

  if (!currentContact || String(currentContact.businessId || '') !== String(businessId)) {
    ghlRequest_('/contacts/bulk/business', {
      method: 'post',
      apiVersion: 'v3',
      payload: {
        locationId: String(locationId),
        ids: [ghlContactId],
        businessId: businessId
      }
    });
  }

  upsertEntityMap_({
    entityType: 'company',
    flexUuid: company.uuid,
    flexId: company.id,
    ghlRecordType: 'business',
    ghlRecordId: businessId,
    ghlBusinessId: businessId,
    syncStatus: 'SYNCED',
    notes: 'Production reconciliation sync. Resolution: ' + businessResolution.method
  });

  run.companiesSynced += 1;
  run.ordersProcessed += orders.length;

  logEvent_(run, {
    entityType: 'company',
    flexUuid: company.uuid,
    flexId: company.id,
    eventType: 'SYNC',
    action: businessResolution.created ? 'CREATE_AND_SYNC_GHL_BUSINESS' : 'UPDATE_GHL_BUSINESS',
    ghlRecordType: 'business',
    ghlRecordId: businessId,
    status: 'SUCCESS',
    attempt: Math.max(businessWrite.attempt || 1, objectWrite.attempt || 1),
    durationMs: (businessWrite.durationMs || 0) + (objectWrite.durationMs || 0),
    message: 'Synced Flex company and company-wide order metrics to GHL.',
    context: {
      resolutionMethod: businessResolution.method,
      orderCount: metrics.orderCount,
      lifetimeValue: metrics.lifetimeValue,
      firstOrderDate: metrics.firstOrderDate,
      lastOrderDate: metrics.lastOrderDate,
      associatedContactId: ghlContactId
    }
  });

  return {company: company, metrics: metrics, businessId: businessId};
}

function resolveGhlBusiness_(company, companyUuid, contact, locationId) {
  const map = findEntityMap_('company', companyUuid, company.id);
  if (map && map.values[5]) {
    return {businessId: String(map.values[5]), method: 'entity_map', created: false};
  }

  if (contact && contact.businessId) {
    return {businessId: String(contact.businessId), method: 'contact_business_id', created: false};
  }

  const exactMatches = findExactGhlBusinessesByName_(company.name || '', locationId);
  if (exactMatches.length === 1) {
    return {businessId: exactMatches[0].id, method: 'unique_exact_name', created: false};
  }
  if (exactMatches.length > 1) {
    throw new Error('Multiple GHL businesses exactly match Flex company name "' + (company.name || '') + '". Refusing to guess.');
  }

  if (!company.name) throw new Error('Flex company ' + companyUuid + ' has no name. Refusing GHL business creation.');

  const createResponse = ghlRequest_('/businesses/', {
    method: 'post',
    apiVersion: 'v3',
    payload: {
      name: company.name,
      locationId: String(locationId),
      phone: company.phone || '',
      email: company.email || '',
      website: company.website || '',
      address: company.address1 || '',
      city: company.suburb || '',
      postalCode: company.postcode || '',
      state: company.state || '',
      country: company.country || '',
      description: 'Created by Flex Catering Sync. Flex Company UUID: ' + companyUuid
    }
  });
  const body = createResponse.body || {};
  const created = body.business || body.buiseness;
  if (!created || !created.id) throw new Error('GHL business creation returned no business id.');
  return {businessId: created.id, method: 'created_new', created: true};
}

function findExactGhlBusinessesByName_(name, locationId) {
  const target = normalizeCompanyName_(name);
  if (!target) return [];
  const matches = [];
  const limit = 100;
  for (let skip = 0; skip < 5000; skip += limit) {
    const response = ghlRequest_(
      '/businesses/?locationId=' + encodeURIComponent(locationId) + '&limit=' + limit + '&skip=' + skip,
      {method: 'get', apiVersion: 'v3'}
    );
    const businesses = (response.body && response.body.businesses) || [];
    businesses.forEach(function(business) {
      if (business && normalizeCompanyName_(business.name) === target) matches.push(business);
    });
    if (businesses.length < limit) break;
  }
  return matches;
}

function normalizeCompanyName_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
