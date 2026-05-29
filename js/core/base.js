// SECTION: Core Base
// Purpose : Shared primitives for the whole app (DOM helper $, global State, and UI helpers).
// Depends : Browser DOM APIs only.
// Provides: $, State, UI (setResult, setAdminResult, toast helpers if any).
// Notes   : Load this first before any other module that references State/UI/$.

const $ = (s, r=document) => r.querySelector(s);

const State = {
  cfg: null,
  loc: { lat:null, lng:null, accuracy_m:null, distance_m:null, inFence:false },
  locCheckedAt: 0,
  locError: '',
  lastTrainingType: localStorage.getItem('lastTrainingType') || '',
  lastActivity: localStorage.getItem('lastActivity') || '',
  gateDirection: null,
  modelsReady: false,
  deviceId: null,
  ui: {
    pcamOpen: false
  },

  adminToken: localStorage.getItem('admin_token') || '',
  adminExp: Number(localStorage.getItem('admin_exp') || 0),
  cam: {
    pesertaFacing: localStorage.getItem('cam_peserta') || 'user',   // 'user' | 'environment'
    adminFacing:   localStorage.getItem('cam_admin')   || 'user',
    streams: { peserta:null, admin:null }
  }
};

const UI = {
    _resultEl(){
    const inCam = !!State?.ui?.pcamOpen;

    // fallback kalau flag belum sempat ter-set
    if (!inCam){
      const pModal = document.getElementById('pcam-modal');
      const isVisible = pModal && !pModal.classList.contains('hidden') && pModal.getAttribute('aria-hidden') !== 'true';
      if (isVisible) return document.getElementById('result-cam');
    }

    return document.getElementById(inCam ? 'result-cam' : 'result-main');
  },

  setStatus(text){
    const el = this._resultEl();
    if (!el) return;
    el.innerHTML = `<div class="small">${text}</div>`;
  },

    setResult(msg, ok=true){
    const html =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'BERHASIL':'GAGAL'}</div><div class="small">${msg}</div>`;

    const main = document.getElementById('result-main');
    if (main) main.innerHTML = html;

    const cam  = document.getElementById('result-cam');
    if (cam && State?.ui?.pcamOpen) cam.innerHTML = html;
  },

  setAdminResult(msg, ok=true){
    const el = document.getElementById('admin-result');
    if (!el) return;
    el.innerHTML =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'OK':'ERROR'}</div><div class="small">${msg}</div>`;
  }
};

/* =========================================================
   ✅ CAMERA RESULT OVERLAY (BIG ✅/❌) + HOLD/LOCK STATUS
   - tampil di modal kamera peserta
   - BERHASIL: auto-close modal setelah jeda
   - GAGAL: tampil beberapa detik, lalu hilang (tetap di modal)
   ========================================================= */

State.ui = State.ui || {};
State.ui.outcomeLock = false;
State.ui.outcomeTimer = null;
State.ui.lastPresensiFailed = false;
State.ui.lastFailMessage = '';

