# Colliers Flex Static Gateway

A minimal read-only HTTP gateway intended for an Oracle Cloud Always Free VM with one stable public IPv4 address.

## Purpose

Apps Script currently reaches Flex through rotating Google egress IPs, which conflicts with Flex's one-IP-at-a-time allowlist. This gateway becomes the only component that calls Flex directly. Flex can then allowlist the VM's single public IPv4 address.

## Security model

- GET only.
- Requires `Authorization: Bearer <GATEWAY_SECRET>`.
- Only proxies `/api/v1/customers`, `/api/v1/orders`, `/api/v1/companies`, and `/api/v1/webhooks` paths.
- The Flex API key stays on the VM and is never returned to callers.

## Environment

- `FLEX_API_KEY` required.
- `GATEWAY_SECRET` required. Use a long random value different from other project secrets.
- `FLEX_BASE_URL` optional; defaults to `https://www.colliers.net.au`.
- `PORT` optional; defaults to `8080`.

## Run

```bash
cd gateway
FLEX_API_KEY='...' GATEWAY_SECRET='...' npm start
```

## Health check

```bash
curl http://127.0.0.1:8080/health
```

## Authenticated Flex test

```bash
curl -H 'Authorization: Bearer YOUR_GATEWAY_SECRET' \
  'http://127.0.0.1:8080/flex/api/v1/customers?per_page=1&page=1'
```

Do not switch Apps Script to this gateway until the VM is running, the VM public IPv4 is allowlisted in Flex, and this read-only test succeeds.
