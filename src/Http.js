function SyncHttpError_(message, details) {
  this.name = 'SyncHttpError';
  this.message = message;
  Object.keys(details || {}).forEach(function(key) {
    this[key] = details[key];
  }, this);
  if (Error.captureStackTrace) Error.captureStackTrace(this, SyncHttpError_);
}
SyncHttpError_.prototype = Object.create(Error.prototype);
SyncHttpError_.prototype.constructor = SyncHttpError_;

function apiRequest_(options) {
  const method = String(options.method || 'get').toUpperCase();
  const maxAttempts = options.maxAttempts || SYNC_CONSTANTS.maxHttpAttempts;
  const startedAtMs = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const fetchOptions = {
        method: method,
        headers: options.headers || {},
        muteHttpExceptions: true,
        followRedirects: true
      };
      if (options.payload !== undefined) {
        fetchOptions.contentType = 'application/json';
        fetchOptions.payload = JSON.stringify(options.payload);
      }

      const response = UrlFetchApp.fetch(options.url, fetchOptions);
      const status = response.getResponseCode();
      const bodyText = response.getContentText();
      const parsedBody = parseJsonSafe_(bodyText);

      if (status >= 200 && status < 300) {
        return {
          status: status,
          body: parsedBody,
          headers: response.getAllHeaders(),
          attempt: attempt,
          durationMs: elapsedMs_(startedAtMs)
        };
      }

      const retryable = isRetryableStatus_(status);
      lastError = new SyncHttpError_(
        method + ' ' + options.url + ' returned HTTP ' + status,
        {
          httpMethod: method,
          endpoint: options.url,
          httpStatus: status,
          errorCode: parsedBody && (parsedBody.code || parsedBody.error),
          responseBody: parsedBody,
          requestContext: {
            headers: redactSensitive_(options.headers || {}),
            payload: redactSensitive_(options.payload)
          },
          attempt: attempt,
          retryable: retryable
        }
      );

      if (!retryable || attempt === maxAttempts) throw lastError;
      sleepWithBackoff_(attempt);
    } catch (error) {
      if (error instanceof SyncHttpError_) {
        if (!error.retryable || attempt === maxAttempts) throw error;
        lastError = error;
        sleepWithBackoff_(attempt);
        continue;
      }

      lastError = new SyncHttpError_(error.message || String(error), {
        httpMethod: method,
        endpoint: options.url,
        requestContext: {
          headers: redactSensitive_(options.headers || {}),
          payload: redactSensitive_(options.payload)
        },
        attempt: attempt,
        retryable: true,
        stack: error.stack
      });
      if (attempt === maxAttempts) throw lastError;
      sleepWithBackoff_(attempt);
    }
  }

  throw lastError;
}
