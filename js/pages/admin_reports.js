// SECTION: Admin Page - Dashboard/Rekap/Logs
// Purpose : Admin reporting UI: dashboard defaults, filters, download/export, logs view.
// Depends : core/base.js, core/api.js, core/busy.js, core/status.js, core/admin_session.js.
// Provides: dashTodayDefaults(), adminLoadLogs(), adminExportXlsx/Pdf (if any).

/* =========================
   Admin: Rekap / Logs / Export
   ========================= */
function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

async function adminRekap(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const start = $('#r_start').value || todayISO();
    const end   = $('#r_end').value   || todayISO();

    const r = await api('adminSummary', { admin_token: State.adminToken, start, end });
    if (!r.ok) throw new Error(r.error || 'Gagal ambil rekap');

    $('#rekap-summary').textContent = `Range: ${r.range.start} s/d ${r.range.end} | Total: ${r.total}`;

    $('#rekap-status').innerHTML = Object.entries(r.byStatus||{})
      .map(([k,v])=>`• ${escapeHtml(k)}: <b>${v}</b>`).join('<br/>') || '-';

    $('#rekap-activity').innerHTML = Object.entries(r.byActivity||{})
      .map(([k,v])=>`• ${escapeHtml(k)}: <b>${v}</b>`).join('<br/>') || '-';
  } catch(e){
    if (handleAdminAuthError_(e)) return;
    $('#rekap-summary').textContent = String(e.message || e);
  }
}

async function adminLogs(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const start = $('#l_start').value || todayISO();
    const end   = $('#l_end').value   || todayISO();
    const limit = Number($('#l_limit').value || 200);

    const r = await api('adminLogs', { admin_token: State.adminToken, start, end, limit });
    if (!r.ok) throw new Error(r.error || 'Gagal ambil logs');

    const tbody = $('#logs-table tbody');
    tbody.innerHTML = r.rows.map(x => `
      <tr>
        <td>${escapeHtml(x.timestamp)}</td>
        <td>${escapeHtml(x.nik)}</td>
        <td>${escapeHtml(x.nama)}</td>
        <td>${escapeHtml(x.mode)}</td>
        <td>${escapeHtml(x.activity)}</td>
        <td>${escapeHtml(x.material)}</td>
        <td>${escapeHtml((x.gate_direction||'') + (x.gate_reason?(' - '+x.gate_reason):''))}</td>
        <td>${escapeHtml(x.status)}</td>
        <td>${escapeHtml(String(x.distance_m||''))}</td>
      </tr>
    `).join('');
    } catch(e){
    if (handleAdminAuthError_(e)) return;
    alert(String(e.message || e));
  }
}

async function adminExportCsv(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const start = $('#r_start').value || todayISO();
    const end   = $('#r_end').value   || todayISO();

    const r = await api('adminExportCsv', { admin_token: State.adminToken, start, end });
    if (!r.ok) throw new Error(r.error || 'Export gagal');

    const blob = new Blob([r.csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = r.filename || 'attendance.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    } catch(e){
    if (handleAdminAuthError_(e)) return;
    alert(String(e.message || e));
  }
}



async function adminLoadReconcile(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const filterEl = document.getElementById('reconcile-filter-status');
    const filterStatus = String(filterEl?.value || 'PENDING').toUpperCase();
    const r = await api('adminReconcileList', { admin_token: State.adminToken, status: filterStatus });
    if (!r.ok) throw new Error(r.error || 'Gagal memuat rekonsil');

    const rows = Array.isArray(r.rows) ? r.rows : [];
    const tbody = document.querySelector('#reconcile-table tbody');
    const sum = document.getElementById('reconcile-summary');
    if (!tbody || !sum) return;

    const filterLabel = filterStatus === 'ALL' ? 'Semua' : filterStatus;
    sum.textContent = `Menampilkan: ${filterLabel} | Total tampil: ${rows.length}`;

    tbody.innerHTML = rows.map(x => {
      const statusReq = String(x.status || '');
      const canAct = statusReq.toUpperCase() === 'PENDING';
      const note = [x.request_note, x.admin_note].filter(Boolean).join(' | ');
      const trainingType = String(x.training_type || '').trim();
      const activity = String(x.activity || '').trim();
      const gateReason = String(x.gate_reason || '').trim();
      const gateDirection = String(x.gate_direction || '').trim();
      return `
        <tr>
          <td>${escapeHtml(x.requested_at || '')}</td>
          <td>${escapeHtml(x.nik || '')}</td>
          <td>${escapeHtml(x.nama || '')}</td>
          <td>${escapeHtml(x.mode || '')}</td>
          <td>${escapeHtml(trainingType || '-')}</td>
          <td>${escapeHtml(activity || '-')}</td>
          <td>${escapeHtml(gateReason || '-')}</td>
          <td>${escapeHtml(gateDirection || '-')}</td>
          <td>${escapeHtml(x.last_status || '')}</td>
          <td><b>${escapeHtml(statusReq)}</b></td>
          <td>${escapeHtml(note || '-')}</td>
          <td>
            ${canAct ? `
              <button class="btn primary btn-recon-approve" data-id="${escapeHtml(x.request_id || '')}" type="button">Setujui</button>
              <button class="btn ghost btn-recon-reject" data-id="${escapeHtml(x.request_id || '')}" type="button">Tolak</button>
            ` : '<span class="small">Selesai</span>'}
          </td>
        </tr>
      `;
    }).join('');

    if (!rows.length){
      tbody.innerHTML = '<tr><td colspan="12" class="small muted">Tidak ada data rekonsil untuk filter ini.</td></tr>';
    }

    if (!tbody.dataset.bound){
      tbody.dataset.bound = '1';
      tbody.addEventListener('click', async (e)=>{
        const approveBtn = e.target.closest('.btn-recon-approve');
        const rejectBtn  = e.target.closest('.btn-recon-reject');
        if (!approveBtn && !rejectBtn) return;

        const requestId = (approveBtn || rejectBtn).dataset.id || '';
        const adminNote = window.prompt(approveBtn ? 'Catatan admin (opsional):' : 'Alasan penolakan (opsional):', '') ?? '';
        try{
          if (approveBtn){
            await adminApproveReconcile(requestId, adminNote);
          } else {
            await adminRejectReconcile(requestId, adminNote);
          }
        } catch(err){
          alert(String(err.message || err));
        }
      });
    }

    if (filterEl && !filterEl.dataset.bound){
      filterEl.dataset.bound = '1';
      filterEl.addEventListener('change', ()=>{
        adminLoadReconcile().catch(err => {
          const sum = document.getElementById('reconcile-summary');
          if (sum) sum.textContent = String(err.message || err);
        });
      });
    }
  }catch(e){
    if (handleAdminAuthError_(e)) return;
    const sum = document.getElementById('reconcile-summary');
    if (sum) sum.textContent = String(e.message || e);
  }
}

