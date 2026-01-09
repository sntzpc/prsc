// SECTION: Admin Page - Materi (CRUD)
// Purpose : CRUD Materi content (list, add/edit/delete) in admin modal.
// Depends : core/base.js, core/api.js, core/admin_session.js, core/busy.js.
// Provides: adminLoadMateri(), adminSaveMateri(), materiBindEvents().

/* =========================
   Admin: MATERI CRUD
   ========================= */
function resetMateriForm(){
  $('#m_id').value = '';
  $('#m_name').value = '';
  $('#m_tags').value = '';
  $('#m_active').value = 'TRUE';
}

function renderMateriTable(items){
  const tbody = $('#materi-table tbody');
  tbody.innerHTML = (items || []).map(x => `
    <tr>
      <td>${escapeHtml(x.name)}</td>
      <td>${escapeHtml(x.tags || '')}</td>
      <td>${escapeHtml(String(x.active))}</td>
      <td>
        <button class="btn" data-act="edit" data-id="${escapeHtml(x.id)}">Edit</button>
        <button class="btn danger" data-act="del" data-id="${escapeHtml(x.id)}">Hapus</button>
      </td>
    </tr>
  `).join('');

  // bind actions
  tbody.querySelectorAll('button[data-act="edit"]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.dataset.id;
      const it = (items || []).find(z => z.id === id);
      if (!it) return;
      $('#m_id').value = it.id;
      $('#m_name').value = it.name;
      $('#m_tags').value = it.tags || '';
      $('#m_active').value = it.active ? 'TRUE' : 'FALSE';
      $('#materi-info').textContent = `Edit: ${it.id}`;
    });
  });

  tbody.querySelectorAll('button[data-act="del"]').forEach(b=>{
    b.addEventListener('click', async()=>{
      const id = b.dataset.id;
      if (!confirm('Hapus materi ini?')) return;
      await adminDeleteMateri(id);
    });
  });
}

async function adminLoadMateri(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

    const r = await api('adminMaterialsList', { admin_token: State.adminToken });
    if (!r.ok) throw new Error(r.error || 'Gagal load materi');

    State._materiItems = r.items || [];
    renderMateriTable(State._materiItems);
    $('#materi-info').textContent = `Loaded: ${State._materiItems.length} item`;

  } catch(e){
    if (handleAdminAuthError_(e)) return;

    const m = String(e.message || e);
    $('#materi-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

async function adminSaveMateri(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

    const id = ($('#m_id').value || '').trim();
    const name = ($('#m_name').value || '').trim();
    const tags = ($('#m_tags').value || '').trim();
    const active = ($('#m_active').value || 'TRUE') === 'TRUE';

    const r = await api('adminMaterialsUpsert', { admin_token: State.adminToken, id, name, tags, active });
    if (!r.ok) throw new Error(r.error || 'Gagal simpan materi');

    $('#materi-info').textContent = `✅ Tersimpan: ${r.id}`;
    resetMateriForm();
    await adminLoadMateri(); // refresh
  } catch(e){
    if (handleAdminAuthError_(e)) return;
    const m = String(e.message || e);
    $('#materi-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

async function adminDeleteMateri(id){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const r = await api('adminMaterialsDelete', { admin_token: State.adminToken, id });
    if (!r.ok) throw new Error(r.error || 'Gagal hapus');

    $('#materi-info').textContent = '✅ ' + (r.message || 'Terhapus');
    await adminLoadMateri();
  } catch(e){
    if (handleAdminAuthError_(e)) return;
    const m = String(e.message || e);
    $('#materi-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

