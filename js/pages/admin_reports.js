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
    const r = await api('adminReconcileList', { admin_token: State.adminToken });
    if (!r.ok) throw new Error(r.error || 'Gagal memuat rekonsil');

    const rows = Array.isArray(r.rows) ? r.rows : [];
    const tbody = document.querySelector('#reconcile-table tbody');
    const sum = document.getElementById('reconcile-summary');
    if (!tbody || !sum) return;

    const pending = rows.filter(x => String(x.status||'').toUpperCase() === 'PENDING').length;
    sum.textContent = `Total permohonan: ${rows.length} | Pending: ${pending}`;

    tbody.innerHTML = rows.map(x => {
      const statusReq = String(x.status || '');
      const canAct = statusReq.toUpperCase() === 'PENDING';
      const note = [x.request_note, x.admin_note].filter(Boolean).join(' | ');
      return `
        <tr>
          <td>${escapeHtml(x.requested_at || '')}</td>
          <td>${escapeHtml(x.nik || '')}</td>
          <td>${escapeHtml(x.nama || '')}</td>
          <td>${escapeHtml(x.mode || '')}</td>
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
  }catch(e){
    if (handleAdminAuthError_(e)) return;
    const sum = document.getElementById('reconcile-summary');
    if (sum) sum.textContent = String(e.message || e);
  }
}

async function adminApproveReconcile(requestId, adminNote=''){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminApproveReconcile', { admin_token: State.adminToken, request_id: requestId, admin_note: adminNote });
  if (!r.ok) throw new Error(r.error || 'Gagal menyetujui rekonsil');
  alert(r.message || 'Rekonsil disetujui.');
  await adminLoadReconcile();
}

async function adminRejectReconcile(requestId, adminNote=''){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminRejectReconcile', { admin_token: State.adminToken, request_id: requestId, admin_note: adminNote });
  if (!r.ok) throw new Error(r.error || 'Gagal menolak rekonsil');
  alert(r.message || 'Rekonsil ditolak.');
  await adminLoadReconcile();
}

async function adminDeleteFailedAttendance(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  if (!window.confirm('Hapus data attendance yang gagal / identitas kosong? Aksi ini tidak bisa dibatalkan.')) return;
  const r = await api('adminDeleteFailedAttendance', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal menghapus data gagal');
  alert(r.message || 'Pembersihan selesai.');
  await adminRekap().catch(()=>{});
  await adminLogs().catch(()=>{});
  await adminLoadReconcile().catch(()=>{});
}
