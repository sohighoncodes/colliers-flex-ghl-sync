function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

function elapsedMs_(startedAtMs) {
  return Date.now() - startedAtMs;
}

function safeJson_(value) {
  try {
    const json = JSON.stringify(redactSensitive_(value === undefined ? null : value));
    return json.length > 45000 ? json.substring(0, 45000) + '…[truncated]' : json;
  } catch (error) {
    return JSON.stringify({serializationError: String(error)});
  }
}

function redactSensitive_(value) {
  if (Array.isArray(value)) return value.map(redactSensitive_);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  Object.keys(value).forEach(function(key) {
    if (/authorization|api[-_]?key|token|secret|password|cookie/i.test(key)) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = redactSensitive_(value[key]);
    }
  });
  return output;
}

function truncate_(value, maxLength) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
}

function sleepWithBackoff_(attempt) {
  const base = SYNC_CONSTANTS.baseRetryDelayMs * Math.pow(2, attempt - 1);
  Utilities.sleep(base + Math.floor(Math.random() * 250));
}

function isRetryableStatus_(status) {
  return status === 408 || status === 429 || status >= 500;
}

function parseJsonSafe_(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return {raw: truncate_(text, 10000)};
  }
}
