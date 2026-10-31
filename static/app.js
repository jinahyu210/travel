const $ = id => document.getElementById(id);
let artworks = [];
const gallery = $('grid');
const seriesGallery = $('series-gallery');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let activeSeries = null;
let seriesTrigger = null;
let shownArtwork = null;
let editingArtwork = null;
let seriesNotes = {};
let noteSeries = null, noteTrigger = null, noteScroll = 0;
function noteFor(name) { return Object.hasOwn(seriesNotes, name) ? seriesNotes[name] : ''; }
function notePreview(name) {
  const text = noteFor(name);
  if (!text) return null;
  const preview = document.createElement('div'); preview.className = 'note-preview';
  const label = document.createElement('span'); label.className = 'note-label'; label.textContent = '작가노트';
  const excerpt = document.createElement('span'); excerpt.className = 'note-excerpt'; excerpt.textContent = text;
  preview.append(label, excerpt);
  return preview;
}
function updateSeriesNote() {
  const slot = $('series-note-slot'); slot.replaceChildren();
  const text = activeSeries !== null ? noteFor(activeSeries) : '';
  slot.hidden = !text;
  if (text) {
    const note = document.createElement('section'); note.className = 'series-note-full';
    const label = document.createElement('span'); label.className = 'note-label'; label.textContent = '작가노트';
    const body = document.createElement('p'); body.className = 'series-note-text'; body.textContent = text;
    note.append(label, body); slot.append(note);
  }
}
function openArtistNote(name, trigger) {
  noteSeries = name; noteTrigger = trigger; noteScroll = window.scrollY;
  $('note-title').textContent = name; $('note-full-text').textContent = noteFor(name);
  document.querySelector('.intro').hidden = true; document.querySelector('.collection').hidden = true;
  $('series-view').hidden = true; $('note-view').hidden = false;
  document.body.classList.add('note-open'); document.title = name + ' — 작가노트';
  window.scrollTo(0,0); $('note-title').focus({preventScroll:true});
}
function closeArtistNote() {
  $('note-view').hidden = true; document.body.classList.remove('note-open');
  document.querySelector('.intro').hidden = activeSeries !== null;
  document.querySelector('.collection').hidden = activeSeries !== null;
  $('series-view').hidden = activeSeries === null;
  document.title = '마리박현숙 — 작품과 기록';
  window.scrollTo(0,noteScroll);
  if (noteTrigger?.isConnected) noteTrigger.focus({preventScroll:true});
}
$('note-back').addEventListener('click', closeArtistNote);
function seriesName(artwork) { return (artwork.series || '').trim() || 'Works'; }
function updateNewSeriesField(focus = false) {
  const isNew = $('series-select').value === 'new';
  $('new-series-label').hidden = !isNew;
  $('upload-form').elements.series.required = isNew;
  if (isNew && focus) $('upload-form').elements.series.focus();
}
function updateSeriesOptions() {
  const select = $('series-select');
  const previous = select.value;
  const names = [...new Set(artworks.map(a => (a.series || '').trim()).filter(Boolean))];
  select.replaceChildren(new Option('시리즈 미지정', ''));
  names.forEach(name => select.add(new Option(name, 'series:' + name)));
  select.add(new Option('+ 새 시리즈', 'new'));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  updateNewSeriesField();
  const renameSelect = $('rename-series-select');
  const previousRename = renameSelect.value;
  const allNames = [...new Set(artworks.map(a => (a.series || '').trim()))];
  const placeholder = new Option('시리즈 선택', ''); placeholder.disabled = true;
  renameSelect.replaceChildren(placeholder);
  allNames.forEach(name => renameSelect.add(new Option(name || 'Works (시리즈 미지정)', 'series:' + name)));
  renameSelect.value = [...renameSelect.options].some(option => option.value === previousRename) ? previousRename : '';
  $('rename-open').disabled = !allNames.length;
  const noteSelect = $('note-series-select'), oldNote = noteSelect.value;
  const notePlaceholder = new Option('시리즈 선택', ''); notePlaceholder.disabled = true;
  noteSelect.replaceChildren(notePlaceholder);
  [...new Set(artworks.map(seriesName))].forEach(name => noteSelect.add(new Option(name,name)));
  noteSelect.value = [...noteSelect.options].some(option => option.value === oldNote) ? oldNote : '';
  $('note-open').disabled = !artworks.length;
}
$('series-select').addEventListener('change', () => updateNewSeriesField(true));
$('upload-form').addEventListener('reset', () => queueMicrotask(() => updateNewSeriesField()));
const canvasSelect = $('upload-form').elements.canvas_size;
canvasSelect.replaceChildren(new Option('선택', ''), new Option('직접 입력', '비규격'));
for (const type of ['F', 'P', 'M', 'S']) {
  const group = document.createElement('optgroup');
  group.label = {F: 'F · 인물형', P: 'P · 풍경형', M: 'M · 해경형', S: 'S · 정방형'}[type];
  GalleryRules.canvasFormats.filter(format => format.type === type).forEach(format =>
    group.append(new Option(format.label, format.label)));
  canvasSelect.append(group);
}
function setCanvasSelection(value) {
  if (value && ![...canvasSelect.options].some(option => option.value === value)) {
    const option = new Option(value, value);
    option.dataset.legacy = 'true';
    canvasSelect.add(option);
  }
  canvasSelect.value = value;
}
function updateSwapButton() {
  const form = $('upload-form');
  $('swap-dimensions').disabled = !(form.elements.width_cm.valueAsNumber > 0 && form.elements.height_cm.valueAsNumber > 0);
}
canvasSelect.addEventListener('change', () => {
  const form = $('upload-form');
  const width = form.elements.width_cm, height = form.elements.height_cm;
  const format = GalleryRules.canvasFormats.find(format => format.label === canvasSelect.value);
  if (format) {
    const portrait = width.valueAsNumber < height.valueAsNumber;
    width.value = portrait ? format.height : format.width;
    height.value = portrait ? format.width : format.height;
    updateDimensions();
  } else if (!canvasSelect.value) {
    width.value = height.value = '';
    updateDimensions();
  } else {
    width.value = height.value = '';
    updateDimensions();
    setCanvasSelection('비규격');
    width.focus();
  }
});
$('swap-dimensions').addEventListener('click', () => {
  const form = $('upload-form');
  const width = form.elements.width_cm, height = form.elements.height_cm;
  [width.value, height.value] = [height.value, width.value];
  updateDimensions();
});
function updateDimensions() {
  const form = $('upload-form');
  const width = form.elements.width_cm, height = form.elements.height_cm;
  width.setCustomValidity(height.value && !width.value ? '가로를 입력해 주세요.' : '');
  height.setCustomValidity(width.value && !height.value ? '세로를 입력해 주세요.' : '');
  const size = GalleryRules.canvasSize(width.valueAsNumber, height.valueAsNumber);
  setCanvasSelection(size);
  updateSwapButton();
  form.elements.dimensions.value = size ? `${width.valueAsNumber} × ${height.valueAsNumber} cm` : '';
}
['width_cm','height_cm'].forEach(name => $('upload-form').elements[name].addEventListener('input', updateDimensions));
$('upload-form').addEventListener('reset', () => queueMicrotask(updateDimensions));
function updateNavigation() {
  $('series-previous').disabled = seriesGallery.scrollLeft <= 1;
  $('series-next').disabled = seriesGallery.scrollLeft + seriesGallery.clientWidth >= seriesGallery.scrollWidth - 1;
}
function moveGallery(direction) {
  const card = seriesGallery.firstElementChild;
  const distance = card ? card.getBoundingClientRect().width + parseFloat(getComputedStyle(seriesGallery).columnGap || 0) : seriesGallery.clientWidth;
  seriesGallery.scrollBy({left: direction * distance, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
}
$('series-previous').addEventListener('click', () => moveGallery(-1));
$('series-next').addEventListener('click', () => moveGallery(1));
seriesGallery.addEventListener('scroll', updateNavigation, {passive: true});
window.addEventListener('resize', updateNavigation);
seriesGallery.addEventListener('wheel', event => {
  if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? seriesGallery.clientWidth : 1);
  const max = seriesGallery.scrollWidth - seriesGallery.clientWidth;
  if (max <= 0 || (delta < 0 && seriesGallery.scrollLeft <= 0) || (delta > 0 && seriesGallery.scrollLeft >= max - 1)) return;
  event.preventDefault();
  seriesGallery.scrollLeft += delta;
}, {passive: false});
function showArtwork(artwork) {
  shownArtwork = artwork;
  $('edit-artwork').hidden = !artwork.id;
  $('detail-image').src = artwork.image;
  $('detail-image').alt = artwork.title;
  $('detail-title').textContent = artwork.title;
  $('detail-artist').textContent = [artwork.artist, artwork.series].filter(Boolean).join(' · ');
  const metadata = $('detail-metadata');
  metadata.replaceChildren();
  [['제작 연도', 'year'], ['재료 / 기법', 'medium'], ['크기', 'dimensions'], ['호수', 'canvas_size'], ['가격', 'price']].forEach(([label, key]) => {
    if (!artwork[key]) return;
    const row = document.createElement('div'); row.className = 'metadata-' + key;
    const term = document.createElement('dt'); term.textContent = label;
    const value = document.createElement('dd'); value.textContent = artwork[key];
    row.append(term, value); metadata.append(row);
  });
  metadata.hidden = !metadata.children.length;
  $('detail-description').textContent = artwork.description;
  $('detail-description').hidden = !artwork.description;
  const {works, index} = detailPosition();
  $('detail-previous').hidden = index <= 0;
  $('detail-next').hidden = index < 0 || index >= works.length - 1;
  if (!$('detail').open) $('detail').showModal();
  $('detail').scrollTop = 0;
}
function detailPosition() {
  const works = shownArtwork ? artworks.filter(a => seriesName(a) === seriesName(shownArtwork)) : [];
  const index = works.findIndex(a => a === shownArtwork || (a.id && a.id === shownArtwork.id));
  return {works, index};
}
function navigateArtwork(direction) {
  const {works, index} = detailPosition();
  const next = works[index + direction];
  if (index < 0 || !next) return;
  const focused = document.activeElement;
  showArtwork(next);
  if (focused === $('detail-previous') && focused.hidden) $('detail-next').focus({preventScroll:true});
  if (focused === $('detail-next') && focused.hidden) $('detail-previous').focus({preventScroll:true});
}
$('detail-previous').addEventListener('click', () => navigateArtwork(-1));
$('detail-next').addEventListener('click', () => navigateArtwork(1));
$('detail').addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    navigateArtwork(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
function artworkCard(artwork, open, priority = false) {
  const card = document.createElement('button'); card.className = 'card';
  card.setAttribute('aria-label', artwork.title || seriesName(artwork));
  const imageFrame = document.createElement('div'); imageFrame.className = 'image-frame';
  const img = document.createElement('img'); img.alt = artwork.title;
  GalleryImages.setSource(img, artwork.image, {priority});
  imageFrame.append(img);
  const title = document.createElement('h3'); title.textContent = artwork.title;
  const year = document.createElement('p'); year.className = 'caption-year'; year.textContent = artwork.year || '';
  const caption = document.createElement('div'); caption.className = 'card-caption'; caption.append(title, year);
  if (artwork.medium || artwork.dimensions || artwork.canvas_size) {
    const specs = document.createElement('div'); specs.className = 'caption-specs';
    for (const key of ['medium', 'dimensions']) {
      const line = document.createElement('p'); line.className = 'caption-' + key;
      line.textContent = artwork[key] || '';
      if (key === 'dimensions' && artwork.canvas_size) {
        line.textContent += `${line.textContent ? ' ' : ''}(${artwork.canvas_size})`;
      }
      specs.append(line);
    }
    caption.append(specs);
  }
  ['price'].forEach(key => {
    if (!artwork[key]) return;
    const line = document.createElement('p'); line.className = 'caption-extra caption-' + key;
    line.textContent = artwork[key]; caption.append(line);
  });
  card.append(imageFrame, caption);
  card.addEventListener('click', () => open(artwork, card));
  return card;
}
let overviewScroll = 0;
function openSeries(name, trigger) {
  const works = artworks.filter(a => seriesName(a) === name);
  activeSeries = name;
  seriesTrigger = trigger;
  overviewScroll = window.scrollY;
  $('series-title').textContent = name;
  updateSeriesNote();
  seriesGallery.replaceChildren(...works.map((a, index) => artworkCard(a, showArtwork, index === 0)));
  document.querySelector('.intro').hidden = true;
  document.querySelector('.collection').hidden = true;
  $('series-view').hidden = false;
  document.body.classList.add('series-open');
  seriesGallery.scrollLeft = 0;
  window.scrollTo(0, 0);
  $('series-title').focus({preventScroll: true});
  requestAnimationFrame(updateNavigation);
}
function closeSeries() {
  activeSeries = null;
  $('series-view').hidden = true;
  document.querySelector('.intro').hidden = false;
  document.querySelector('.collection').hidden = false;
  document.body.classList.remove('series-open');
  window.scrollTo(0, overviewScroll);
  if (seriesTrigger && seriesTrigger.isConnected) seriesTrigger.focus({preventScroll: true});
}
$('series-back').addEventListener('click', closeSeries);
function render() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const visible = artworks.filter(a => `${a.title} ${a.series || ''} ${a.year}`.toLocaleLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  let firstImage = true;
  $('count').textContent = String(visible.length);
  $('status').hidden = visible.length > 0 || !query;
  $('status').textContent = query && !visible.length ? '검색한 작품이 없습니다.' : '';
  const groups = new Map();
  visible.forEach(a => {
    const name = seriesName(a);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(a);
  });
  groups.forEach((works, name) => {
    const panel = document.createElement('section'); panel.className = 'series-title';
    const link = document.createElement('button'); link.type = 'button'; link.className = 'series-title-link';
    link.setAttribute('aria-label', `${name} 시리즈 보기`);
    const number = document.createElement('span'); number.className = 'series-index'; number.textContent = '시리즈';
    const title = document.createElement('h3'); title.textContent = name;
    const arrow = document.createElement('span'); arrow.className = 'series-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    link.append(title,arrow); panel.append(number,link);
    const preview = notePreview(name); if (preview) panel.append(preview);
    link.addEventListener('click', () => openSeries(name, link));
    fragment.append(panel, ...works.map(a => {
      const card = artworkCard(a, showArtwork, firstImage);
      firstImage = false;
      return card;
    }));
  });
  gallery.replaceChildren(fragment);
  if (activeSeries !== null) {
    const works = artworks.filter(a => seriesName(a) === activeSeries);
    if (!works.length) closeSeries();
    else {
      $('series-title').textContent = activeSeries;
      updateSeriesNote();
      seriesGallery.replaceChildren(...works.map((a, index) => artworkCard(a, showArtwork, index === 0)));
      requestAnimationFrame(updateNavigation);
    }
  }
}
const galleryCacheKey = 'gallery:works:v1';
let galleryRefreshUntil = 0;
let galleryLoaded = false;
let galleryRequest = 0;
async function load(fresh = false) {
  const request = ++galleryRequest;
  try {
    if (window.galleryStore) {
      [artworks,seriesNotes] = await Promise.all([window.galleryStore.list(),window.galleryStore.listNotes()]);
    } else {
      const bypass = fresh || Date.now() < galleryRefreshUntil;
      const response = await fetch('/api/gallery' + (bypass ? '?refresh=' + Date.now() : ''), bypass ? {cache:'no-store'} : {});
      if (!response.ok) throw new Error();
      const next = await response.json();
      if (request !== galleryRequest) return;
      ({artworks, seriesNotes} = next);
      if (fresh) galleryRefreshUntil = Date.now() + 30000;
      try { localStorage.setItem(galleryCacheKey, JSON.stringify({savedAt:Date.now(), refreshUntil:galleryRefreshUntil, artworks, seriesNotes})); } catch {}
    }
    galleryLoaded = true;
    updateSeriesOptions();
    render();
  } catch { if (!galleryLoaded) { $('status').hidden = false; $('status').textContent = '작품을 불러오지 못했습니다. 새로고침해 주세요.'; } }
}
async function openArtworkForm(artwork = null) {
  if (!GalleryAdmin.require(() => openArtworkForm(artwork))) return;
  const form = $('upload-form');
  canvasSelect.querySelectorAll('[data-legacy]').forEach(option => option.remove());
  form.reset();
  await Promise.resolve(); // Let reset handlers finish before filling an existing work.
  editingArtwork = artwork;
  $('delete-artwork').hidden = !artwork;
  $('upload-title').textContent = artwork ? '작품 편집' : '새로운 작품 등록';
  form.querySelector('[type=submit]').textContent = artwork ? '수정 저장하기' : '작품 등록하기 ↗';
  form.elements.file.required = !artwork;
  $('upload-image-label').textContent = artwork ? '이미지 교체 (선택)' : '작품 이미지';
  $('upload-current-image').hidden = !artwork;
  $('upload-status').textContent = '';
  if (artwork) {
    ['title','artist','year','medium','price','dimensions','canvas_size','description'].forEach(key => form.elements[key].value = artwork[key] || '');
    $('series-select').value = artwork.series ? 'series:' + artwork.series.trim() : '';
    updateNewSeriesField();
    const dimensions = (artwork.dimensions || '').match(/^\s*(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:cm)?\s*$/);
    if (dimensions) {
      form.elements.width_cm.value = dimensions[1];
      form.elements.height_cm.value = dimensions[2];
    }
    setCanvasSelection(artwork.canvas_size || '');
    updateSwapButton();
    $('upload-current-image').src = artwork.image;
  }
  if (window.galleryStore) window.galleryStore.showNotice();
  $('upload').showModal();
}
$('admin').addEventListener('click', () => openArtworkForm());
$('edit-artwork').addEventListener('click', () => {
  $('detail').close();
  openArtworkForm(shownArtwork);
});
document.querySelectorAll('.close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('upload').addEventListener('close', () => { $('upload-form').elements.password.value = ''; });
$('delete-artwork').addEventListener('click', async () => {
  if (!editingArtwork) return;
  const form = $('upload-form'), button = $('delete-artwork');
  if (!window.galleryStore && !form.elements.password.reportValidity()) return;
  if (!confirm(`“${editingArtwork.title}” 작품을 삭제할까요? 사진과 작품 정보가 삭제되며 복구할 수 없습니다.`)) return;
  const id = editingArtwork.id;
  button.disabled = true;
  form.querySelector('[type=submit]').disabled = true;
  try {
    if (window.galleryStore) await window.galleryStore.remove(id);
    else await GalleryUpload.request('/api/artworks/delete', {id}, form.elements.password.value);
    artworks = artworks.filter(item => item.id !== id);
    try { localStorage.removeItem(galleryCacheKey); } catch {}
    render();
    $('upload').close();
    await load(true);
  } catch (error) { $('upload-status').textContent = error.message; }
  finally { button.disabled = false; form.querySelector('[type=submit]').disabled = false; }
});
function openNoteEditor(name) {
  if (!GalleryAdmin.require(() => openNoteEditor(name))) return;
  $('note-status').textContent = '';
  $('note-series-select').value = name || '';
  $('note-editor').value = noteFor(name || '');
  if ($('upload').open) $('upload').close();
  $('note-dialog').showModal();
}
$('note-open').addEventListener('click', () => {
  const selected = $('series-select').value;
  openNoteEditor(activeSeries || (selected.startsWith('series:') ? selected.slice(7) || 'Works' : ''));
});
$('note-edit').addEventListener('click', () => openNoteEditor(noteSeries));
$('note-series-select').addEventListener('change', () => { $('note-editor').value = noteFor($('note-series-select').value); });
$('note-dialog').addEventListener('close', () => { $('note-form').elements.notePassword.value = ''; });
$('note-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, submit = form.querySelector('[type=submit]');
  const series = $('note-series-select').value, note = $('note-editor').value;
  $('note-status').textContent = ''; submit.disabled = true;
  try {
    if (!series) throw new Error('시리즈를 선택해 주세요.');
    if (window.galleryStore) await window.galleryStore.saveNote(series,note);
    else {
      const response = await fetch('/api/series-notes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${form.elements.notePassword.value}`},body:JSON.stringify({series,note})});
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '작가노트를 저장하지 못했습니다.');
    }
    await load(true);
    if (!$('note-view').hidden) {
      if (noteFor(noteSeries)) $('note-full-text').textContent = noteFor(noteSeries);
      else closeArtistNote();
    }
    $('note-dialog').close();
  } catch (error) { $('note-status').textContent = error.message || '작가노트를 저장하지 못했습니다.'; }
  finally { submit.disabled = false; }
});
$('rename-open').addEventListener('click', () => {
  const selected = $('series-select').value;
  $('series-rename-form').reset();
  if (selected.startsWith('series:')) $('rename-series-select').value = selected;
  $('rename-title').value = $('rename-series-select').value.slice(7);
  $('rename-status').textContent = '';
  $('upload').close();
  $('rename-dialog').showModal();
});
$('rename-series-select').addEventListener('change', () => {
  $('rename-title').value = $('rename-series-select').value.slice(7);
});
$('rename-dialog').addEventListener('close', () => { $('series-rename-form').elements.renamePassword.value = ''; });
$('series-rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type=submit]');
  const source = $('rename-series-select').value.slice(7);
  const target = $('rename-title').value.trim();
  $('rename-status').textContent = '';
  if (!$('rename-series-select').value || !target) { $('rename-status').textContent = '시리즈를 선택하고 새 제목을 입력해 주세요.'; return; }
  submit.disabled = true;
  try {
    if (window.galleryStore) await window.galleryStore.rename(source, target);
    else {
      const response = await fetch('/api/series/rename', {method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${form.elements.renamePassword.value}`}, body:JSON.stringify({source, target})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '제목을 수정하지 못했습니다.');
    }
    if (activeSeries !== null) closeSeries();
    await load(true);
    $('rename-dialog').close();
  } catch (error) { $('rename-status').textContent = error.message || '제목을 수정하지 못했습니다.'; }
  finally { submit.disabled = false; }
});
let searchFrame;
$('search').addEventListener('input', () => {
  cancelAnimationFrame(searchFrame);
  searchFrame = requestAnimationFrame(render);
});
$('upload-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type=submit]');
  $('upload-status').textContent = ''; const file = form.elements.file.files[0];
  if (!file && !editingArtwork) { $('upload-status').textContent = '작품 이미지를 선택해 주세요.'; return; }
  if (file && file.size > 10_000_000) { $('upload-status').textContent = '이미지는 10MB 이하로 올려 주세요.'; return; }
  submit.disabled = true;
  $('delete-artwork').disabled = true;
  const editedId = editingArtwork?.id;
  try {
    const payload = {};
    ['title','artist','series','year','medium','price','dimensions','canvas_size','description'].forEach(key => payload[key] = form.elements[key].value);
    payload.series = $('series-select').value === 'new' ? payload.series.trim() : $('series-select').value.slice(7);
    if ($('series-select').value === 'new' && !payload.series) throw new Error('새 시리즈 제목을 입력해 주세요.');
    if (file) payload.image = await GalleryUpload.image(file, form.elements.password.value, $('upload-status'));
    if (window.galleryStore) {
      if (editedId) await window.galleryStore.update(editedId, payload);
      else await window.galleryStore.create(payload);
    } else {
      if (editedId) payload.id = editedId;
      const response = await fetch(editedId ? '/api/artworks/update' : '/api/artworks', {method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${form.elements.password.value}`}, body:JSON.stringify(payload)});
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '등록하지 못했습니다.');
    }
    if (editedId && activeSeries !== null) activeSeries = payload.series || 'Works';
    await load(true); $('upload').close();
    if (editedId) {
      const updated = artworks.find(a => a.id === editedId);
      if (updated) showArtwork(updated);
    }
  } catch (error) { $('upload-status').textContent = error.message || '등록하지 못했습니다. 다시 시도해 주세요.'; }
  finally { submit.disabled = false; $('delete-artwork').disabled = false; }
});
if (!window.galleryStore) {
  try {
    const cached = JSON.parse(localStorage.getItem(galleryCacheKey));
    if (cached && Date.now() - cached.savedAt < 300000 && Array.isArray(cached.artworks) &&
        cached.artworks.every(item => item && typeof item.title === 'string' && typeof item.image === 'string') &&
        cached.seriesNotes && typeof cached.seriesNotes === 'object') {
      artworks = cached.artworks;
      seriesNotes = cached.seriesNotes;
      galleryRefreshUntil = Number(cached.refreshUntil) || 0;
      updateSeriesOptions();
      render();
      galleryLoaded = true;
    }
  } catch {}
}
load().then(async () => {
  const url = new URL(window.location.href);
  if (url.searchParams.get('register') === '1') {
    url.searchParams.delete('register');
    history.replaceState(null, '', url);
    await GalleryAdmin.ready;
    openArtworkForm();
  }
});
