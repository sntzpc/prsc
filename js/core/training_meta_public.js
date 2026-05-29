// SECTION: Core Training Meta (Public)
// Purpose : Read-only training meta used by peserta UI and enroll/presensi mapping (cached locally).
// Depends : core/base.js, core/api.js (if sync from server).
// Provides: initDashboardMeta(), getTrainingMeta(), cache helpers.

/* =========================================================
   ✅ TRAINING META (Jenis Pelatihan & Kegiatan) - Public + Cache
   ========================================================= */
const TRAIN_META = {
  LS_KEY: 'training_meta_local_v1',
  data: { training_types: [], activities: [], savedAt: 0 }
};

function tmLoadFromLS(){
  try{
    const raw = localStorage.getItem(TRAIN_META.LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj) return;
    TRAIN_META.data = {
      training_types: Array.isArray(obj.training_types) ? obj.training_types : [],
      activities: Array.isArray(obj.activities) ? obj.activities : [],
      savedAt: Number(obj.savedAt || 0)
    };
  }catch(e){}
}

function tmSaveToLS(){
  try{
    localStorage.setItem(TRAIN_META.LS_KEY, JSON.stringify(TRAIN_META.data));
  }catch(e){}
}

function tmApplyToPesertaUI(){
  const ttEl = document.getElementById('training_type');
  const acEl = document.getElementById('activity');
  if (!ttEl || !acEl) return;

  const curTT = ttEl.value || State.lastTrainingType || '';
  const curAC = acEl.value || State.lastActivity || '';

  const tts = (TRAIN_META.data.training_types || []).slice();
  const acts = (TRAIN_META.data.activities || []).slice();

  fillSelect(ttEl, tts, 'Pilih…');
  fillSelect(acEl, acts, 'Pilih…');

  if (curTT && tts.includes(curTT)) ttEl.value = curTT;
  if (curAC && acts.includes(curAC)) acEl.value = curAC;

  // re-run rule materi
  try{ toggleMaterial(); }catch(e){}
  try{ updateScanBadge(); }catch(e){}
  try{ validateEnablePresensi(); }catch(e){}
}

async function tmLoadFromServer(force=false){
  // cache 24 jam (silakan ubah)
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const age = Date.now() - Number(TRAIN_META.data.savedAt || 0);

  if (!force && TRAIN_META.data.training_types.length && age < maxAgeMs){
    tmApplyToPesertaUI();
    return;
  }

  const r = await api('trainingMetaPublic', { t: Date.now() });
  if (!r.ok) throw new Error(r.error || 'Gagal load training meta');

  TRAIN_META.data.training_types = Array.isArray(r.training_types) ? r.training_types : [];
  TRAIN_META.data.activities = Array.isArray(r.activities) ? r.activities : [];
  TRAIN_META.data.savedAt = Date.now();

  tmSaveToLS();
  tmApplyToPesertaUI();
}

