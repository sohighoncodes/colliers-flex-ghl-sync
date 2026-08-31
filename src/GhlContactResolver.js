function findGhlContactByFlexIdentifiers_(flexUuid, flexId) {
  if (!flexUuid && !flexId) return null;

  const config = getConfig_();
  const locationId = String(config.GHL_LOCATION_ID || '');
  if (!locationId) return null;

  const uuidFieldId = GHL_CONTACT_FIELD_IDS.flexCustomerUuid;
  const idFieldId = GHL_CONTACT_FIELD_IDS.flexCustomerId;
  const limit = 100;
  let startAfter = '';
  let startAfterId = '';

  for (let page = 1; page <= 100; page += 1) {
    let path = '/contacts/?locationId=' + encodeURIComponent(locationId) + '&limit=' + limit;
    if (startAfter) path += '&startAfter=' + encodeURIComponent(startAfter);
    if (startAfterId) path += '&startAfterId=' + encodeURIComponent(startAfterId);

    const response = ghlRequest_(path, {method: 'get', apiVersion: '2023-02-21'});
    const contacts = (response.body && response.body.contacts) || [];

    for (let i = 0; i < contacts.length; i += 1) {
      const contact = contacts[i];
      const fields = contact.customFields || [];
      let uuidValue = '';
      let idValue = '';

      fields.forEach(function(field) {
        if (!field) return;
        const fieldId = String(field.id || '');
        const value = field.value !== undefined ? field.value : field.fieldValue;
        if (fieldId === uuidFieldId) uuidValue = value;
        if (fieldId === idFieldId) idValue = value;
      });

      if (flexUuid && String(uuidValue) === String(flexUuid)) {
        return {contact: contact, matchMethod: 'flex_customer_uuid_custom_field'};
      }
      if (flexId && String(idValue) === String(flexId)) {
        return {contact: contact, matchMethod: 'flex_customer_id_custom_field'};
      }
    }

    if (contacts.length < limit) break;

    const meta = (response.body && response.body.meta) || {};
    const nextStartAfter = meta.startAfter || meta.startAfterDate || '';
    const nextStartAfterId = meta.startAfterId || '';
    if (!nextStartAfter && !nextStartAfterId) break;
    if (String(nextStartAfter) === String(startAfter) && String(nextStartAfterId) === String(startAfterId)) break;
    startAfter = nextStartAfter;
    startAfterId = nextStartAfterId;
  }

  return null;
}
