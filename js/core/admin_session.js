// SECTION: Core Admin Session
// Purpose : Admin auth/session handling in localStorage (token+exp) + guards for admin actions.
// Depends : core/base.js (State, UI).
// Provides: isAdminSessionValid(), adminLogin(), adminLogout(), requireAdmin().

/* =========================
   Admin: Login/Session
   ========================= */
function isAdminSessionValid(){
  return !!State.adminToken && Date.now() < State.adminExp;
}

function forceAdminRelogin(msg){
  State.adminToken = '';
  State.adminExp = 0;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_exp');

  UI.setAdminResult(msg || 'Sesi admin tidak valid. Silakan login ulang.', false);

  // balikkan UI ke pane login jika modal sedang terbuka
  try{
    const paneAdmin = $('#admin-pane');
    const paneLogin = $('#admin-login-pane');
    if (paneAdmin) paneAdmin.classList.add('hidden');
    if (paneLogin) paneLogin.classList.remove('hidden');

    const btnLogout = $('#btn-admin-logout');
    if (btnLogout) btnLogout.disabled = true;

    const ses = $('#admin-session');
    if (ses) ses.textContent = '';
  } catch(e){}
}

function handleAdminAuthError_(err){
  const m = String(err?.message || err || '');
  if (/Token admin tidak valid|Sesi admin habis|Admin token missing|Admin belum login/i.test(m)){
    forceAdminRelogin(m);
    return true;
  }
  return false;
}

async function adminLogin(){
  const pin = ($('#admin-pin').value || '').trim();
  if (!pin){ $('#admin-session').textContent = 'PIN wajib diisi'; return; }

  const r = await api('adminLogin', { pin });
  if (!r.ok){
    $('#admin-session').textContent = r.error || 'Login gagal';
    return;
  }

  State.adminToken = r.token;
  State.adminExp = Number(r.exp || 0);

  localStorage.setItem('admin_token', State.adminToken);
  localStorage.setItem('admin_exp', String(State.adminExp));

  $('#admin-session').textContent = `Login OK. Exp: ${new Date(State.adminExp).toLocaleString()}`;
  $('#btn-admin-logout').disabled = false;

  $('#admin-login-pane').classList.add('hidden');
  $('#admin-pane').classList.remove('hidden');
}

function adminLogout(){
  State.adminToken = '';
  State.adminExp = 0;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_exp');
  $('#admin-session').textContent = 'Silahkan masukkan PIN dan klik Login';
  $('#btn-admin-logout').disabled = true;

  $('#admin-pane').classList.add('hidden');
  $('#admin-login-pane').classList.remove('hidden');
}

