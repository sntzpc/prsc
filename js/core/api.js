// SECTION: Core API
// Purpose : Thin wrapper for calling backend (Google Apps Script) using action/payload pattern.
// Depends : js/core/base.js (State, UI optional), fetch API.
// Provides: api(action, payload), GAS_URL/API_URL constants (if present).

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyB8tvXIAiAt6adyy3VoR8EE2YFwmBig5tuNPOKREP4HqVGKn_swzbR_vIY8wv-fD5X/exec';

async function api(action, payload={}){
  const form = new URLSearchParams();
  form.set('action', action);
  form.set('payload', JSON.stringify(payload || {}));

  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: form
    // ⛔ jangan set header Content-Type (biarkan browser set otomatis)
    // supaya tetap "simple request" dan tidak preflight
  });

  // kalau GAS balas bukan JSON, ini akan membantu debug
  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch(e){ return { ok:false, error:'Non-JSON response', raw: txt.slice(0,300) }; }
}

