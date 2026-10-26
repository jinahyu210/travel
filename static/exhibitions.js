(() => {
  let exhibitions = [];
  let midnightTimer;
  let editingExhibition = null;
  let shownExhibition = null;

  const statusLabels = {
    upcoming: '예정 전시',
    current: '전시 중',
    past: '지난 전시'
  };

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function cleanSummary(description) {
    return (typeof description === 'string' ? description : '').replace(/\s+/g, ' ').trim();
  }

  function dottedDate(value) {
    return value.replaceAll('-', '.');
  }

  function displayPeriod(item) {
    return `${dottedDate(item.start_date)} — ${dottedDate(item.end_date)}`;
  }

  function archiveDate(item) {
    const date = element('time', 'archive-date');
    date.dateTime = item.start_date;
    const [year, month, day] = item.start_date.split('-');
    date.append(
      element('strong', '', `${month}.${day}`),
      element('span', '', year.slice(-2))
    );
    return date;
  }

  function openDetail(item, status) {
    shownExhibition = item;
    const dialog = document.getElementById('exhibition-detail');
    const image = document.getElementById('exhibition-detail-image');
    const placeholder = document.getElementById('exhibition-detail-placeholder');
    image.hidden = !item.image;
    placeholder.hidden = Boolean(item.image);
    if (item.image) {
      image.src = item.image;
      image.alt = `${item.title} 전시 대표 이미지`;
    } else {
      image.removeAttribute('src');
      image.alt = '';
    }
    document.getElementById('exhibition-detail-title').textContent = item.title;
    const statusLabel = document.getElementById('exhibition-detail-status');
    statusLabel.className = `exhibition-detail-status exhibition-detail-status-${status}`;
    statusLabel.textContent = statusLabels[status];
    document.getElementById('exhibition-detail-venue').textContent = item.venue;
    document.getElementById('exhibition-detail-period').textContent = displayPeriod(item);
    const description = document.getElementById('exhibition-detail-description');
    description.textContent = item.description || '';
    description.hidden = !item.description;
    document.getElementById('edit-exhibition').hidden = !item.id;
    dialog.showModal();
  }

  function exhibitionRow(item, status, priority = false) {
    const row = element('article', 'archive-item');
    const link = element('a', 'archive-row');
    link.href = `#exhibition-${item.id || item.start_date}`;
    link.setAttribute('aria-haspopup', 'dialog');
    link.setAttribute('aria-label', `${item.title}, ${item.venue}, ${displayPeriod(item)}`);

    const thumb = element('figure', 'archive-thumb');
    if (item.image) {
      const image = element('img');
      image.alt = '';
      GalleryImages.setSource(image, item.image, {priority});
      thumb.append(image);
    } else {
      thumb.classList.add('archive-thumb-empty');
      thumb.append(element('span', '', '전시'));
    }

    const main = element('div', 'archive-main');
    main.append(
      element('h4', '', item.title),
      element('p', 'archive-venue', item.venue),
      element('span', `archive-status archive-status-${status}`, statusLabels[status])
    );
    const summary = element('p', 'archive-summary', cleanSummary(item.description));
    if (!summary.textContent) summary.classList.add('archive-summary-empty');
    const arrow = element('span', 'archive-arrow', '↗');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(thumb, archiveDate(item), main, summary, arrow);
    link.addEventListener('click', event => {
      event.preventDefault();
      openDetail(item, status);
    });
    row.append(link);
    return row;
  }

  function openRegistration(item = null) {
    form.reset();
    editingExhibition = item;
    document.getElementById('exhibition-form-status').textContent = '';
    document.getElementById('exhibition-form-title').textContent = item ? '전시 편집' : '전시 등록';
    document.getElementById('exhibition-submit').textContent = item ? '수정 저장하기' : '전시 저장하기';
    document.getElementById('exhibition-image-label').textContent = item ? '대표 이미지 교체 (선택)' : '대표 이미지 (선택)';
    const currentImage = document.getElementById('exhibition-current-image');
    currentImage.hidden = !item?.image;
    if (item?.image) currentImage.src = item.image;
    else currentImage.removeAttribute('src');
    if (item) {
      ['title', 'venue', 'start_date', 'end_date', 'description'].forEach(key => {
        form.elements[key].value = item[key] || '';
      });
      form.elements.end_date.min = item.start_date;
    }
    dialog.showModal();
  }

  function yearGroup(year, items, label, allowRegistration = false) {
    const section = element('section', 'archive-year');
    const heading = element('header', 'archive-year-head');
    const titleId = `archive-${label === '지난 전시' ? 'past' : 'current'}-${year}`;
    const title = element('h3', '', year);
    const labelGroup = element('div', 'archive-year-label');
    title.id = titleId;
    labelGroup.append(element('p', '', label));
    if (allowRegistration) {
      const add = element('button', 'quiet', '전시 등록 ↗');
      add.id = 'exhibition-add';
      add.type = 'button';
      add.addEventListener('click', () => openRegistration());
      labelGroup.append(add);
    }
    heading.append(labelGroup, title);
    const list = element('div', 'archive-list');
    list.append(...items.map(({item, status}, index) => exhibitionRow(item, status, allowRegistration && index === 0)));
    section.setAttribute('aria-labelledby', titleId);
    section.append(heading, list);
    return section;
  }

  function groupedByYear(items) {
    return items.reduce((groups, entry) => {
      const year = entry.item.start_date.slice(0, 4);
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(entry);
      return groups;
    }, new Map());
  }

  function render(now = new Date()) {
    const currentRoot = document.getElementById('current-exhibitions');
    const pastRoot = document.getElementById('past-exhibitions');
    const classified = exhibitions
      .map(item => ({item, status: GalleryRules.exhibitionStatus(item, now)}))
      .filter(entry => entry.status);
    const current = classified
      .filter(entry => entry.status !== 'past')
      .sort((a, b) => {
        const rank = {current: 0, upcoming: 1};
        return rank[a.status] - rank[b.status] || a.item.start_date.localeCompare(b.item.start_date);
      });
    const past = classified
      .filter(entry => entry.status === 'past')
      .sort((a, b) => b.item.start_date.localeCompare(a.item.start_date));

    currentRoot.replaceChildren();
    pastRoot.replaceChildren();
    if (current.length) {
      let allowRegistration = true;
      for (const [year, items] of groupedByYear(current)) {
        currentRoot.append(yearGroup(year, items, '진행 중 · 예정 전시', allowRegistration));
        allowRegistration = false;
      }
    } else {
      const year = GalleryRules.seoulDate(now).slice(0, 4);
      const group = yearGroup(year, [], '진행 중 · 예정 전시', true);
      group.querySelector('.archive-list').append(element('p', 'archive-empty', '현재 등록된 전시 소식이 없습니다.'));
      currentRoot.append(group);
    }
    if (past.length) {
      for (const [year, items] of groupedByYear(past)) {
        pastRoot.append(yearGroup(year, items, '지난 전시'));
      }
    } else {
      pastRoot.append(element('p', 'archive-empty archive-empty-past', '지난 전시 기록이 아직 없습니다.'));
    }

    clearTimeout(midnightTimer);
    const nextMidnight = Date.parse(`${GalleryRules.seoulDate(now)}T00:00:00+09:00`) + 86_400_000;
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

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다. 다시 선택해 주세요.'));
      reader.readAsDataURL(file);
    });
  }

  const form = document.getElementById('exhibition-form');
  const dialog = document.getElementById('exhibition-dialog');
  const detail = document.getElementById('exhibition-detail');
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  detail.querySelector('.close').addEventListener('click', () => detail.close());
  [dialog, detail].forEach(modal => modal.addEventListener('click', event => {
    if (event.target === modal) modal.close();
  }));
  dialog.addEventListener('close', () => {
    form.elements.exhibitionPassword.value = '';
    editingExhibition = null;
  });
  detail.addEventListener('close', () => { shownExhibition = null; });
  document.getElementById('edit-exhibition').addEventListener('click', () => {
    const item = shownExhibition;
    if (!item) return;
    detail.close();
    openRegistration(item);
  });
  form.elements.start_date.addEventListener('input', () => { form.elements.end_date.min = form.elements.start_date.value; });
  form.addEventListener('reset', () => queueMicrotask(() => { form.elements.end_date.min = form.elements.start_date.value; }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    const status = document.getElementById('exhibition-form-status');
    const file = form.elements.image.files[0];
    status.textContent = '';
    const item = {};
    ['title', 'venue', 'start_date', 'end_date', 'description'].forEach(key => { item[key] = form.elements[key].value.trim(); });
    if (!item.title || !item.venue || !GalleryRules.exhibitionStatus(item)) {
      status.textContent = '전시명, 장소와 올바른 시작일·종료일을 입력해 주세요.';
      return;
    }
    if (file && file.size > 3_000_000) {
      status.textContent = '이미지는 3MB 이하로 올려 주세요.';
      return;
    }
    submit.disabled = true;
    try {
      if (file) item.image = await readImage(file);
      const editedId = editingExhibition?.id;
      if (window.galleryStore) {
        if (editedId) await window.galleryStore.updateExhibition(editedId, item);
        else await window.galleryStore.createExhibition(item);
      }
      else {
        if (editedId) item.id = editedId;
        const response = await fetch(editedId ? '/api/exhibitions/update' : '/api/exhibitions', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Authorization: `Bearer ${form.elements.exhibitionPassword.value}`},
          body: JSON.stringify(item)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '전시를 저장하지 못했습니다.');
      }
      form.reset();
      await load();
      dialog.close();
      if (editedId) {
        const updated = exhibitions.find(exhibition => exhibition.id === editedId);
        if (updated) openDetail(updated, GalleryRules.exhibitionStatus(updated));
      }
    } catch (error) {
      status.textContent = error.message || '전시를 저장하지 못했습니다.';
    } finally {
      submit.disabled = false;
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('pageshow', () => render());
  window.Exhibitions = {render, load};
  load();
})();
