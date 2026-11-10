// GET /api/download?url=<encoded media url>&filename=<name>
// Server-side proxy: streams the resolved media file through this
// server with a proper Content-Disposition so the browser saves the
// file instead of opening (or being blocked from) a third-party CDN link.
// Only http(s) URLs are allowed; private/local hosts are rejected.

const { sanitizeFilename } = require('../lib/downloader');

const BLOCKED_HOSTS = new Set([
  'localhost', 'metadata.google.internal', 'metadata.goog',
]);

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h === '[::1]' || h === '::1') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET.' });
  }
  const target = req.query?.url || '';
  if (!target) return res.status(400).json({ ok: false, error: 'Missing ?url= parameter.' });

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid url parameter.' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ ok: false, error: 'Only http(s) URLs are allowed.' });
  }
  if (isPrivateHost(parsed.hostname)) {
    return res.status(400).json({ ok: false, error: 'That host is not allowed.' });
  }

  const filename = sanitizeFilename(req.query.filename, 'video.mp4');
  const ext = (filename.split('.').pop() || 'mp4').toLowerCase();
  const contentType = ext === 'mp3' ? 'audio/mpeg'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
    : 'video/mp4';

  try {
    const upstream = await fetch(target, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        ...(req.headers.range ? { range: req.headers.range } : {}),
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ ok: false, error: `Upstream server returned ${upstream.status}.` });
    }

    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || contentType);
    if (upstream.headers.get('content-length')) {
      res.setHeader('Content-Length', upstream.headers.get('content-length'));
    }
    if (upstream.headers.get('content-range')) {
      res.setHeader('Content-Range', upstream.headers.get('content-range'));
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    // Stream the upstream body straight through (no buffering).
    // Async iteration (not .pipe()) so this works with any response object.
    const canWaitForDrain = typeof res.once === 'function';
    for await (const chunk of upstream.body) {
      const flushed = res.write(chunk);
      if (flushed === false && canWaitForDrain) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      return res.status(502).json({ ok: false, error: `Could not fetch the file (${e.message}).` });
    }
    res.end();
  }
};
