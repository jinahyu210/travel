(() => {
  let exhibitions = [];
  let midnightTimer;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  function exhibitionRow(item, status) {
    const row = element('article', 'exhibition-row');
    const poster = element('div', 'exhibition-poster'); poster.setAttribute('aria-hidden', 'true');
    poster.append(element('span', '', 'Park Hyun Sook'), element('div', 'poster-art'), element('span', '', 'EXHIBITION'));
    const info = element('div', 'exhibition-info');
    info.append(element('p', 'exhibition-meta', item.venue), element('h3', '', item.title), element('p', 'exhibition-description', item.description), element('p', 'exhibition-period', `${item.start_date.replaceAll('-', '.')} — ${item.end_date.replaceAll('-', '.')}`), element('span', 'exhibition-status', {upcoming:'예정 전시', current:'전시 중', past:'지난 전시'}[status]));
    const date = element('div', 'exhibition-date');
    const [year, month, day] = item.start_date.split('-');
    date.append(element('span', '', `${year}.${month}`), element('strong', '', day));
    row.append(poster, info, date);
    return row;
  }
  function render(now = new Date()) {
    const current = document.getElementById('current-exhibitions');
    const past = document.getElementById('past-exhibitions');
    current.replaceChildren(); past.replaceChildren();
    [...exhibitions].sort((a,b) => b.start_date.localeCompare(a.start_date)).forEach(item => {
      const status = GalleryRules.exhibitionStatus(item, now);
      if (status) (status === 'past' ? past : current).append(exhibitionRow(item, status));
    });
    clearTimeout(midnightTimer);
    const nextMidnight = Date.parse(GalleryRules.seoulDate(now) + 'T00:00:00+09:00') + 86400000;
    midnightTimer = setTimeout(() => render(), Math.max(1, nextMidnight - now.getTime()));
  }
  async function load() {
    try {
      if (window.galleryStore) exhibitions = await window.galleryStore.listExhibitions();
      else {
        const response = await fetch('/api/exhibitions');
        if (!response.ok) throw new Error();
        exhibitions = await response.json();
      }
      render();
    } catch {
      document.getElementById('current-exhibitions').textContent = '전시 소식을 불러오지 못했습니다. 새로고침해 주세요.';
    }
  }
  const form = document.getElementById('exhibition-form');
  const dialog = document.getElementById('exhibition-dialog');
  document.getElementById('exhibition-add').addEventListener('click', () => {
    document.getElementById('exhibition-form-status').textContent = '';
    dialog.showModal();
  });
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { form.elements.exhibitionPassword.value = ''; });
  form.elements.start_date.addEventListener('input', () => { form.elements.end_date.min = form.elements.start_date.value; });
  form.addEventListener('reset', () => queueMicrotask(() => { form.elements.end_date.min = ''; }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    const status = document.getElementById('exhibition-form-status'); status.textContent = '';
    const item = {};
    ['title','venue','start_date','end_date','description'].forEach(key => item[key] = form.elements[key].value.trim());
    if (!item.title || !item.venue || !GalleryRules.exhibitionStatus(item)) { status.textContent = '전시명, 장소와 올바른 시작일·종료일을 입력해 주세요.'; return; }
    submit.disabled = true;
    try {
      if (window.galleryStore) await window.galleryStore.createExhibition(item);
      else {
        const response = await fetch('/api/exhibitions', {method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${form.elements.exhibitionPassword.value}`},body:JSON.stringify(item)});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '전시를 저장하지 못했습니다.');
      }
      form.reset(); await load(); dialog.close();
    } catch (error) { status.textContent = error.message || '전시를 저장하지 못했습니다.'; }
    finally { submit.disabled = false; }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('pageshow', () => render());
  window.Exhibitions = {render, load};
  load();
})();
