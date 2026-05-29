// SECTION: Core Busy / Anti Double Click
// Purpose : Prevent duplicate clicks and show progress UI for long-running actions.
// Depends : js/core/base.js ($, UI).
// Provides: setBtnBusy(btn, busy, label), runExclusive(key, fn), withBusy(btn, fn).

/* =========================================================
   ✅ BUSY / SPINNER + ANTI DOUBLE CLICK (GLOBAL)
   ========================================================= */

function setBtnLoading(btn, on, label){
  if (!btn) return;
  if (on){
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.dataset.origHtml = btn.innerHTML;
    btn.classList.add('is-loading');
    btn.disabled = true;

    const txt = label || btn.dataset.loadingLabel || 'Memproses…';
    btn.innerHTML = `<span class="btn-spin" aria-hidden="true"></span><span>${txt}</span>`;
    btn.setAttribute('aria-busy', 'true');
  } else {
    btn.dataset.busy = '0';
    btn.classList.remove('is-loading');
    btn.disabled = false;

    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    btn.removeAttribute('aria-busy');
  }
}

function ensureBusyOverlay_(){
  let ov = document.getElementById('busy-overlay');
  if (ov) return ov;

  ov = document.createElement('div');
  ov.id = 'busy-overlay';
  ov.className = 'hidden';
  ov.setAttribute('aria-hidden', 'true');

  ov.innerHTML = `
    <div class="busy-card" role="status" aria-live="polite">
      <div class="busy-spin" aria-hidden="true"></div>
      <div id="busy-text" class="busy-text">Memproses…</div>
      <div class="busy-sub small" style="opacity:.85;margin-top:6px;">Mohon tunggu sebentar.</div>
    </div>
  `;

  document.body.appendChild(ov);

  // inject CSS minimal (aman, tidak perlu edit style.css)
  const css = document.createElement('style');
  css.textContent = `
    #busy-overlay{
      position:fixed; inset:0;
      display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45);
      z-index:99999;
    }
    #busy-overlay.hidden{ display:none !important; }
    #busy-overlay .busy-card{
      width:min(420px, 92vw);
      background:#fff;
      color:#111;
      border-radius:14px;
      padding:18px 18px 16px;
      text-align:center;
      box-shadow:0 12px 30px rgba(0,0,0,.25);
    }
    body.dark #busy-overlay .busy-card{
      background:#111827;
      color:#f9fafb;
      border:1px solid rgba(255,255,255,.08);
    }
    #busy-overlay .busy-text{
      margin-top:10px;
      font-weight:900;
      font-size:16px;
    }
    #busy-overlay .busy-spin{
      width:34px; height:34px;
      border-radius:999px;
      border:4px solid rgba(0,0,0,.15);
      border-top-color: rgba(0,0,0,.65);
      margin:0 auto;
      animation: busySpin .9s linear infinite;
    }
    body.dark #busy-overlay .busy-spin{
      border:4px solid rgba(255,255,255,.18);
      border-top-color: rgba(255,255,255,.75);
    }
    @keyframes busySpin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(css);

  return ov;
}

// GANTI fungsi busyOverlay lama Anda dengan versi ini:
function busyOverlay(on, text){
  const ov = ensureBusyOverlay_();
  const tx = document.getElementById('busy-text');

  if (on){
    if (tx) tx.textContent = text || 'Memproses…';
    ov.classList.remove('hidden');
    ov.setAttribute('aria-hidden', 'false');
  } else {
    ov.classList.add('hidden');
    ov.setAttribute('aria-hidden', 'true');
  }
}

const Busy = {
  async wrap(btn, fn, opts = {}){
    if (btn && btn.dataset.busy === '1') return; // anti spam click
    const label = opts.text || btn?.dataset?.loadingLabel || 'Memproses…';
    const useOverlay = !!opts.overlay;
    const overlayText = opts.overlayText || label || 'Memproses…';

    try{
      setBtnLoading(btn, true, label);
      if (useOverlay) busyOverlay(true, overlayText);
      return await fn();
    } finally {
      if (useOverlay) busyOverlay(false);
      setBtnLoading(btn, false);
    }
  }
};

// mutex sederhana
function runExclusive(key, fn){
  State._locks = State._locks || {};
  if (State._locks[key]) return Promise.resolve(null);
  State._locks[key] = true;
  return (async()=>{
    try { return await fn(); }
    finally { State._locks[key] = false; }
  })();
}
