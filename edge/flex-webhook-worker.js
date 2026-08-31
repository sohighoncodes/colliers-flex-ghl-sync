export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return json({ok: false, error: 'method_not_allowed'}, 405);
    }

    if (!env.FLEX_WEBHOOK_SECRET || !env.APPS_SCRIPT_WEBHOOK_URL) {
      return json({ok: false, error: 'worker_not_configured'}, 500);
    }

    const rawBody = await request.text();
    const receivedCode = request.headers.get('x-webhook-code') || '';
    const expectedCode = await sha1Hex(env.FLEX_WEBHOOK_SECRET + rawBody);

    if (!timingSafeEqual(receivedCode.toLowerCase(), expectedCode.toLowerCase())) {
      return json({ok: false, error: 'invalid_signature'}, 401);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ok: false, error: 'invalid_json'}, 400);
    }

    const eventId = String(payload.event_id || payload.event_uuid || '');
    const eventType = String(payload.type || '');
    if (!eventId || !eventType) {
      return json({ok: false, error: 'missing_event_identity'}, 400);
    }

    const upstream = await fetch(env.APPS_SCRIPT_WEBHOOK_URL, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: rawBody,
      redirect: 'follow'
    });

    const upstreamText = await upstream.text();
    let upstreamBody;
    try { upstreamBody = JSON.parse(upstreamText); }
    catch { upstreamBody = {raw: upstreamText}; }

    if (!upstream.ok || !upstreamBody || upstreamBody.ok !== true) {
      return json({
        ok: false,
        retry: !!(upstreamBody && upstreamBody.retry),
        error: 'upstream_failed',
        upstreamStatus: upstream.status,
        eventId,
        eventType
      }, upstreamBody && upstreamBody.retry ? 503 : 502);
    }

    return json({ok: true, eventId, eventType, upstream: upstreamBody}, 200);
  }
};

async function sha1Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'}
  });
}
