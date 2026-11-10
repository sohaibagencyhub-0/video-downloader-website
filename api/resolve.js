// POST /api/resolve
// Body: { "url": "<video link>", "format": "mp4" | "mp3", "quality": "720" | "480" | "360" }
// Returns: { ok, platform, title, thumbnail, options: [{ label, quality, format, url }] }
// or an honest { ok: false, error } when every free service fails.
// Free APIs only, no keys. CORS enabled so the static frontend can call it.

const { resolveUrl } = require('../lib/downloader');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
  }
  try {
    const body = await readBody(req);
    const result = await resolveUrl(body.url, { format: body.format, quality: body.quality });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ok: false, error: `Download failed (${e.message}). Please try again in a minute.` });
  }
};
