function syncFlexCompanyWebhookToGhl_(run, companyUuid, locationId) {
  const companyResponse = flexRequest_('/api/v1/companies/' + encodeURIComponent(companyUuid));
  const company = companyResponse.body;
  if (!company || !company.uuid) throw new Error('Flex company lookup returned no company uuid for ' + companyUuid + '.');
  run.companiesChecked += 1;

  const orders = listAllFlexCompanyOrders_(companyUuid);
  run.ordersChecked += orders.length;
  const metrics = aggregateCustomerOrders_(orders);

  const businessResolution = resolveGhlBusiness_(company, companyUuid, null, locationId);
  const businessId = businessResolution.businessId;

  const corePayload = compactPayload_({
    name: company.name || '',
    phone: company.phone || '',
    email: company.email || '',
    website: company.website || '',
    address: company.address1 || '',
    city: company.suburb || '',
    postalCode: company.postcode || '',
    state: company.state || '',
    country: company.country || ''
  });

  const businessWrite = ghlRequest_('/businesses/' + encodeURIComponent(businessId), {
    method: 'put',
    apiVersion: 'v3',
    payload: corePayload
  });

  const properties = {
    flex_company_uuid: companyUuid,
    flex_company_source: 'Flex Catering Sync',
    company_order_count: metrics.orderCount,
    company_lifetime_value: {currency: 'default', value: metrics.lifetimeValue}
  };
  if (metrics.firstOrderDate) properties.company_first_order_date = metrics.firstOrderDate;
  if (metrics.lastOrderDate) properties.last_order_date = metrics.lastOrderDate;

  const objectWrite = ghlRequest_(
    '/objects/business/records/' + encodeURIComponent(businessId) + '?locationId=' + encodeURIComponent(locationId),
    {method: 'put', apiVersion: 'v3', payload: {properties: properties}}
  );

  upsertEntityMap_({
    entityType: 'company',
    flexUuid: company.uuid,
    flexId: company.id,
    ghlRecordType: 'business',
    ghlRecordId: businessId,
    ghlBusinessId: businessId,
    syncStatus: 'SYNCED',
    notes: 'Real-time company webhook sync. Resolution: ' + businessResolution.method
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
    message: 'Synced Flex company webhook to GHL company.',
    context: {
      resolutionMethod: businessResolution.method,
      orderCount: metrics.orderCount,
      lifetimeValue: metrics.lifetimeValue,
      firstOrderDate: metrics.firstOrderDate,
      lastOrderDate: metrics.lastOrderDate
    }
  });

  return {company: company, metrics: metrics, businessId: businessId};
}
