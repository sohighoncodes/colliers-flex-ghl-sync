const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const baseline = execFileSync('git', ['show', 'rollback/pre-delivery-dates-2026-09-23:src/CustomerSync.js'], {cwd: root, encoding: 'utf8'});
const source = fs.readFileSync(path.join(root, 'src/CustomerSync.js'), 'utf8');
const ids = ['QfxWfMkUxc51TxV4HRC0', 'DhfdByYXNVysv9ZokInp'];
const plain = value => JSON.parse(JSON.stringify(value));
function context(code = source, enabled) {
  const ctx = vm.createContext({
    Utilities: {formatDate: (date, timeZone) => new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date)},
    PropertiesService: {getScriptProperties: () => ({getProperty: () => enabled})},
    nowIso_: () => '2026-09-23T00:00:00.000Z'
  });
  vm.runInContext(code, ctx);
  return ctx;
}
const orders = [
  {uuid: 'latest', order_id: 3, created_at: '2026-09-20T00:00:00Z', delivery_datetime: '2026-09-21T22:30:00Z', status: 'completed', grand_total: 12.35},
  {uuid: 'first', order_id: 1, created_at: '2026-09-01T00:00:00Z', delivery_datetime: '2026-09-22T22:30:00Z', status: 'invoiced', grand_total: 17.65},
  {uuid: 'cancelled', order_id: 4, created_at: '2026-09-22T00:00:00Z', delivery_datetime: '2027-01-01T00:00:00Z', status: 'CANCELLED', grand_total: 999}
];
const customer = {uuid: 'customer', id: 42, email: 'fixture@example.invalid', first_name: 'Fixture'};

test('delivery dates use delivery chronology independently of placement chronology', () => {
  const metrics = context().aggregateCustomerOrders_(orders);
  assert.equal(metrics.firstOrderDeliveryDate, '2026-09-22');
  assert.equal(metrics.latestOrderDeliveryDate, '2026-09-23');
  assert.equal(metrics.latestOrderUuid, 'latest');
  assert.equal(metrics.orderCount, 2);
  assert.equal(metrics.lifetimeValue, 30);
});

test('cancelled, unconverted, pending, ready, approved and future deliveries do not count', () => {
  const ctx = context();
  const asOf = Date.parse('2026-09-23T10:00:00Z');
  const fixture = ['cancelled', 'not_converted', 'pending', 'new', 'ready', 'approved', 'unknown']
    .map(status => ({status, delivery_datetime: '2025-01-01T00:00:00Z'}));
  fixture.push({status: 'invoiced', delivery_datetime: '2026-09-23T10:00:01Z'});
  fixture.push({status: 'completed', delivery_datetime: 'invalid'});
  fixture.push({status: 'COMPLETED', delivery_datetime: '2026-09-22T00:00:00Z'});
  fixture.push({status: ' invoiced ', delivery_datetime: '2026-09-21T00:00:00Z'});
  assert.deepEqual(plain(ctx.aggregateDeliveredOrderDates_(fixture, asOf)), {
    firstOrderDeliveryDate: '2026-09-21', latestOrderDeliveryDate: '2026-09-22'
  });
});

test('cancelling a formerly earliest/latest delivery recomputes the remaining history', () => {
  const ctx = context();
  const fixture = plain(orders);
  fixture[1].status = 'cancelled';
  const result = ctx.aggregateDeliveredOrderDates_(fixture, Date.parse('2026-09-24T00:00:00Z'));
  assert.equal(result.firstOrderDeliveryDate, '2026-09-22');
  assert.equal(result.latestOrderDeliveryDate, '2026-09-22');
});

test('single order, empty history, all-cancelled history and missing delivery dates', () => {
  const ctx = context();
  const single = ctx.aggregateCustomerOrders_([orders[0]]);
  assert.equal(single.firstOrderDeliveryDate, single.latestOrderDeliveryDate);
  for (const fixture of [[], [orders[2]], [{created_at: orders[0].created_at, status: 'approved'}]]) {
    const metrics = ctx.aggregateCustomerOrders_(fixture);
    assert.equal(metrics.firstOrderDeliveryDate, '');
    assert.equal(metrics.latestOrderDeliveryDate, '');
  }
});

