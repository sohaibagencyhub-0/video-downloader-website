// Video Downloader — frontend logic (plain browser JS, no framework).
// Paste button: tries navigator.clipboard.readText(); if the browser
// blocks clipboard access, it focuses the input and shows an inline
// hint telling the user to press Ctrl+V. Native Ctrl+V / paste always
// works through the input's own paste event.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var urlInput = $('urlInput');
  var pasteBtn = $('pasteBtn');
  var pasteHint = $('pasteHint');
  var toolHint = $('toolHint');
  var platformBadge = $('platformBadge');
  var convertForm = $('convertForm');
  var convertBtn = $('convertBtn');
  var convertLabel = $('convertLabel');
  var qualitySelect = $('qualitySelect');
  var termsCheckbox = $('termsCheckbox');
  var formError = $('formError');
  var resultsEl = $('results');
  var resultThumb = $('resultThumb');
  var resultTitle = $('resultTitle');
  var resultPlatform = $('resultPlatform');
  var resultSource = $('resultSource');
  var optionList = $('optionList');

  var format = 'mp4';
  var hintTimer = null;

  // ------------------------------------------------------------ platform
  function detectPlatform(value) {
    var v = String(value || '').toLowerCase();
    if (v.indexOf('youtube.com') !== -1 || v.indexOf('youtu.be') !== -1) return 'youtube';
    if (v.indexOf('tiktok.com') !== -1 || v.indexOf('vt.tiktok.com') !== -1) return 'tiktok';
    if (v.indexOf('facebook.com') !== -1 || v.indexOf('fb.watch') !== -1 || v.indexOf('fb.com') !== -1) return 'facebook';
    if (v.indexOf('instagram.com') !== -1 || v.indexOf('instagr.am') !== -1) return 'instagram';
    return null;
  }

  function refreshPlatformBadge() {
    var platform = detectPlatform(urlInput.value);
    if (platform) {
      platformBadge.textContent = platform;
      platformBadge.hidden = false;
    } else {
      platformBadge.hidden = true;
    }
  }

  // ------------------------------------------------------------ paste
  function showPasteHint(message) {
    pasteHint.textContent = message;
    pasteHint.classList.add('warn');
    pasteHint.hidden = false;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { pasteHint.hidden = true; }, 6000);
  }

  function pasteFromClipboard() {
    // Clipboard API needs a secure context (https/localhost) and a user
    // gesture; browsers may also deny it without a permission prompt.
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      urlInput.focus();
      showPasteHint('Clipboard access is not available in this browser — press Ctrl+V to paste.');
      return;
    }
    pasteBtn.disabled = true;
    navigator.clipboard.readText().then(
      function (text) {
        pasteBtn.disabled = false;
        if (text && text.trim()) {
          urlInput.value = text.trim();
          pasteHint.hidden = true;
          refreshPlatformBadge();
          urlInput.focus();
        } else {
          urlInput.focus();
          showPasteHint('Your clipboard is empty — copy a video link first, then press Paste.');
        }
      },
      function () {
        pasteBtn.disabled = false;
        urlInput.focus();
        showPasteHint('Clipboard blocked by your browser — press Ctrl+V to paste.');
      }
    );
  }

  pasteBtn.addEventListener('click', pasteFromClipboard);
  urlInput.addEventListener('input', refreshPlatformBadge);
  // Native paste (Ctrl+V / long-press paste) flows through here too.
  urlInput.addEventListener('paste', function () {
    pasteHint.hidden = true;
    setTimeout(refreshPlatformBadge, 0);
  });

  // ------------------------------------------------------------ format toggle
  var MP4_QUALITIES = [
    { value: '720', label: '720p' },
    { value: '480', label: '480p' },
    { value: '360', label: '360p' },
  ];
  var MP3_QUALITIES = [{ value: '128', label: '128kbps' }];

  function rebuildQualityOptions() {
    var list = format === 'mp3' ? MP3_QUALITIES : MP4_QUALITIES;
    qualitySelect.innerHTML = '';
    list.forEach(function (q) {
      var opt = document.createElement('option');
      opt.value = q.value;
      opt.textContent = q.label;
      qualitySelect.appendChild(opt);
    });
    convertLabel.textContent = format === 'mp3' ? 'Convert to MP3' : 'Convert to MP4';
  }

  Array.prototype.forEach.call(document.querySelectorAll('.seg-btn'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.seg-btn'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      format = btn.getAttribute('data-format');
      rebuildQualityOptions();
    });
  });

  // ------------------------------------------------------------ tools / menus
  var TOOL_PLACEHOLDERS = {
    youtube: 'Paste a YouTube link, e.g. https://www.youtube.com/watch?v=…',
    tiktok: 'Paste a TikTok link, e.g. https://www.tiktok.com/@user/video/…',
    instagram: 'Paste an Instagram link, e.g. https://www.instagram.com/reel/…',
    facebook: 'Paste a Facebook link, e.g. https://www.facebook.com/watch/?v=…',
  };

  function pickTool(tool) {
    urlInput.placeholder = TOOL_PLACEHOLDERS[tool] || urlInput.placeholder;
    toolHint.textContent = TOOL_PLACEHOLDERS[tool] || '';
    toolHint.hidden = !TOOL_PLACEHOLDERS[tool];
    document.getElementById('converter').scrollIntoView({ behavior: 'smooth', block: 'center' });
    urlInput.focus();
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (el) {
    el.addEventListener('click', function () {
      pickTool(el.getAttribute('data-tool'));
      var menu = $('toolsMenu');
      if (menu) menu.hidden = true;
      var btn = $('toolsMenuBtn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  });

  var toolsMenuBtn = $('toolsMenuBtn');
  var toolsMenu = $('toolsMenu');
  if (toolsMenuBtn && toolsMenu) {
    toolsMenuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = toolsMenu.hidden;
      toolsMenu.hidden = !open;
      toolsMenuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function () {
      toolsMenu.hidden = true;
      toolsMenuBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // ------------------------------------------------------------ modals
  function openModal(id) {
    var m = $(id);
    if (m) m.hidden = false;
  }
  function closeModals() {
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) { m.hidden = true; });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-modal]'), function (el) {
    el.addEventListener('click', function () { openModal(el.getAttribute('data-modal')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (el) {
    el.addEventListener('click', closeModals);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModals();
  });

  // ------------------------------------------------------------ convert
  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }
  function clearError() { formError.hidden = true; }

  function safeFilename(title, ext) {
    var base = String(title || 'video')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'video';
    return base + '.' + ext;
  }

  function renderResults(data) {
    resultTitle.textContent = data.title || 'Video';
    resultPlatform.textContent = data.platform || '';
    resultSource.textContent = data.author ? 'by ' + data.author : '';
    if (data.thumbnail) {
      resultThumb.src = data.thumbnail;
      resultThumb.style.display = '';
    } else {
      resultThumb.removeAttribute('src');
      resultThumb.style.display = 'none';
    }
    optionList.innerHTML = '';
    data.options.forEach(function (opt, index) {
      var a = document.createElement('a');
      a.className = 'dl-btn' + (index > 0 ? ' secondary' : '');
      a.textContent = 'Download ' + opt.label;
      a.href = '/api/download?url=' + encodeURIComponent(opt.url) +
        '&filename=' + encodeURIComponent(safeFilename(data.title, opt.format || 'mp4'));
      a.setAttribute('download', '');
      optionList.appendChild(a);
    });
    resultsEl.hidden = false;
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  convertForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();
    resultsEl.hidden = true;

    var url = urlInput.value.trim();
    if (!url) { showError('Please paste a video link first.'); urlInput.focus(); return; }
    if (!detectPlatform(url)) {
      showError('Only YouTube, TikTok, Facebook and Instagram links are supported.');
      return;
    }
    if (!termsCheckbox.checked) {
      showError('Please tick the box to agree to the Terms of Use and Privacy Policy first.');
      termsCheckbox.focus();
      return;
    }

    convertBtn.disabled = true;
    convertLabel.textContent = 'Converting…';
    var quality = qualitySelect.value;

    fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, format: format, quality: quality }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        convertBtn.disabled = false;
        convertLabel.textContent = format === 'mp3' ? 'Convert to MP3' : 'Convert to MP4';
        if (!data || !data.ok) {
          showError((data && data.error) || 'Conversion failed. Please try again in a minute.');
          return;
        }
        if (!data.options || !data.options.length) {
          showError('No downloadable file was found for this link.');
          return;
        }
        renderResults(data);
      })
      .catch(function () {
        convertBtn.disabled = false;
        convertLabel.textContent = format === 'mp3' ? 'Convert to MP3' : 'Convert to MP4';
        showError('Could not reach the server. Please check your connection and try again.');
      });
  });

  refreshPlatformBadge();
})();