async function adminApproveReconcile(requestId, adminNote=''){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminApproveReconcile', { admin_token: State.adminToken, request_id: requestId, requestId, admin_note: adminNote, admin_user: 'admin' });
  if (!r.ok) throw new Error(r.error || 'Gagal menyetujui rekonsil');
  alert(r.message || 'Rekonsil disetujui.');
  await adminLoadReconcile();
}

async function adminRejectReconcile(requestId, adminNote=''){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminRejectReconcile', { admin_token: State.adminToken, request_id: requestId, requestId, admin_note: adminNote, admin_user: 'admin' });
  if (!r.ok) throw new Error(r.error || 'Gagal menolak rekonsil');
  alert(r.message || 'Rekonsil ditolak.');
  await adminLoadReconcile();
}

async function adminDeleteFailedAttendance(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  if (!window.confirm('Pindahkan data attendance yang gagal / identitas kosong ke sheet log_hapus lalu hapus dari attendance?')) return;
  const r = await api('adminDeleteFailedAttendance', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal menghapus data gagal');
  alert(r.message || 'Pembersihan selesai.');
  await adminRekap().catch(()=>{});
  await adminLogs().catch(()=>{});
  await adminLoadReconcile().catch(()=>{});
}

async function adminPreviewReconcileDuplicates(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminReconcileDuplicatesPreview', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal memeriksa rekonsil ganda');
  const el = document.getElementById('reconcile-dup-summary');
  const sample = Array.isArray(r.sample) ? r.sample : [];
  let msg = r.message || '';
  if (sample.length){
    const first = sample.slice(0,3).map(x => `${x.nik} | ${x.tanggal} | ${x.mode}${x.gate_direction ? ' ' + x.gate_direction : ''} | hapus ${x.duplicates_to_delete}`).join(' ; ');
    msg += ` Contoh: ${first}`;
  }
  if (el) el.textContent = msg;
  alert(msg);
  return r;
}

async function adminCleanupReconcileDuplicates(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const preview = await api('adminReconcileDuplicatesPreview', { admin_token: State.adminToken });
  if (!preview.ok) throw new Error(preview.error || 'Gagal memeriksa rekonsil ganda');
  const el = document.getElementById('reconcile-dup-summary');
  const previewMsg = preview.message || '';
  if (el) el.textContent = previewMsg;
  if (!preview.duplicate_rows){
    alert(previewMsg || 'Tidak ada data rekonsil ganda.');
    return;
  }
  const ok = window.confirm(`${previewMsg}

Lanjut hapus data rekonsil ganda sekarang?`);
  if (!ok) return;
  const r = await api('adminCleanupReconcileDuplicates', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal membersihkan rekonsil ganda');
  if (el) el.textContent = r.message || '';
  alert(r.message || 'Pembersihan rekonsil ganda selesai.');
  await adminLoadReconcile().catch(()=>{});
}
