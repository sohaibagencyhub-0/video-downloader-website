// Shared resolver logic for the Video Downloader website.
// Free APIs only, no keys, no paid services.
// Endpoint patterns and response parsing are taken from the proven
// WhatsApp-bot downloader plugins (downloader-push/ytdl.js, tk.js,
// dl-tiktok.js, dl-insta.js).
//
//   YouTube   -> SaveTube chain over CDNs cdn400-cdn406.savetube.vip
//                (/v2/info then /download, AES-128-CBC decrypt)
//   TikTok    -> JawadTech /download/tiktok -> /download/ttdl
//                -> tikwm -> deline
//   Facebook  -> aswin-sparky fbdl (?url= then ?ur= fallback)
//   Instagram -> aswin-sparky igdl -> JawadTech igdl
//                -> JawadTech /downloader

const crypto = require('node:crypto');

const FETCH_TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---------------------------------------------------------------- helpers

async function fetchJson(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetch(url, {
    ...options,
    headers: { 'user-agent': UA, ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${new URL(url).hostname}`);
  }
}

function detectPlatform(rawUrl) {
  const u = (rawUrl || '').toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('tiktok.com') || u.includes('vt.tiktok.com')) return 'tiktok';
  if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
  if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
  return null;
}

function sanitizeFilename(name, fallback) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

// ---------------------------------------------------------------- YouTube (SaveTube)

const SAVE_TUBE_CDNS = [
  'cdn406.savetube.vip',
  'cdn405.savetube.vip',
  'cdn404.savetube.vip',
  'cdn403.savetube.vip',
  'cdn402.savetube.vip',
  'cdn401.savetube.vip',
  'cdn400.savetube.vip',
];
const SAVE_TUBE_KEY = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
const SAVE_TUBE_HEADERS = {
  'content-type': 'application/json',
  origin: 'https://ytube.savetube.me',
  referer: 'https://ytube.savetube.me/',
  'user-agent': UA,
};

function getYouTubeId(url) {
  const m = String(url).match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/
  );
  return m ? m[1] : null;
}

function decryptSaveTube(enc) {
  const buf = Buffer.from(String(enc).replace(/\s/g, ''), 'base64');
  const iv = buf.subarray(0, 16);
  const data = buf.subarray(16);
  const decipher = crypto.createDecipheriv('aes-128-cbc', SAVE_TUBE_KEY, iv);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString());
}

// Ask every SaveTube CDN for /v2/info in parallel; first success wins.
async function saveTubeInfo(watchUrl) {
  const attempts = SAVE_TUBE_CDNS.map(async (cdn) => {
    const json = await fetchJson(`https://${cdn}/v2/info`, {
      method: 'POST',
      headers: SAVE_TUBE_HEADERS,
      body: JSON.stringify({ url: watchUrl }),
    });
    if (!json?.status || !json?.data) throw new Error(`SaveTube ${cdn} info failed`);
    return { cdn, info: decryptSaveTube(json.data) };
  });
  const settled = await Promise.allSettled(attempts);
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.info?.id && r.value?.info?.key) return r.value;
  }
  const reason = settled.find((r) => r.status === 'rejected');
  throw new Error(reason ? String(reason.reason?.message || reason.reason) : 'SaveTube info failed on all CDNs');
}

async function saveTubeDownload(cdn, info, downloadType, quality) {
  const json = await fetchJson(`https://${cdn}/download`, {
    method: 'POST',
    headers: SAVE_TUBE_HEADERS,
    body: JSON.stringify({ id: info.id, key: info.key, downloadType, quality: String(quality) }),
  });
  const link = json?.data?.downloadUrl;
  if (!link) throw new Error(`SaveTube ${cdn} download failed for ${quality}`);
  return link;
}