function camOutcomeEnsureUI(){
  // ✅ overlay dibuat sebagai "portal" ke body agar tidak kalah z-index / stacking context video
  let ov = document.getElementById('cam-outcome');
  if (!ov){
    // inject style sekali
    if (!document.getElementById('cam-outcome-style')){
      const st = document.createElement('style');
      st.id = 'cam-outcome-style';
      st.textContent = `
        .cam-outcome{
          position: fixed;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 2147483647; /* super top */
          background: rgba(0,0,0,.45);
          backdrop-filter: blur(2px);
          pointer-events: auto;

          /* ✅ safe-area padding (iOS notch) */
          padding-top: env(safe-area-inset-top);
          padding-bottom: env(safe-area-inset-bottom);
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
        .cam-outcome.on{ display:flex; }

        .cam-outcome .box{
          width: min(520px, 92vw);
          border-radius: 22px;
          padding: 18px 18px 16px;
          text-align: center;
          color: #fff;
          box-shadow: 0 24px 80px rgba(0,0,0,.55);
          border: 1px solid rgba(255,255,255,.14);

          /* ✅ agar tidak kepotong di layar kecil / landscape */
          max-height: calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px);
          overflow: auto;
          -webkit-overflow-scrolling: touch;
        }

        /* ✅ ukuran adaptif (mobile -> desktop) */
        .cam-outcome .icon{
          font-size: clamp(78px, 18vw, 120px);
          line-height: 1;
          margin: 10px 0 10px;
          filter: drop-shadow(0 12px 28px rgba(0,0,0,.55));
        }
        .cam-outcome .title{
          font-weight: 1000;
          letter-spacing: .08em;
          font-size: clamp(22px, 6.5vw, 34px);
          margin: 0 0 8px;
        }
        .cam-outcome .desc{
          font-size: clamp(13px, 3.5vw, 14px);
          opacity: .92;
          line-height: 1.35;
        }

        .cam-outcome.ok .box{
          background:
            radial-gradient(circle at 30% 20%, rgba(34,197,94,.35), transparent 45%),
            radial-gradient(circle at 70% 15%, rgba(16,185,129,.25), transparent 40%),
            rgba(6,95,70,.78);
        }
        .cam-outcome.fail .box{
          background:
            radial-gradient(circle at 30% 20%, rgba(239,68,68,.38), transparent 45%),
            radial-gradient(circle at 70% 15%, rgba(244,63,94,.25), transparent 40%),
            rgba(127,29,29,.78);
        }

        /* ✅ ekstra kecil: rapikan padding */
        @media (max-width: 420px){
          .cam-outcome .box{
            width: min(520px, 94vw);
            padding: 14px 14px 12px;
            border-radius: 18px;
          }
          .cam-outcome .title{
            letter-spacing: .06em;
          }
        }

        /* ✅ landscape pendek: kecilkan margin supaya muat */
        @media (orientation: landscape) and (max-height: 420px){
          .cam-outcome .icon{ margin: 6px 0 6px; }
          .cam-outcome .title{ margin-bottom: 6px; }
        }
      `;
      document.head.appendChild(st);
    }

    ov = document.createElement('div');
    ov.id = 'cam-outcome';
    ov.className = 'cam-outcome';
    ov.innerHTML = `
      <div class="box" role="status" aria-live="polite">
        <div class="icon" id="cam-outcome-icon">✅</div>
        <div class="title" id="cam-outcome-title">BERHASIL</div>
        <div class="desc"  id="cam-outcome-desc"></div>
      </div>
    `;
    document.body.appendChild(ov);

    // klik overlay untuk menutup overlay (opsional)
    ov.addEventListener('click', ()=>{
      camOutcomeHide();
    });
  }

  return ov;
}

function camOutcomeShow(ok, descHtml, opts = {}){
  const ov = camOutcomeEnsureUI();
  if (!ov) return;

  // kunci smart status & hasil
  State.ui.outcomeLock = true;
  statusSetLock(true); // ✅ cegah smartStatus menimpa hasil

  // cancel timer lama
  if (State.ui.outcomeTimer) clearTimeout(State.ui.outcomeTimer);
  State.ui.outcomeTimer = null;

  ov.classList.remove('ok','fail');
  ov.classList.add(ok ? 'ok' : 'fail');
  ov.classList.add('on');

  const icon = document.getElementById('cam-outcome-icon');
  const title= document.getElementById('cam-outcome-title');
  const desc = document.getElementById('cam-outcome-desc');

  if (icon)  icon.textContent  = ok ? '✅' : '❌';
  if (title) title.textContent = ok ? 'BERHASIL' : 'GAGAL';
  if (desc)  desc.innerHTML    = String(descHtml || '');

  // auto behavior
  const closeOnOk = (opts.closeOnOk !== false);   // default true
  const delayOkMs = Number(opts.delayOkMs ?? 1600);
  const delayFailMs = Number(opts.delayFailMs ?? 2200);

  State.ui.outcomeTimer = setTimeout(()=>{
    if (ok && closeOnOk){
      // auto close modal
      try{ closePesertaCameraModal(); }catch(e){}
    }
    camOutcomeHide(); // kalau ok: setelah close, overlay hilang; kalau fail: hilang saja
  }, ok ? delayOkMs : delayFailMs);
}

function camOutcomeHide(){
  const ov = document.getElementById('cam-outcome');
  if (ov) ov.classList.remove('on');

  if (State.ui.outcomeTimer) clearTimeout(State.ui.outcomeTimer);
  State.ui.outcomeTimer = null;

  // buka lock kembali (biar smart status bisa update lagi)
  State.ui.outcomeLock = false;
  statusSetLock(false);
}


// ✅ Ganti dengan URL Deploy Web App Anda (exec)
