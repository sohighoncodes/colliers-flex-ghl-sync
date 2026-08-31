const SYNC_CONSTANTS = Object.freeze({
  spreadsheetId: '19-OWuEgJju3Qnd-NeTnOma08sa9okGGNGztLcrkjzaM',
  flexBaseUrl: 'https://www.colliers.net.au',
  ghlBaseUrl: 'https://services.leadconnectorhq.com',
  ghlApiVersion: '2021-07-28',
  maxHttpAttempts: 3,
  baseRetryDelayMs: 1000,
  propertyKeys: Object.freeze({
    flexApiKey: 'FLEX_API_KEY',
    ghlToken: 'GHL_PRIVATE_INTEGRATION_TOKEN'
  }),
  sheets: Object.freeze({
    dashboard: 'Dashboard',
    runs: 'Sync Runs',
    events: 'Sync Events',
    errors: 'Errors',
    state: 'Sync State',
    entityMap: 'Entity Map',
    config: 'Config'
  })
});

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SYNC_CONSTANTS.spreadsheetId);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Required sheet not found: ' + name);
  return sheet;
}

function getConfig_() {
  const sheet = getSheet_(SYNC_CONSTANTS.sheets.config);
  const lastRow = sheet.getLastRow();
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  const config = {};
  values.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key) config[key] = row[1];
  });
  return config;
}

function isSyncEnabled_(config) {
  const value = config.SYNC_ENABLED;
  return value === true || String(value).toLowerCase() === 'true';
}

function getRequiredSecret_(key) {
  const value = String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
  if (!value) throw new Error('Missing Script Property: ' + key);
  return value;
}
