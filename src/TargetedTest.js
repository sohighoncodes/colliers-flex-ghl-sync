const TARGETED_TEST = Object.freeze({
  flexCustomerId: 2874,
  ghlContactId: 'agCenAyQptiBbrWvkweD'
});

function runTargetedCustomer2874SyncTest_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync process is already running.');

  const run = startRun_('MANUAL_TARGETED_CUSTOMER_2874_TEST');
  try {
    const config = getConfig_();
    if (!config.GHL_LOCATION_ID) throw new Error('GHL_LOCATION_ID is missing from Config.');

    const customerSummary = findFlexCustomerByNumericId_(TARGETED_TEST.flexCustomerId);
    if (!customerSummary || !customerSummary.uuid) {
      throw new Error('Could not find Flex customer ID ' + TARGETED_TEST.flexCustomerId + ' in the customer list.');
    }

    const customerResponse = flexRequest_('/api/v1/customers/' + encodeURIComponent(customerSummary.uuid));
    const customer = customerResponse.body;
    if (!customer || !customer.uuid) throw new Error('Flex customer response is missing uuid.');
    run.customersChecked += 1;

    const orders = listAllFlexCustomerOrders_(customer.uuid);
    run.ordersChecked += orders.length;
    const metrics = aggregateCustomerOrders_(orders);

    let fullLatestOrder = null;
    if (metrics.latestOrderUuid) {
      fullLatestOrder = flexRequest_('/api/v1/orders/' + encodeURIComponent(metrics.latestOrderUuid)).body;
    }

    const companyUuid = customer.company_uuid ||
      (fullLatestOrder && fullLatestOrder.company_uuid) ||
      '';
    const companyUuidSource = customer.company_uuid
      ? 'customer'
      : (fullLatestOrder && fullLatestOrder.company_uuid ? 'full_order' : 'none');

    const payload = removeLocationId_(buildGhlContactPayload_(customer, metrics, config.GHL_LOCATION_ID));
    const response = ghlRequest_('/contacts/' + encodeURIComponent(TARGETED_TEST.ghlContactId), {
      method: 'put',
      apiVersion: 'v3',
      payload: payload
    });

    upsertEntityMap_({
      entityType: 'customer',
      flexUuid: customer.uuid,
      flexId: customer.id,
      flexExternalRef: customer.external_reference_id,
      ghlRecordType: 'contact',
      ghlRecordId: TARGETED_TEST.ghlContactId,
      parentFlexCompanyUuid: companyUuid,
      syncStatus: 'SYNCED',
      notes: 'Targeted validation: Flex customer 2874 to known GHL contact.'
    });

    run.customersSynced += 1;
    run.ordersProcessed += orders.length;

    logEvent_(run, {
      entityType: 'customer',
      flexUuid: customer.uuid,
      flexId: customer.id,
      eventType: 'TARGETED_SYNC_TEST',
      action: 'UPDATE_KNOWN_GHL_CONTACT',
      ghlRecordType: 'contact',
      ghlRecordId: TARGETED_TEST.ghlContactId,
      companyUuid: companyUuid,
      status: 'SUCCESS',
      attempt: response.attempt,
      durationMs: response.durationMs,
      message: 'Updated the explicitly selected GHL contact from Flex customer 2874.',
      context: {
        expectedFlexCustomerId: TARGETED_TEST.flexCustomerId,
        expectedGhlContactId: TARGETED_TEST.ghlContactId,
        companyUuid: companyUuid,
        companyUuidSource: companyUuidSource,
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

    finishRun_(run, 'SUCCESS', 'Targeted Flex customer 2874 → known GHL contact test passed.');
    return {
      flexCustomerUuid: customer.uuid,
      flexCustomerId: customer.id,
      ghlContactId: TARGETED_TEST.ghlContactId,
      companyUuid: companyUuid,
      companyUuidSource: companyUuidSource,
      metrics: metrics
    };
  } catch (error) {
    logCaughtError_(run, 'TARGETED_CUSTOMER_2874_TEST', error, {
      entityType: 'customer',
      flexId: TARGETED_TEST.flexCustomerId
    });
    finishRun_(run, 'FAILED', error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function findFlexCustomerByNumericId_(customerId) {
  const perPage = 100;
  for (let page = 1; page <= 100; page += 1) {
    const response = flexRequest_(
      '/api/v1/customers?per_page=' + perPage + '&page=' + page + '&sort_order=desc&sort_field=created_at'
    );
    const items = getCollectionItems_(response.body);
    for (let i = 0; i < items.length; i += 1) {
      if (String(items[i].id) === String(customerId)) return items[i];
    }
    if (!(response.body && response.body.next_page) || items.length === 0) break;
    if (page === 100) throw new Error('Customer pagination exceeded 100 pages while looking for ID ' + customerId + '.');
  }
  return null;
}
