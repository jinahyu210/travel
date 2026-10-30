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
      const response = await fetch('/api/messages', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '메모를 전송하지 못했습니다. 다시 시도해 주세요.');
      form.reset(); status.textContent = '메모를 남겼습니다. 관리자만 확인할 수 있습니다.';
    } catch (error) { status.textContent = error.message || '메모를 전송하지 못했습니다. 작성한 내용은 유지됩니다.'; }
    finally { submit.disabled = false; }
  });
  const dialog = document.getElementById('inbox-dialog');
  const inbox = document.getElementById('inbox-form');
  const list = document.getElementById('inbox-messages');
  const inboxStatus = document.getElementById('inbox-status');
  function openInbox() {
    if (!GalleryAdmin.require(openInbox)) return;
    inboxStatus.textContent = ''; list.replaceChildren(); dialog.showModal();
  }
  document.getElementById('inbox-open').addEventListener('click', openInbox);
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { inbox.reset(); list.replaceChildren(); inboxStatus.textContent = ''; });
  inbox.addEventListener('submit', async event => {
    event.preventDefault(); inboxStatus.textContent = ''; list.replaceChildren();
    if (window.galleryStore) { inboxStatus.textContent = '관리자 메모함은 서버에서 이용할 수 있습니다.'; return; }
    const submit = inbox.querySelector('[type=submit]'); submit.disabled = true;
    try {
      const response = await fetch('/api/messages', {headers:{Authorization:`Bearer ${inbox.elements.inboxPassword.value}`}});
      const messages = await response.json();
      if (!response.ok) throw new Error(messages.error || '메모를 불러오지 못했습니다.');
      if (!GalleryAdmin.isAuthenticated() || !dialog.open) return;
      inboxStatus.textContent = messages.length ? '' : '아직 남겨진 메모가 없습니다.';
      messages.forEach(message => {
        const item = document.createElement('article'); item.className = 'inbox-item';
        const name = document.createElement('h3'); name.textContent = message.name || '익명';
        const reply = document.createElement('p'); reply.textContent = message.reply_to;
        const text = document.createElement('p'); text.className = 'inbox-text'; text.textContent = message.message;
        const time = document.createElement('time');
        time.textContent = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(message.created_at.replace(' ', 'T') + 'Z'));
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'delete-action'; remove.textContent = '메모 삭제';
        remove.addEventListener('click', async () => {
          if (!inbox.elements.inboxPassword.reportValidity()) return;
          if (!confirm('이 메모를 삭제할까요? 삭제한 메모는 복구할 수 없습니다.')) return;
          remove.disabled = true;
          try {
            await GalleryUpload.request('/api/messages/delete', {id: message.id}, inbox.elements.inboxPassword.value);
            item.remove();
            inboxStatus.textContent = list.children.length ? '' : '남겨진 메모가 없습니다.';
          } catch (error) { inboxStatus.textContent = error.message; }
          finally { inbox.elements.inboxPassword.value = ''; remove.disabled = false; }
        });
        item.append(name, reply, text, time, remove); list.append(item);
      });
    } catch (error) { inboxStatus.textContent = error.message || '메모를 불러오지 못했습니다.'; }
    finally { inbox.elements.inboxPassword.value = ''; submit.disabled = false; }
  });
})();
