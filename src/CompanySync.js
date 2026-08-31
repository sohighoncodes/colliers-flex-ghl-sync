const GHL_COMPANY_FIELD_KEYS = Object.freeze({
  flexCompanyUuid: 'flex_company_uuid',
  flexCompanySource: 'flex_company_source',
  companyOrderCount: 'company_order_count',
  companyLifetimeValue: 'company_lifetime_value',
  companyFirstOrderDate: 'company_first_order_date',
  companyLastOrderDate: 'last_order_date'
});

function runKnownFlexCompanySyncTest_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync process is already running.');

  const run = startRun_('MANUAL_KNOWN_COMPANY_SYNC_TEST');
  try {
    const config = getConfig_();
    const locationId = String(config.GHL_LOCATION_ID || '');
    if (!locationId) throw new Error('GHL_LOCATION_ID is missing from Config.');

    const flexCompanyUuid = 'd95dbc46-b95c-442d-ae53-cf78513f5927';
    const knownGhlContactId = 'agCenAyQptiBbrWvkweD';

    const contactResponse = ghlRequest_('/contacts/' + encodeURIComponent(knownGhlContactId), {
      method: 'get',
      apiVersion: 'v3'
    });
    const ghlContact = contactResponse.body && contactResponse.body.contact;
    if (!ghlContact) throw new Error('GHL contact lookup returned no contact.');

    const businessId = ghlContact.businessId || '';
    if (!businessId) {
      throw new Error('Known GHL contact does not expose businessId. Refusing to guess/create a company during controlled test.');
    }

    const companyResponse = flexRequest_('/api/v1/companies/' + encodeURIComponent(flexCompanyUuid));
    const company = companyResponse.body;
    if (!company || !company.uuid) throw new Error('Flex company lookup returned no company uuid.');
    run.companiesChecked += 1;

    const orders = listAllFlexCompanyOrders_(flexCompanyUuid);
    run.ordersChecked += orders.length;
    const metrics = aggregateCustomerOrders_(orders);

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
      description: 'Synced from Flex Catering. Flex Company UUID: ' + flexCompanyUuid
    };

    const businessWrite = ghlRequest_('/businesses/' + encodeURIComponent(businessId), {
      method: 'put',
      apiVersion: 'v3',
      payload: corePayload
    });

    const objectPayload = {
      properties: {
        flex_company_uuid: flexCompanyUuid,
        flex_company_source: 'Flex Catering Sync',
        company_order_count: metrics.orderCount,
        company_lifetime_value: {
          currency: 'default',
          value: metrics.lifetimeValue
        },
        company_first_order_date: metrics.firstOrderDate,
        last_order_date: metrics.lastOrderDate
      }
    };

    const objectWrite = ghlRequest_(
      '/objects/business/records/' + encodeURIComponent(businessId) + '?locationId=' + encodeURIComponent(locationId),
      {
        method: 'put',
        apiVersion: 'v3',
        payload: objectPayload
      }
    );

    upsertEntityMap_({
      entityType: 'company',
      flexUuid: company.uuid,
      flexId: company.id,
      ghlRecordType: 'business',
      ghlRecordId: businessId,
      ghlBusinessId: businessId,
      syncStatus: 'SYNCED',
      notes: 'Controlled known-company sync test using existing GHL business association.'
    });

    run.companiesSynced += 1;
    run.ordersProcessed += orders.length;

    logEvent_(run, {
      entityType: 'company',
      flexUuid: company.uuid,
      flexId: company.id,
      eventType: 'SYNC_TEST',
      action: 'UPDATE_EXISTING_GHL_BUSINESS',
      ghlRecordType: 'business',
      ghlRecordId: businessId,
      status: 'SUCCESS',
      attempt: Math.max(businessWrite.attempt || 1, objectWrite.attempt || 1),
      durationMs: (businessWrite.durationMs || 0) + (objectWrite.durationMs || 0),
      message: 'Updated existing GHL company linked to the known GHL contact.',
      context: {
        knownGhlContactId: knownGhlContactId,
        businessId: businessId,
        flexCompanyUuid: flexCompanyUuid,
        companyName: company.name || '',
        totalCompanyOrders: orders.length,
        nonCancelledOrderCount: metrics.orderCount,
        lifetimeValue: metrics.lifetimeValue,
        firstOrderDate: metrics.firstOrderDate,
        lastOrderDate: metrics.lastOrderDate
      }
    });

    finishRun_(run, 'SUCCESS', 'Controlled Flex company → existing GHL company sync test passed.');
    return {
      flexCompanyUuid: flexCompanyUuid,
      ghlBusinessId: businessId,
      metrics: metrics
    };
  } catch (error) {
    logCaughtError_(run, 'KNOWN_COMPANY_SYNC_TEST', error, {entityType: 'company'});
    finishRun_(run, 'FAILED', error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function listAllFlexCompanyOrders_(companyUuid) {
  const perPage = 100;
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = flexRequest_(
      '/api/v1/orders?company_uuid=' + encodeURIComponent(companyUuid) +
      '&per_page=' + perPage + '&page=' + page + '&sort_order=desc&sort_field=created_at'
    );
    const items = getCollectionItems_(response.body);
    Array.prototype.push.apply(all, items);
    if (!(response.body && response.body.next_page) || items.length === 0) break;
    if (page === 100) throw new Error('Company order pagination exceeded 100 pages; aborting for safety.');
  }
  return all;
}
