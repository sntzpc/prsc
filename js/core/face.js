// SECTION: Core Face Recognition
// Purpose : face-api.js model loading + detection pipeline + liveness/multi-shot helpers.
// Depends : face-api.js CDN, js/core/base.js (State, UI), js/core/busy.js (optional).
// Provides: loadModelsOnce(), detectBestFace(video|canvas), liveness checks, helpers.

/* =========================
   Face-api models
   ========================= */
async function loadModels(){
  // ✅ weights repo yang benar (ada manifest + shard)
  const base = 'https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js@0.22.2/weights';

  await faceapi.nets.tinyFaceDetector.loadFromUri(base);
  await faceapi.nets.faceLandmark68Net.loadFromUri(base);
  await faceapi.nets.faceRecognitionNet.loadFromUri(base);

  State.modelsReady = true;
}

async function detectOnce(videoEl){
  return faceapi
    .detectSingleFace( videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
}

/* =========================
   Video readiness helper
   - Mencegah error ketika videoWidth/videoHeight masih 0
   - Umum terjadi jika user klik tombol cepat setelah modal kamera dibuka
   ========================= */
async function ensureVideoReady_(videoEl, timeoutMs=3500){
  if (!videoEl) throw new Error('Video element tidak ditemukan');

  // coba play (autoplay kadang tertahan)
  try{ await videoEl.play?.(); }catch(e){}

  const t0 = performance.now();
  while ((performance.now() - t0) < timeoutMs){
    // HAVE_CURRENT_DATA=2
    if ((videoEl.readyState || 0) >= 2 && (videoEl.videoWidth || 0) > 0 && (videoEl.videoHeight || 0) > 0){
      return true;
    }
    await new Promise(r => requestAnimationFrame(()=>r()));
  }

  throw new Error('Kamera belum siap (video belum memuat frame). Tunggu 1–2 detik lalu coba lagi.');
}

function avgDescriptors(descs){
  const n = descs.length;
  const m = descs[0].length;
  const out = new Array(m).fill(0);
  for (const d of descs){
    for (let i=0;i<m;i++) out[i] += Number(d[i]);
  }
  for (let i=0;i<m;i++) out[i] /= n;
  return out;
}

/* =========================
   Multi-shot capture
   - enroll: 5 shot
   - verify: 3 shot
   ========================= */
async function captureMultiShotAvg(videoEl, shots=3, maxMs=2500){
  if (!State.modelsReady) await loadModels();

  // ✅ pastikan video sudah punya frame (hindari HAVE_NOTHING / videoWidth=0)
  await ensureVideoReady_(videoEl, Math.min(3500, Math.max(1200, maxMs)));

  const got = [];
  const t0 = performance.now();

  while (got.length < shots && (performance.now() - t0) < maxMs){
    let det = null;
    try{ det = await detectOnce(videoEl); }catch(e){ det = null; }
    if (det && det.descriptor){
      got.push(Array.from(det.descriptor));
      // tunggu 1-2 frame saja biar descriptor beda (lebih cepat dari sleep 220ms)
      await nextFrame(); 
      await nextFrame();
    } else {
      // kalau belum dapat wajah, cukup tunggu 1 frame
      await nextFrame();
    }
  }

  if (got.length < shots) return null;
  return avgDescriptors(got);
}

function nextFrame(){
  return new Promise(r => requestAnimationFrame(()=>r()));
}

/* =========================
   LIVENESS CHECK (simple)
   - challenge random: blink OR head turn
   ========================= */
function eyeEAR(eyePts){
  // eyePts: 6 points
  const dist = (p,q)=> Math.hypot(p.x-q.x, p.y-q.y);
  const A = dist(eyePts[1], eyePts[5]);
  const B = dist(eyePts[2], eyePts[4]);
  const C = dist(eyePts[0], eyePts[3]);
  return (A + B) / (2.0 * C);
}

function headTurnScore(landmarks){
  // deteksi turn sederhana via posisi nose relative ke midpoint eye
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();

  const midEyeX = (leftEye[0].x + rightEye[3].x) / 2;
  const eyeDist = Math.abs(rightEye[3].x - leftEye[0].x) || 1;
  const noseTip = nose[3] || nose[Math.floor(nose.length/2)];

  // positif = condong kanan, negatif = condong kiri
  return (noseTip.x - midEyeX) / eyeDist;
}

function getLivenessCfg(){
  const def = {
    enabled: true,
    mode: 'both',          // 'blink' | 'turn' | 'both'
    ear_low: 0.18,
    ear_high: 0.23,
    turn_thresh: 0.18,
    duration_ms: 3500
  };
  const L = (State.cfg && State.cfg.liveness) ? State.cfg.liveness : null;
  if (!L) return def;

  return {
    enabled: String(L.enabled ?? 'TRUE').toUpperCase() !== 'FALSE',
    mode: String(L.mode || 'both').toLowerCase(),
    ear_low: Number(L.ear_low ?? def.ear_low),
    ear_high: Number(L.ear_high ?? def.ear_high),
    turn_thresh: Number(L.turn_thresh ?? def.turn_thresh),
    duration_ms: Number(L.duration_ms ?? def.duration_ms)
  };
}

/* =========================
   DEVICE DETECTION CFG
   ========================= */
function getDeviceDetectCfg(){
  const def = { enabled: true };
  const D = (State.cfg && State.cfg.device_detect) ? State.cfg.device_detect : null;
  if (!D) return def;

  return {
    enabled: String(D.enabled ?? 'TRUE').toUpperCase() !== 'FALSE'
  };
}

async function runLiveness(videoEl, durationMs){
  if (!State.modelsReady) await loadModels();

  const cfg = getLivenessCfg();
  const dur = Number(durationMs || cfg.duration_ms || 3500);

  // jika dimatikan dari server
  if (!cfg.enabled){
    UI.setResult('Liveness dimatikan oleh admin. (Skip)', true);
    return { ok:true, type:'disabled', info:{ enabled:false } };
  }

  // tentukan challenge sesuai mode
  let challenge = 'blink';
  if (cfg.mode === 'blink') {
    challenge = 'blink';
  } else if (cfg.mode === 'turn') {
    challenge = (Math.random() < 0.5) ? 'turn_left' : 'turn_right';
  } else {
    // both
    challenge = (Math.random() < 0.5) ? 'blink' : ((Math.random() < 0.5) ? 'turn_left' : 'turn_right');
  }

  UI.setResult(
    `Liveness: ${
      challenge === 'blink' ? 'KEDIPKAN mata'
      : (challenge === 'turn_left' ? 'Putar kepala KIRI' : 'Putar kepala KANAN')
    }…`,
    true
  );

  const start = Date.now();
  let blinked = false;
  let earLowSeen = false;
  let turned = false;

  const EAR_LOW = cfg.ear_low;
  const EAR_HIGH = cfg.ear_high;
  const TURN_THRESH = cfg.turn_thresh;

  while (Date.now() - start < dur){
    const det = await detectOnce(videoEl);
    if (!det || !det.landmarks){
      await sleep(80);
      continue;
    }

    const lm = det.landmarks;

    // blink
    const leftEAR = eyeEAR(lm.getLeftEye());
    const rightEAR = eyeEAR(lm.getRightEye());
    const ear = (leftEAR + rightEAR)/2;

    if (ear < EAR_LOW) earLowSeen = true;
    if (earLowSeen && ear > EAR_HIGH) blinked = true;

    // turn
    const score = headTurnScore(lm);
    if (challenge === 'turn_left' && score < -TURN_THRESH) turned = true;
    if (challenge === 'turn_right' && score > TURN_THRESH) turned = true;

    if (challenge === 'blink' && blinked) {
      return { ok:true, type:'blink', info:{ ear, cfg } };
    }
    if (challenge !== 'blink' && turned) {
      return { ok:true, type:'turn', info:{ dir: challenge, score, cfg } };
    }

    await nextFrame();
  }

  return { ok:false, type:'timeout', info:{ challenge, cfg } };
}

