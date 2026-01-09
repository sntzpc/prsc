// SECTION: Admin Page - Training Master (CRUD)
// Purpose : CRUD Training (jenis pelatihan, activity, rules) in admin modal.
// Depends : core/base.js, core/api.js, core/admin_session.js, core/busy.js.
// Provides: adminLoadTraining(), adminSaveTraining(), trainingBindEvents().

/* =========================================================
   ✅ ADMIN: TRAINING META CRUD
   ========================================================= */

function tmResetForm(){
  $('#tm_id').value = '';
  $('#tm_kind').value = 'training_type';
  $('#tm_name').value = '';
  $('#tm_active').value = 'TRUE';
  $('#tm_sort').value = '0';
}

function tmRowBtnHtml(id){
  return `
    <button class="btn" data-tm-edit="${escapeHtml(id)}" type="button">Edit</button>
    <button class="btn danger" data-tm-del="${escapeHtml(id)}" type="button">Hapus</button>
  `;
}

function tmRenderTables(items){
  const tbType = document.querySelector('#tm_tbl_type tbody');
  const tbAct  = document.querySelector('#tm_tbl_act tbody');
  if (!tbType || !tbAct) return;

  const byKind = (k)=> (items||[]).filter(x=>String(x.kind)===k);

  const render = (arr)=> arr.map(x=>`
    <tr>
      <td>${escapeHtml(x.name)}</td>
      <td>${escapeHtml(String(x.sort ?? 0))}</td>
      <td>${x.active ? 'TRUE' : 'FALSE'}</td>
      <td>${tmRowBtnHtml(x.id)}</td>
    </tr>
  `).join('');

  tbType.innerHTML = render(byKind('training_type'));
  tbAct.innerHTML  = render(byKind('activity'));

  // bind edit/delete
  document.querySelectorAll('[data-tm-edit]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.getAttribute('data-tm-edit');
      const it = (items||[]).find(z=>String(z.id)===String(id));
      if (!it) return;
      $('#tm_id').value = it.id;
      $('#tm_kind').value = it.kind;
      $('#tm_name').value = it.name;
      $('#tm_active').value = it.active ? 'TRUE' : 'FALSE';
      $('#tm_sort').value = String(it.sort ?? 0);
      $('#tm_info').textContent = `Edit: ${it.id}`;
    });
  });

  document.querySelectorAll('[data-tm-del]').forEach(b=>{
    b.addEventListener('click', async()=>{
      const id = b.getAttribute('data-tm-del');
      if (!confirm('Hapus item ini?')) return;
      await adminTrainingMetaDelete(id);
    });
  });
}

async function adminTrainingMetaList(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminTrainingMetaList', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal load training meta');

  State._trainingMetaItems = r.items || [];
  tmRenderTables(State._trainingMetaItems);
  $('#tm_info').textContent = `Loaded: ${(State._trainingMetaItems||[]).length} item`;

  // ✅ refresh peserta dropdown juga (public cache)
  try{ await tmLoadFromServer(true); }catch(e){}
}

async function adminTrainingMetaSave(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const id = ($('#tm_id').value || '').trim();
  const kind = ($('#tm_kind').value || 'training_type').trim();
  const name = ($('#tm_name').value || '').trim();
  const active = ($('#tm_active').value || 'TRUE') === 'TRUE';
  const sort = Number($('#tm_sort').value || 0);

  if (!name) throw new Error('Nama wajib diisi.');
  if (!['training_type','activity'].includes(kind)) throw new Error('Kind tidak valid.');

  const r = await api('adminTrainingMetaUpsert', {
    admin_token: State.adminToken,
    id, kind, name, active, sort
  });
  if (!r.ok) throw new Error(r.error || 'Gagal simpan');

  $('#tm_info').textContent = `✅ Tersimpan: ${r.id}`;
  tmResetForm();
  await adminTrainingMetaList();
}

async function adminTrainingMetaDelete(id){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminTrainingMetaDelete', { admin_token: State.adminToken, id });
  if (!r.ok) throw new Error(r.error || 'Gagal hapus');
  $('#tm_info').textContent = '✅ ' + (r.message || 'Terhapus');
  await adminTrainingMetaList();
}

