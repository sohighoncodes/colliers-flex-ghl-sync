function getSyncState_(entityType, stateKey) {
  const sheet = getSheet_(SYNC_CONSTANTS.sheets.state);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues()
    : [];

  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0]) === String(entityType) && String(rows[i][1]) === String(stateKey)) {
      return {rowNumber: i + 2, value: rows[i][2], lastSuccessfulSyncAt: rows[i][3]};
    }
  }
  return null;
}

function setSyncState_(entityType, stateKey, stateValue, successfulAt, notes) {
  const sheet = getSheet_(SYNC_CONSTANTS.sheets.state);
  const existing = getSyncState_(entityType, stateKey);
  const row = [
    entityType,
    stateKey,
    stateValue,
    successfulAt || '',
    new Date(),
    truncate_(notes || '', 5000)
  ];
  if (existing) sheet.getRange(existing.rowNumber, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
}

function findEntityMap_(entityType, flexUuid, flexId) {
  const sheet = getSheet_(SYNC_CONSTANTS.sheets.entityMap);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues()
    : [];

  for (let i = 0; i < rows.length; i += 1) {
    const typeMatches = String(rows[i][0]) === String(entityType);
    const uuidMatches = flexUuid && String(rows[i][1]) === String(flexUuid);
    const idMatches = flexId && String(rows[i][2]) === String(flexId);
    if (typeMatches && (uuidMatches || idMatches)) {
      return {rowNumber: i + 2, values: rows[i]};
    }
  }

  if (String(entityType) === 'customer' && (flexUuid || flexId)) {
    const resolved = findGhlContactByFlexIdentifiers_(flexUuid, flexId);
    if (resolved && resolved.contact && resolved.contact.id) {
      return {
        rowNumber: null,
        values: [
          'customer',
          flexUuid || '',
          flexId || '',
          '',
          'contact',
          resolved.contact.id,
          '',
          resolved.contact.businessId || '',
          '',
          'RESOLVED_FROM_GHL',
          'Resolved from GHL custom field: ' + resolved.matchMethod
        ],
        resolvedFromGhl: true,
        matchMethod: resolved.matchMethod
      };
    }
  }

  return null;
}

function upsertEntityMap_(entity) {
  const sheet = getSheet_(SYNC_CONSTANTS.sheets.entityMap);
  const existing = findEntityMap_(entity.entityType, entity.flexUuid, entity.flexId);
  const row = [
    entity.entityType,
    entity.flexUuid || '',
    entity.flexId || '',
    entity.flexExternalRef || '',
    entity.ghlRecordType || '',
    entity.ghlRecordId || '',
    entity.parentFlexCompanyUuid || '',
    entity.ghlBusinessId || '',
    new Date(),
    entity.syncStatus || 'SYNCED',
    truncate_(entity.notes || '', 5000)
  ];
  if (existing && existing.rowNumber) sheet.getRange(existing.rowNumber, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
}
