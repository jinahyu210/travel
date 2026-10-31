(() => {
  const form = document.getElementById('contact-form');
  const status = document.getElementById('contact-status');
  form.addEventListener('submit', async event => {
    event.preventDefault(); status.textContent = '';
    if (window.galleryStore) {
      status.textContent = '이 미리보기에서는 관리자에게 전송되지 않습니다. 실제 메모 접수는 서버에서 이용할 수 있습니다.';
      return;
    }
    const message = {};
    ['name','reply_to','message'].forEach(key => message[key] = form.elements[key].value.trim());
    if (!message.message) { status.textContent = '메모 내용을 입력해 주세요.'; return; }
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try {
      await GalleryUpload.request('/api/messages', message, '');
      form.reset(); status.textContent = '메모를 남겼습니다. 관리자만 확인할 수 있습니다.';
      if (GalleryAdmin.isAuthenticated()) loadMessages();
    } catch (error) { status.textContent = error.message || '메모를 전송하지 못했습니다. 작성한 내용은 유지됩니다.'; }
    finally { submit.disabled = false; }
  });

  const list = document.getElementById('inbox-messages');
  const inboxStatus = document.getElementById('inbox-status');
  const count = document.getElementById('inbox-count');
  const refresh = document.getElementById('inbox-refresh');
  const dialog = document.getElementById('message-delete-dialog');
  const deleteForm = document.getElementById('message-delete-form');
  const deleteStatus = document.getElementById('message-delete-status');
  let adminView = false, requestVersion = 0, controller, selected;

  function clearInbox() {
    ++requestVersion;
    controller?.abort();
    list.replaceChildren();
    count.textContent = inboxStatus.textContent = '';
    selected = null;
    refresh.disabled = false;
    deleteForm.reset();
    document.getElementById('delete-message-preview').textContent = '';
    deleteStatus.textContent = '';
    if (dialog.open) dialog.close();
  }

  function renderMessage(message) {
    const item = document.createElement('article'); item.className = 'inbox-item';
    const heading = document.createElement('div'); heading.className = 'inbox-item-head';
    const name = document.createElement('h3'); name.textContent = message.name || '익명';
    const time = document.createElement('time');
    const value = /(?:Z|[+-]\d{2}:?\d{2})$/.test(message.created_at) ? message.created_at : message.created_at.replace(' ', 'T') + 'Z';
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(date);
    }
    heading.append(name, time); item.append(heading);
    if (message.reply_to) {
      const reply = document.createElement('p'); reply.className = 'inbox-reply';
      reply.textContent = '답변받을 연락처: ' + message.reply_to;
      item.append(reply);
    }
    const text = document.createElement('p'); text.className = 'inbox-text'; text.textContent = message.message;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'delete-action'; remove.textContent = '메모 삭제';
    remove.addEventListener('click', () => {
      if (!GalleryAdmin.isAuthenticated()) return;
      selected = {message, item};
      deleteForm.reset(); deleteStatus.textContent = '';
      document.getElementById('delete-message-preview').textContent = message.message.slice(0, 160);
      dialog.showModal(); deleteForm.elements.deletePassword.focus();
    });
    item.append(text, remove);
    return item;
  }

  async function loadMessages() {
    if (!GalleryAdmin.isAuthenticated()) return;
    if (window.galleryStore) { inboxStatus.textContent = '관리자 메모함은 운영 사이트에서 이용할 수 있습니다.'; return; }
    controller?.abort(); controller = new AbortController();
    const request = ++requestVersion;
    refresh.disabled = true;
    inboxStatus.textContent = '메모를 불러오는 중입니다.';
    try {
      const response = await fetch('/api/messages', {credentials:'same-origin',cache:'no-store',signal:controller.signal});
      const messages = await response.json();
      if (request !== requestVersion || !GalleryAdmin.isAuthenticated()) return;
      if (!response.ok) {
        list.replaceChildren(); count.textContent = '';
        throw new Error(response.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : (messages.error || '메모를 불러오지 못했습니다.'));
      }
      list.replaceChildren(...messages.map(renderMessage));
      count.textContent = `${messages.length}개`;
      inboxStatus.textContent = messages.length ? '' : '아직 남겨진 메모가 없습니다.';
    } catch (error) {
      if (request === requestVersion && GalleryAdmin.isAuthenticated() && error.name !== 'AbortError') inboxStatus.textContent = error.message || '메모를 불러오지 못했습니다.';
    } finally { if (request === requestVersion) refresh.disabled = false; }
  }

  function syncView() {
    if (!GalleryAdmin.isAuthenticated()) { adminView = false; clearInbox(); return; }
    if (!adminView) { adminView = true; loadMessages(); }
  }
  refresh.addEventListener('click', loadMessages);
  document.addEventListener('gallery:admin-session', syncView);
  GalleryAdmin.ready.then(syncView);
  window.addEventListener('pagehide', () => { adminView = false; clearInbox(); });

  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    selected = null; deleteForm.reset(); deleteStatus.textContent = '';
    document.getElementById('delete-message-preview').textContent = '';
  });
  deleteForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selected || !GalleryAdmin.isAuthenticated()) return;
    const target = selected, submit = deleteForm.querySelector('[type=submit]');
    submit.disabled = true; deleteStatus.textContent = '';
    try {
      await GalleryUpload.request('/api/messages/delete', {id: target.message.id}, deleteForm.elements.deletePassword.value);
      if (!GalleryAdmin.isAuthenticated()) return;
      target.item.remove();
      count.textContent = `${list.children.length}개`;
      dialog.close();
      await loadMessages();
    } catch (error) { if (GalleryAdmin.isAuthenticated()) deleteStatus.textContent = error.message || '메모를 삭제하지 못했습니다.'; }
    finally { deleteForm.elements.deletePassword.value = ''; submit.disabled = false; }
  });
})();
