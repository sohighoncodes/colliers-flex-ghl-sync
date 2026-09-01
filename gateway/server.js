import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8080);
const FLEX_BASE_URL = String(process.env.FLEX_BASE_URL || 'https://www.colliers.net.au').replace(/\/$/, '');
const FLEX_API_KEY = String(process.env.FLEX_API_KEY || '').trim();
const GATEWAY_SECRET = String(process.env.GATEWAY_SECRET || '').trim();

function json(res, status, body) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getBearer(req) {
  const auth = String(req.headers.authorization || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function isAllowedFlexPath(pathname) {
  if (!pathname.startsWith('/api/v1/')) return false;
  return [
    '/api/v1/customers',
    '/api/v1/orders',
    '/api/v1/companies',
    '/api/v1/webhooks'
  ].some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'colliers-flex-static-gateway',
        configured: !!FLEX_API_KEY && !!GATEWAY_SECRET
      });
    }

    if (req.method !== 'GET') {
      return json(res, 405, {ok: false, error: 'method_not_allowed'});
    }

    if (!FLEX_API_KEY || !GATEWAY_SECRET) {
      return json(res, 500, {ok: false, error: 'gateway_not_configured'});
    }

    const token = getBearer(req);
    if (!token || !timingSafeEqualText(token, GATEWAY_SECRET)) {
      return json(res, 401, {ok: false, error: 'unauthorized'});
    }

    if (!url.pathname.startsWith('/flex/')) {
      return json(res, 404, {ok: false, error: 'not_found'});
    }

    const flexPath = url.pathname.slice('/flex'.length);
    if (!isAllowedFlexPath(flexPath)) {
      return json(res, 403, {ok: false, error: 'flex_path_not_allowed'});
    }

    const target = FLEX_BASE_URL + flexPath + url.search;
    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        'X-API-KEY': FLEX_API_KEY,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(30000)
    });

    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(text);
  } catch (error) {
    json(res, 502, {
      ok: false,
      error: 'gateway_error',
      message: error && error.message ? error.message : String(error)
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Colliers Flex static gateway listening on ${PORT}`);
});
