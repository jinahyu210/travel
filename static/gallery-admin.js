(() => {
  let authenticated = false, expiryTimer, pendingAction, revision = 0, busy = false;
  const toggles = [...document.querySelectorAll('[data-admin-toggle]')];
  let channel;
  try { channel = new BroadcastChannel('gallery-admin'); } catch {}

  function setSession(session) {
    authenticated = session.authenticated === true;
    document.documentElement.dataset.admin = String(authenticated);
    toggles.forEach(button => {
      button.textContent = authenticated ? '관리자 로그아웃' : '관리자 로그인';
      button.setAttribute('aria-label', button.textContent);
    });
    clearTimeout(expiryTimer);
    if (authenticated && session.expiresAt) {
      expiryTimer = setTimeout(() => setSession({authenticated: false}), Math.max(0, session.expiresAt - Date.now()));
    }
    if (!authenticated) {
      document.querySelectorAll('dialog[data-admin-dialog]').forEach(dialog => {
        dialog.querySelectorAll('[type=password]').forEach(input => { input.value = ''; });
        if (dialog.open) dialog.close();
      });
    }
    document.dispatchEvent(new CustomEvent('gallery:admin-session', {detail: {authenticated}}));
  }

  async function refresh() {
    if (busy) return;
    const request = ++revision;
    try {
      const response = await fetch('/api/admin/session', {cache: 'no-store', credentials: 'same-origin'});
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (request === revision) setSession(result);
    } catch { if (request === revision) setSession({authenticated: false}); }
  }

  // Exported offline previews have no server account; preserve their local editor.
  if (window.galleryStore) {
    setSession({authenticated: true});
    toggles.forEach(button => { button.hidden = true; });
    window.GalleryAdmin = {ready: Promise.resolve(), require: () => true, isAuthenticated: () => true};
    return;
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'admin-login-dialog';
  dialog.setAttribute('aria-labelledby', 'admin-login-title');
  dialog.innerHTML = `<form id="admin-login-form">
    <div class="dialog-head"><h2 id="admin-login-title">관리자 로그인</h2><button type="button" class="close" aria-label="닫기">×</button></div>
    <p class="muted">로그인하면 등록·편집 버튼이 표시됩니다.<br>저장·삭제할 때는 비밀번호를 다시 확인합니다.</p>
    <label>관리자 비밀번호<input name="adminPassword" type="password" autocomplete="current-password" required></label>
    <p id="admin-login-status" role="status"></p><button type="submit" class="primary">로그인</button>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), status = dialog.querySelector('[role=status]');
  function openLogin(action) {
    pendingAction = action;
    status.textContent = '';
    if (!dialog.open) dialog.showModal();
    form.elements.adminPassword.focus();
  }
  function requireLogin(action) {
    if (authenticated) return true;
    openLogin(action);
    return false;
  }
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { form.reset(); pendingAction = null; });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    const request = ++revision;
    busy = true;
    submit.disabled = true;
    status.textContent = '';
    try {
      const result = await GalleryUpload.request('/api/admin/login', {}, form.elements.adminPassword.value);
      if (request !== revision) return;
      setSession(result);
      const action = pendingAction;
      pendingAction = null;
      dialog.close();
      channel?.postMessage('login');
      action?.();
    } catch (error) { status.textContent = error.message || '로그인하지 못했습니다. 다시 시도해 주세요.'; }
    finally { form.elements.adminPassword.value = ''; submit.disabled = false; busy = false; }
  });
  toggles.forEach(button => button.addEventListener('click', async () => {
    if (!authenticated) { openLogin(); return; }
    button.disabled = true;
    busy = true;
    ++revision;
    try {
      await GalleryUpload.request('/api/admin/logout', {}, '');
      setSession({authenticated: false});
      channel?.postMessage('logout');
    } catch {
      openLogin();
      status.textContent = '로그아웃하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.';
    } finally { button.disabled = false; busy = false; }
  }));
  if (channel) channel.onmessage = event => {
    if (event.data === 'logout') { ++revision; setSession({authenticated: false}); }
    else if (event.data === 'login') refresh();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  window.GalleryAdmin = {ready: refresh(), require: requireLogin, isAuthenticated: () => authenticated};
})();
