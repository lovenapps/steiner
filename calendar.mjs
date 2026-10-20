/**
 * STEINER WARS - Vercel server-side proxy for the existing Google Apps Script.
 * No cross-origin browser requests, no Google login for players, no database move.
 * Secrets must be configured under Vercel Project Settings -> Environment Variables.
 */
const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff'
};

function respond(status, data) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return respond(405, { ok: false, error: 'Method not allowed' });
    }

    const appsScriptUrl = (process.env.STEINER_APPS_SCRIPT_URL || '').trim();
    const apiKey = (process.env.STEINER_API_KEY || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(appsScriptUrl) || apiKey.length < 24) {
      return respond(503, { ok: false, error: 'Vercel environment configuration is incomplete' });
    }

    const payload = { action: 'get', secret: apiKey };
    if (request.method === 'POST') {
      let data;
      try {
        data = await request.json();
      } catch (_) {
        return respond(400, { ok: false, error: 'Invalid JSON' });
      }
      if (!data || !Array.isArray(data.changes) || data.changes.length > 200) {
        return respond(400, { ok: false, error: 'Expected at most 200 changes' });
      }
      for (const change of data.changes) {
        if (!change || typeof change.date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(change.date) ||
            !['Yoni', 'YAAL', 'Yael', 'empty'].includes(change.assignedTo)) {
          return respond(400, { ok: false, error: 'Invalid change record' });
        }
      }
      payload.action = 'save';
      payload.changes = data.changes;
    }

    try {
      // Apps Script ContentService responds with a redirect to googleusercontent.com.
      // Node fetch follows that redirect server-side; the browser remains on Vercel.
      const upstream = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.timeout(25000)
      });

      const resultText = await upstream.text();
      let result;
      try {
        result = JSON.parse(resultText);
      } catch (_) {
        return respond(502, {
          ok: false,
          error: 'Apps Script returned HTML/non-JSON. Check deployment: /exec, Execute as me, Anyone.'
        });
      }
      if (!upstream.ok || !result || result.ok !== true) {
        return respond(502, {
          ok: false,
          error: result && result.error ? String(result.error) : 'Apps Script request failed'
        });
      }
      return respond(200, result);
    } catch (err) {
      return respond(502, {
        ok: false,
        error: 'Cannot reach Google Apps Script: ' +
          (err && err.name === 'TimeoutError' ? 'request timed out' : 'upstream connection error')
      });
    }
  }
};