async function resolveYouTube(url, format = 'mp4', quality = '720') {
  const id = getYouTubeId(url);
  if (!id) return { ok: false, error: 'That does not look like a valid YouTube link.' };
  const watchUrl = `https://youtube.com/watch?v=${id}`;

  let infoResult;
  try {
    infoResult = await saveTubeInfo(watchUrl);
  } catch (e) {
    return { ok: false, error: `YouTube could not be resolved right now (${e.message}). The free servers are busy — please try again in a minute.` };
  }
  const { cdn, info } = infoResult;
  const title = info.title || 'YouTube Video';
  const thumbnail = info.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

  if (format === 'mp3') {
    try {
      const link = await saveTubeDownload(cdn, info, 'audio', '128');
      return {
        ok: true, platform: 'youtube', title, thumbnail,
        options: [{ label: 'MP3 Audio (128kbps)', quality: '128kbps', format: 'mp3', url: link }],
      };
    } catch {
      return { ok: false, error: 'YouTube audio could not be converted right now. The free servers are busy — please try again in a minute.' };
    }
  }

  // Video: fetch the requested quality first, plus the other qualities
  // in parallel (best effort) so the user gets a choice.
  const qualities = [...new Set([String(quality), '720', '480', '360'])];
  const settled = await Promise.allSettled(
    qualities.map(async (q) => ({ q, url: await saveTubeDownload(cdn, info, 'video', q) }))
  );
  const options = settled
    .filter((r) => r.status === 'fulfilled')
    .map((r) => ({
      label: `${r.value.q}p HD`,
      quality: `${r.value.q}p`,
      format: 'mp4',
      url: r.value.url,
    }))
    // Keep requested quality first, then descending.
    .sort((a, b) => {
      const rank = (x) => (x.quality === `${quality}p` ? 1000 : parseInt(x.quality, 10));
      return rank(b) - rank(a);
    });

  if (!options.length) {
    return { ok: false, error: 'YouTube video could not be converted right now. The free servers are busy — please try again in a minute.' };
  }
  return { ok: true, platform: 'youtube', title, thumbnail, options };
}

// ---------------------------------------------------------------- TikTok

async function resolveTikTok(url) {
  let videoUrl = null;
  let audioUrl = null;
  let title = 'TikTok Video';
  let author = '';
  let lastError = null;

  // 1) JawadTech /download/tiktok
  try {
    const d = await fetchJson(`https://jawad-tech.vercel.app/download/tiktok?url=${encodeURIComponent(url)}`);
    if (d?.status && d?.result) {
      videoUrl = d.result;
      title = d.metadata?.title || title;
      author = d.metadata?.author || d.metadata?.username || '';
    } else throw new Error('JawadTech tiktok failed');
  } catch (e) { lastError = e; }

  // 2) JawadTech /download/ttdl
  if (!videoUrl) {
    try {
      const d = await fetchJson(`https://jawad-tech.vercel.app/download/ttdl?url=${encodeURIComponent(url)}`);
      if (d?.status && d?.result) {
        videoUrl = d.result;
        title = d.metadata?.title || title;
        const a = d.metadata?.author;
        author = a?.nickname || a || '';
      } else throw new Error('JawadTech ttdl failed');
    } catch (e) { lastError = e; }
  }

  // 3) tikwm (no-watermark video + music audio)
  if (!videoUrl || !audioUrl) {
    try {
      const d = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
      if (d?.code === 0 && d?.data?.play) {
        if (!videoUrl) videoUrl = d.data.play;
        audioUrl = d.data.music_play_url || d.data.music || null;
        title = d.data.title || title;
        author = d.data.author?.nickname || d.data.author?.unique_id || author;
      } else throw new Error('tikwm failed');
    } catch (e) { lastError = e; }
  }

  // 4) deline
  if (!videoUrl) {
    try {
      const d = await fetchJson(`https://api.deline.web.id/downloader/tiktok?url=${encodeURIComponent(url)}`);
      if (d?.status && d?.result?.download) {
        videoUrl = d.result.download;
      } else throw new Error('deline failed');
    } catch (e) { lastError = e; }
  }

  if (!videoUrl) {
    return { ok: false, error: `TikTok could not be resolved right now (${lastError ? lastError.message : 'all free services failed'}). Please try again in a minute.` };
  }
  const options = [{ label: 'Video (No Watermark)', quality: 'HD', format: 'mp4', url: videoUrl }];
  if (audioUrl) options.push({ label: 'MP3 Audio', quality: '128kbps', format: 'mp3', url: audioUrl });
  return { ok: true, platform: 'tiktok', title, author, thumbnail: null, options };
}

// ---------------------------------------------------------------- Facebook

