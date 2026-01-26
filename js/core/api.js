const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyB8tvXIAiAt6adyy3VoR8EE2YFwmBig5tuNPOKREP4HqVGKn_swzbR_vIY8wv-fD5X/exec';
const GAS_LS_KEY = 'presensi_gas_url';

function getApiUrl(){
  const u = localStorage.getItem(GAS_LS_KEY);
  return (u && /^https:\/\//i.test(u)) ? u : DEFAULT_GAS_URL;
}

async function api(action, payload={}){
  const form = new URLSearchParams();
  form.set('action', action);
  form.set('payload', JSON.stringify(payload || {}));

  const res = await fetch(getApiUrl(), {
    method: 'POST',
    body: form
    // ⛔ jangan set header Content-Type (biarkan browser set otomatis)
    // supaya tetap "simple request" dan tidak preflight
  });

  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch(e){ return { ok:false, error:'Non-JSON response', raw: txt.slice(0,500) }; }
}

window.api = api;
window.getApiUrl = getApiUrl;