test('Sydney day boundaries and daylight saving; invalid dates stay empty', () => {
  const ctx = context();
  assert.equal(ctx.toDeliveryDateOnly_('2026-07-01T14:30:00Z'), '2026-07-02');
  assert.equal(ctx.toDeliveryDateOnly_('2026-12-01T13:30:00Z'), '2026-12-02');
  assert.equal(ctx.toDeliveryDateOnly_('2026-12-02T00:30:00+11:00'), '2026-12-02');
  for (const invalid of [null, undefined, '', 'invalid', {}, 123]) {
    assert.equal(ctx.toDeliveryDateOnly_(invalid), '');
  }
});

test('existing metrics and complete contact payload remain identical to live baseline', () => {
  const before = context(baseline);
  const after = context();
  const fixtures = [orders, [], [orders[2]], [orders[0]], [{status: 'approved', grand_total: 'bad', created_at: 'invalid'}]];
  for (const fixture of fixtures) {
    const oldMetrics = plain(before.aggregateCustomerOrders_(fixture));
    const newMetrics = plain(after.aggregateCustomerOrders_(fixture));
    const {firstOrderDeliveryDate, latestOrderDeliveryDate, ...legacyMetrics} = newMetrics;
    assert.deepEqual(legacyMetrics, oldMetrics);
    const oldPayload = plain(before.buildGhlContactPayload_(customer, oldMetrics, 'location'));
    const newPayload = plain(after.buildGhlContactPayload_(customer, newMetrics, 'location'));
    newPayload.customFields = newPayload.customFields.filter(f => !ids.includes(f.id));
    assert.deepEqual(newPayload, oldPayload);
  }
});

test('new fields map to verified IDs; blanks explicitly remove stale delivery dates', () => {
  const ctx = context();
  for (const fixture of [orders, [], [orders[2]]]) {
    const metrics = ctx.aggregateCustomerOrders_(fixture);
    const payload = ctx.buildGhlContactPayload_(customer, metrics, 'location');
    assert.deepEqual(plain(payload.customFields.filter(f => ids.includes(f.id))), [
      {id: ids[0], fieldValue: metrics.firstOrderDeliveryDate},
      {id: ids[1], fieldValue: metrics.latestOrderDeliveryDate}
    ]);
  }
});

test('emergency switch restores the exact legacy contact payload', () => {
  const before = context(baseline);
  const after = context(source, ' FALSE ');
  assert.deepEqual(
    plain(after.buildGhlContactPayload_(customer, after.aggregateCustomerOrders_(orders), 'location')),
    plain(before.buildGhlContactPayload_(customer, before.aggregateCustomerOrders_(orders), 'location'))
  );
});

test('aggregation does not mutate the input order list', () => {
  const fixture = plain(orders);
  context().aggregateCustomerOrders_(fixture);
  assert.deepEqual(fixture, orders);
});

test('both mapped updates and contact upserts carry the new fields', () => {
  const ctx = context();
  vm.runInContext(fs.readFileSync(path.join(root, 'src/ProductionSync.js'), 'utf8'), ctx);
  const calls = [];
  ctx.findEntityMap_ = () => null;
  ctx.ghlRequest_ = (endpoint, options) => {
    calls.push({endpoint, options: plain(options)});
    return {body: {contact: {id: 'mapped-contact'}}};
  };
  const metrics = ctx.aggregateCustomerOrders_(orders);
  ctx.upsertProductionGhlContact_(customer, metrics, 'location', {values: ['', '', '', '', '', 'mapped-contact']});
  ctx.upsertProductionGhlContact_(customer, metrics, 'location', null);
  assert.equal(calls[0].endpoint, '/contacts/mapped-contact');
  assert.equal(calls[0].options.method, 'put');
  assert.equal(calls[0].options.payload.locationId, undefined);
  assert.equal(calls[1].endpoint, '/contacts/upsert');
  assert.equal(calls[1].options.payload.locationId, 'location');
  for (const call of calls) assert.equal(call.options.payload.customFields.filter(f => ids.includes(f.id)).length, 2);
});

test('all Apps Script JavaScript parses together and manifest retains webhook access', () => {
  const combined = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
  assert.doesNotThrow(() => new vm.Script(combined));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/appsscript.json')));
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
});