async function resolveFacebook(url) {
  let lastError = null;
  for (const param of ['url', 'ur']) {
    try {
      const json = await fetchJson(
        `https://api-aswin-sparky.koyeb.app/api/downloader/fbdl?${param}=${encodeURIComponent(url)}`
      );
      if (json?.status === true && json?.data && (json.data.high || json.data.low)) {
        const options = [];
        if (json.data.high) options.push({ label: 'HD Video', quality: 'HD', format: 'mp4', url: json.data.high });
        if (json.data.low) options.push({ label: 'SD Video', quality: 'SD', format: 'mp4', url: json.data.low });
        return {
          ok: true, platform: 'facebook',
          title: json.data.title || 'Facebook Video',
          thumbnail: json.data.thumbnail || null,
          options,
        };
      }
      throw new Error('aswin-sparky fbdl returned no video');
    } catch (e) { lastError = e; }
  }
  return { ok: false, error: `Facebook could not be resolved right now (${lastError ? lastError.message : 'free service failed'}). Please check the link is public and try again.` };
}

// ---------------------------------------------------------------- Instagram

async function resolveInstagram(url) {
  let media = [];
  let lastError = null;

  // 1) aswin-sparky igdl -> data: [{ type: 'video'|'image', url }]
  try {
    const res = await fetchJson(`https://api-aswin-sparky.koyeb.app/api/downloader/igdl?url=${encodeURIComponent(url)}`);
    if (res?.status && Array.isArray(res.data) && res.data.length) {
      media = res.data.map((i) => ({ type: i.type === 'video' ? 'video' : 'image', url: i.url })).filter((i) => i.url);
    }
    if (!media.length) throw new Error('aswin-sparky igdl failed');
  } catch (e) { lastError = e; }

  // 2) JawadTech igdl -> result: [{ contentType, format, url }]
  if (!media.length) {
    try {
      const res = await fetchJson(`https://jawad-tech.vercel.app/igdl?url=${encodeURIComponent(url)}`);
      if (res?.status && Array.isArray(res.result) && res.result.length) {
        media = res.result.map((i) => ({
          type: i.contentType?.includes('video') || i.format === 'mp4' ? 'video' : 'image',
          url: i.url,
        })).filter((i) => i.url);
      }
      if (!media.length) throw new Error('JawadTech igdl failed');
    } catch (e) { lastError = e; }
  }

  // 3) JawadTech generic downloader -> result: [url, ...]
  if (!media.length) {
    try {
      const res = await fetchJson(`https://jawad-tech.vercel.app/downloader?url=${encodeURIComponent(url)}`);
      if (res?.status && Array.isArray(res.result) && res.result.length) {
        media = res.result.filter((u) => typeof u === 'string' && u).map((u) => ({ type: 'video', url: u }));
      }
      if (!media.length) throw new Error('JawadTech downloader failed');
    } catch (e) { lastError = e; }
  }

  if (!media.length) {
    return { ok: false, error: `Instagram could not be resolved right now (${lastError ? lastError.message : 'all free services failed'}). Please check the link is public and try again.` };
  }
  let v = 0; let p = 0;
  const options = media.map((item) => {
    if (item.type === 'video') {
      v += 1;
      return { label: v > 1 ? `Video ${v}` : 'Video', quality: 'HD', format: 'mp4', url: item.url };
    }
    p += 1;
    return { label: p > 1 ? `Photo ${p}` : 'Photo', quality: 'HD', format: 'jpg', url: item.url };
  });
  return { ok: true, platform: 'instagram', title: 'Instagram Media', thumbnail: null, options };
}

// ---------------------------------------------------------------- dispatcher

async function resolveUrl(rawUrl, opts = {}) {
  const url = String(rawUrl || '').trim();
  if (!url) return { ok: false, error: 'Please paste a video link first.' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'That does not look like a valid link.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'That does not look like a valid link.' };
  }
  const platform = detectPlatform(url);
  if (!platform) {
    return { ok: false, error: 'Only YouTube, TikTok, Facebook and Instagram links are supported.' };
  }
  const format = opts.format === 'mp3' ? 'mp3' : 'mp4';
  const quality = ['720', '480', '360'].includes(String(opts.quality)) ? String(opts.quality) : '720';
  try {
    if (platform === 'youtube') return await resolveYouTube(url, format, quality);
    if (platform === 'tiktok') return await resolveTikTok(url);
    if (platform === 'facebook') return await resolveFacebook(url);
    return await resolveInstagram(url);
  } catch (e) {
    return { ok: false, error: `Download failed (${e.message}). Please try again in a minute.` };
  }
}

module.exports = {
  detectPlatform,
  getYouTubeId,
  resolveUrl,
  resolveYouTube,
  resolveTikTok,
  resolveFacebook,
  resolveInstagram,
  sanitizeFilename,
  FETCH_TIMEOUT_MS,
};
