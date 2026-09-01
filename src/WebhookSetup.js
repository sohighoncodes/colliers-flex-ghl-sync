const FLEX_WEBHOOK_EVENTS = Object.freeze([
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
]);

function prepareWebhookReceiver_() {
  const props = PropertiesService.getScriptProperties();
  let secret = String(props.getProperty('WEBHOOK_INTERNAL_SECRET') || '');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('WEBHOOK_INTERNAL_SECRET', secret);
  }

  const serviceUrl = ScriptApp.getService().getUrl() || '';
  return {
    serviceUrl: serviceUrl,
    internalSecret: secret,
    appsScriptWebhookUrl: serviceUrl ? serviceUrl + '?token=' + encodeURIComponent(secret) : '',
    deployed: !!serviceUrl
  };
}

function showWebhookSetup_() {
  const setup = prepareWebhookReceiver_();
  let message = '';
  if (!setup.deployed) {
    message += 'Apps Script is not deployed as a Web App yet.\n\n';
    message += 'Deploy → New deployment → Web app\n';
    message += 'Execute as: Me\n';
    message += 'Who has access: Anyone\n\n';
    message += 'Then run this menu item again.\n\n';
  } else {
    message += 'Apps Script webhook receiver URL:\n' + setup.appsScriptWebhookUrl + '\n\n';
  }
  message += 'Internal forwarding secret:\n' + setup.internalSecret + '\n\n';
  message += 'Configure the Cloudflare Worker environment variable APPS_SCRIPT_WEBHOOK_URL with the full receiver URL above.';
  SpreadsheetApp.getUi().alert('Flex Webhook Setup', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

function registerFlexWebhook_() {
  return registerFlexWebhookSubscription_();
}

// Backwards-compatible menu/function name. Flex appears to maintain a single
// subscription per target URL, so customer/order/company events must be kept on
// one combined subscription. Registering a second company-only subscription can
// replace the event list on the existing target and silently stop customer/order
// deliveries.
function registerFlexCompanyWebhook_() {
  return registerFlexWebhookSubscription_();
}

function registerFlexWebhookSubscription_() {
  const config = getConfig_();
  const targetUrl = String(config.FLEX_WEBHOOK_TARGET_URL || '').trim();
  if (!targetUrl) {
    throw new Error('Add FLEX_WEBHOOK_TARGET_URL to the Config tab with your deployed Cloudflare Worker URL first.');
  }

  const existingResponse = flexRequest_('/api/v1/webhooks?per_page=100');
  const existing = getCollectionItems_(existingResponse.body);
  const matching = existing.filter(function(webhook) {
    if (String(webhook.target_url || '').trim() !== targetUrl) return false;
    const currentEvents = (webhook.events || []).map(String);
    return FLEX_WEBHOOK_EVENTS.every(function(eventName) {
      return currentEvents.indexOf(eventName) >= 0;
    });
  });

  if (matching.length) {
    const current = matching[0];
    recordCombinedWebhookState_(current.uuid || '', 'Flex combined customer/order/company webhook subscription already registered.');
    SpreadsheetApp.getUi().alert(
      'Flex webhook already exists.\n\n' +
      'UUID: ' + (current.uuid || '') + '\n' +
      'Target: ' + targetUrl + '\n' +
      'Events: ' + ((current.events || []).join(', '))
    );
    return current;
  }

  const response = flexRequest_('/api/v1/webhooks', {
    method: 'post',
    payload: {
      target_url: targetUrl,
      events: FLEX_WEBHOOK_EVENTS.slice()
    }
  });
  const webhook = response.body || {};

  recordCombinedWebhookState_(
    webhook.uuid || '',
    'Flex combined customer/order/company webhook subscription registered.'
  );

  SpreadsheetApp.getUi().alert(
    'Flex combined webhook registered.\n\n' +
    'UUID: ' + (webhook.uuid || '') + '\n' +
    'Target: ' + targetUrl + '\n' +
    'Events: ' + FLEX_WEBHOOK_EVENTS.join(', ') + '\n\n' +
    'IMPORTANT — copy this Flex secret into BOTH Cloudflare Worker secrets FLEX_WEBHOOK_SECRET and FLEX_COMPANY_WEBHOOK_SECRET (or keep the second unset if the Worker is redeployed to use only FLEX_WEBHOOK_SECRET):\n\n' +
    (webhook.secret_key || '[secret key not returned]')
  );
  return webhook;
}

function recordCombinedWebhookState_(uuid, note) {
  const now = new Date();
  setSyncState_('webhook', 'flex_subscription_uuid', uuid || '', now, note || '');
  setSyncState_('webhook', 'flex_company_subscription_uuid', uuid || '', now, note || '');
}

function inspectFlexWebhooks_() {
  const response = flexRequest_('/api/v1/webhooks?per_page=100');
  const webhooks = getCollectionItems_(response.body);
  const summary = webhooks.map(function(item) {
    return {
      uuid: item.uuid || '',
      target_url: item.target_url || '',
      events: item.events || []
    };
  });
  SpreadsheetApp.getUi().alert('Flex webhooks', JSON.stringify(summary, null, 2), SpreadsheetApp.getUi().ButtonSet.OK);
  return summary;
}
