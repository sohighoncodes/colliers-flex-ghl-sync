# Colliers Flex ↔ GHL Sync

Direct Flex API → Google Apps Script → GoHighLevel synchronization.

## Connected resources

- Apps Script project: `1skjylvwi4tHWXF6Ksor26eJFOHVyih36MwfbVB7fKFI4ICS2XB5kO9ml`
- Operational spreadsheet: `19-OWuEgJju3Qnd-NeTnOma08sa9okGGNGztLcrkjzaM`
- Apps Script source directory: `src/`

## First-time setup

```bash
npm install
npm run clasp:login
npm run clasp:pull
```

`clasp pull` must happen before the first push so the repository starts from the current Apps Script project and does not overwrite existing remote files.

## Normal workflow

```bash
npm run clasp:pull
# edit and test complete files
npm run clasp:push
```

Never commit `.clasprc.json`, API keys, GHL tokens, or Flex credentials. Runtime secrets belong in Apps Script Properties.

## Operational requirements

The sync is idempotent, resolves customer/company dependencies before orders, recalculates order metrics from Flex, and records each run, event, error, retry, state transition, and entity mapping in the operational workbook.
