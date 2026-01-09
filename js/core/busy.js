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

function busyOverlay(on, text){
  const ov = document.getElementById('busy-overlay');
  const tx = document.getElementById('busy-text');
  if (!ov) return;

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
