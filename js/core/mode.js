// SECTION: Core Mode & Training Selector
// Purpose : Handle mode switching (peserta/admin), training type/activity selection, and UI toggles.
// Depends : js/core/base.js ($, State).
// Provides: initMode(), initTraining(), setTrainingType(), setActivity().

/* =========================
   UI mode & validation
   ========================= */
function toggleMaterial(){
  const act = ($('#activity').value || '').toLowerCase();
  const need = (act === 'sesi kelas' || act === 'field day');
  $('#material-wrap').style.display = need ? 'block' : 'none';
  if (!need){ $('#material').value=''; $('#suggest').innerHTML=''; }
}

function togglePesertaCameraBox(){
  const mode = ($('#mode')?.value || 'training');
  const box = $('#pcam-box');
  if (!box) return;

  // ✅ Gate: sembunyikan box kamera "Buka Kamera"
  // ✅ Training: tampilkan kembali
  box.style.display = (mode === 'gate') ? 'none' : '';
}

function validateEnablePresensi(){
  const mode = $('#mode').value;
  const readyLoc = isFinite(State.loc.distance_m) && State.loc.inFence;
  let ok = readyLoc;

  if (mode === 'training'){
    const tt = ($('#training_type').value || '').trim();
    const act = ($('#activity').value || '').trim();
    if (!tt || !act) ok = false;

    const needMaterial = (act.toLowerCase() === 'sesi kelas' || act.toLowerCase() === 'field day');
    if (needMaterial && !($('#material').value || '').trim()) ok = false;

  } else {
    const reason = ($('#gate_reason').value || '').trim();
    if (!reason) ok = false;
  }

  $('#btn-presensi').disabled = !ok;
  return ok; // ✅ penting: supaya bisa dipakai untuk pesan status
}

