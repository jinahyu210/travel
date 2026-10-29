// Standalone storage: IndexedDB, then localStorage, with honest memory fallback.
(() => {
  let works = JSON.parse(document.getElementById('gallery-seed').textContent);
  let exhibitions = JSON.parse(document.getElementById('exhibition-seed').textContent);
  let seriesNotes = JSON.parse(document.getElementById('series-note-seed')?.textContent || '{}');
  const storageKey = 'park-hyun-sook-gallery-backup-v1';
  let database = null, localAvailable = false;
  function snapshot() { return {works, exhibitions, seriesNotes}; }
  function notice() {
    const durable = Boolean(database || localAvailable);
    document.getElementById('upload-storage-note').textContent = durable ? '이 브라우저에 자동 저장됩니다. 다른 기기에는 반영되지 않습니다.' : '이 화면은 브라우저 저장을 허용하지 않아 새로고침하면 데이터가 사라집니다. 닫기 전에 작품 백업을 저장해 주세요.';
  }
  const ready = (async () => {
    let localSnapshot;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.works) && Array.isArray(parsed.exhibitions)) localSnapshot = parsed;
      }
      const probe = storageKey + '-probe-' + Math.random().toString(36).slice(2);
      localStorage.setItem(probe, 'ok');
      localAvailable = localStorage.getItem(probe) === 'ok';
      localStorage.removeItem(probe);
    } catch { localAvailable = false; }
    database = await new Promise(resolve => {
      let finished = false;
      const finish = value => { if (!finished) { finished = true; resolve(value); } };
      const timer = setTimeout(() => finish(null), 2500);
      let request;
      try { request = indexedDB.open('park-hyun-sook-gallery', 1); }
      catch { clearTimeout(timer); finish(null); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('gallery');
      request.onerror = request.onblocked = () => { clearTimeout(timer); finish(null); };
      request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else finish(request.result); };
    });
    let stored;
    if (database) {
      try {
        stored = await new Promise((resolve, reject) => {
          const transaction = database.transaction('gallery', 'readonly');
          const result = {};
          ['works','exhibitions','seriesNotes'].forEach(key => {
            const request = transaction.objectStore('gallery').get(key);
            request.onsuccess = () => { result[key] = request.result; };
          });
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = transaction.onabort = () => reject(transaction.error);
        });
      } catch { database = null; }
    }
    if (!database) stored = localSnapshot;
    if (stored) {
      if (Array.isArray(stored.works)) works = stored.works;
      if (Array.isArray(stored.exhibitions)) exhibitions = stored.exhibitions;
      if (stored.seriesNotes && typeof stored.seriesNotes === 'object' && !Array.isArray(stored.seriesNotes)) seriesNotes = stored.seriesNotes;
    }
    notice();
  })();
  async function commit(next) {
    await ready;
    if (database) {
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('gallery', 'readwrite');
          Object.entries(next).forEach(([key,value]) => transaction.objectStore('gallery').put(value,key));
          transaction.oncomplete = resolve;
          transaction.onerror = transaction.onabort = () => reject(transaction.error);
        });
      } catch { database = null; }
    }
    if (!database && localAvailable) {
      try {
        const serialized = JSON.stringify(next);
        localStorage.setItem(storageKey, serialized);
        if (localStorage.getItem(storageKey) !== serialized) throw new Error('Storage verification failed');
      } catch { localAvailable = false; }
    }
    ({works, exhibitions, seriesNotes} = next);
    notice();
  }
  async function read() { await ready; return works; }
  async function readExhibitions() { await ready; return exhibitions; }
  function imageData(image) {
    let raw;
    try { raw = atob(image); } catch { throw new Error('올바른 이미지 파일을 선택해 주세요.'); }
    let mime;
    if (raw.startsWith('\x89PNG\r\n\x1a\n')) mime = 'image/png';
    else if (raw.startsWith('\xff\xd8\xff')) mime = 'image/jpeg';
    else if (raw.startsWith('RIFF') && raw.slice(8,12) === 'WEBP') mime = 'image/webp';
    else throw new Error('JPG, PNG, WebP 이미지만 지원합니다.');
    return `data:${mime};base64,${image}`;
  }
  window.galleryStore = {
    list: read,
    async remove(id) {
      await ready;
      await commit({...snapshot(), works: works.filter(item => item.id !== id)});
    },
    async removeExhibition(id) {
      await ready;
      await commit({...snapshot(), exhibitions: exhibitions.filter(item => item.id !== id)});
    },
    listExhibitions: readExhibitions,
    async listNotes() { await ready; return seriesNotes; },
    showNotice: notice,
    async saveNote(series, note) {
      await ready;
      if (!series || typeof note !== 'string' || note.length > 20000) throw new Error('작가노트를 20,000자 이내로 입력해 주세요.');
      await commit({...snapshot(), seriesNotes:{...seriesNotes,[series]:note.trim()}});
    },
    async createExhibition(item) {
      if (!item.title || !item.venue || !GalleryRules.exhibitionStatus(item)) throw new Error('전시 정보를 확인해 주세요.');
      await ready;
      const image = item.image ? imageData(item.image) : '';
      await commit({...snapshot(), exhibitions:[{...item,image,id:Date.now().toString(36)+Math.random().toString(36).slice(2)},...exhibitions]});
    },
    async updateExhibition(id, payload) {
      if (!payload.title || !payload.venue || !GalleryRules.exhibitionStatus(payload)) throw new Error('전시 정보를 확인해 주세요.');
      await ready;
      const existing = exhibitions.find(exhibition => exhibition.id === id);
      if (!existing) throw new Error('수정할 전시를 찾을 수 없습니다.');
      const updated = {...existing, ...payload, id, image:payload.image ? imageData(payload.image) : existing.image};
      await commit({...snapshot(), exhibitions:exhibitions.map(exhibition => exhibition.id === id ? updated : exhibition)});
    },
    async create(payload) {
      await ready;
      const item = {...payload,id:Date.now().toString(36)+Math.random().toString(36).slice(2),image:imageData(payload.image)};
      await commit({...snapshot(),works:[item,...works.filter(work=>!work.preview_frame)]});
    },
    async update(id,payload) {
      await ready;
      const existing = works.find(work=>work.id===id);
      if (!existing) throw new Error('수정할 작품을 찾을 수 없습니다.');
      const updated = {...existing,...payload,id,image:payload.image?imageData(payload.image):existing.image};
      await commit({...snapshot(),works:works.map(work=>work.id===id?updated:work)});
    },
    async rename(source,target) {
      await ready;
      if (!target.trim() || target.length>120) throw new Error('새 시리즈 제목을 120자 이내로 입력해 주세요.');
      source=source.trim();target=target.trim();
      if (!works.some(work=>(work.series||'').trim()===source)) throw new Error('해당 시리즈를 찾을 수 없습니다.');
      if (source!==target && works.some(work=>(work.series||'').trim()===target)) throw new Error('이미 있는 시리즈 제목입니다. 다른 이름을 입력해 주세요.');
      const notes={...seriesNotes}, noteSource=source||'Works';
      if (noteSource!==target && Object.hasOwn(notes,noteSource)) {
        if (Object.hasOwn(notes,target)) throw new Error('같은 이름의 작가노트가 있습니다. 다른 시리즈 이름을 입력해 주세요.');
        notes[target]=notes[noteSource];delete notes[noteSource];
      }
      await commit({...snapshot(),works:works.map(work=>(work.series||'').trim()===source?{...work,series:target}:work),seriesNotes:notes});
    }
  };
  // This password would not authenticate a local-only file. Never collect it.
  document.querySelectorAll('[type=password]').forEach(password => {
    password.required = false;
    password.closest('label').hidden = true;
  });
  // Some preview hosts allow scripts but forbid native form submissions.
  // Local uploads do not need navigation or a server form request.
  document.querySelectorAll('form').forEach(form => {
    form.querySelector('[type=submit]').addEventListener('click', event => {
      event.preventDefault();
      if (form.reportValidity()) form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
  });
  document.getElementById('restore-works').addEventListener('click', () => document.getElementById('restore-file').click());
  document.getElementById('restore-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const status = document.getElementById('restore-status'); status.textContent = '';
    try {
      const text = await file.text();
      let snapshot;
      if (file.name.toLowerCase().endsWith('.json')) snapshot = JSON.parse(text);
      else {
        const parsed = new DOMParser().parseFromString(text, 'text/html');
        snapshot = {works:JSON.parse(parsed.getElementById('gallery-seed').textContent), exhibitions:JSON.parse(parsed.getElementById('exhibition-seed')?.textContent || '[]'),seriesNotes:JSON.parse(parsed.getElementById('series-note-seed')?.textContent || '{}')};
      }
      if (!Array.isArray(snapshot.works) || !Array.isArray(snapshot.exhibitions)) throw new Error('올바른 갤러리 백업 파일이 아닙니다.');
      const fields = ['title','artist','series','year','medium','price','dimensions','canvas_size','description'];
      if (snapshot.works.some(item => !item || typeof item.image !== 'string' || !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(item.image) || fields.some(key => item[key] != null && typeof item[key] !== 'string'))) throw new Error('백업의 작품 정보를 확인해 주세요.');
      if (snapshot.exhibitions.some(item => !item || !GalleryRules.exhibitionStatus(item) || typeof item.title !== 'string' || typeof item.venue !== 'string' || (item.image != null && (typeof item.image !== 'string' || (item.image && !/^data:image\/(png|jpeg|webp);base64,/.test(item.image)))))) throw new Error('백업의 전시 정보를 확인해 주세요.');
      // Merge by ID to preserve existing work; do not overwrite newer local edits.
      await read(); await readExhibitions();
      const current = works.filter(item => !item.preview_frame);
      const ids = new Set(current.filter(item => item.id).map(item => item.id));
      const imported = snapshot.works.filter(item => !item.preview_frame && (!item.id || !ids.has(item.id))).map((item,index) => ({...item, id:item.id || 'restored-' + Date.now() + '-' + index}));
      const exhibitionIds = new Set(exhibitions.filter(item => item.id).map(item => item.id));
      const nextExhibitions = [...exhibitions, ...snapshot.exhibitions.filter(item => !item.id || !exhibitionIds.has(item.id))];
      const nextWorks = [...current, ...imported];
      const importedNotes = snapshot.seriesNotes || {};
      if (typeof importedNotes !== 'object' || Array.isArray(importedNotes) || Object.values(importedNotes).some(note => typeof note !== 'string' || note.length > 20000)) throw new Error('백업의 작가노트를 확인해 주세요.');
      await commit({works:nextWorks, exhibitions:nextExhibitions, seriesNotes:{...importedNotes,...seriesNotes}});
      if (activeSeries !== null) closeSeries();
      await load(); await window.Exhibitions.load();
      status.textContent = '백업을 불러왔습니다. 기존 작품과 중복되는 항목은 유지했습니다.';
    } catch (error) { status.textContent = error.message || '백업 파일을 불러오지 못했습니다.'; }
    finally { event.target.value = ''; }
  });
  document.getElementById('backup-works').addEventListener('click', () => {
    const copy = document.documentElement.cloneNode(true);
    copy.querySelector('#gallery-seed').textContent = JSON.stringify(works).replace(/</g, '\\u003c');
    copy.querySelector('#exhibition-seed').textContent = JSON.stringify(exhibitions).replace(/</g, '\\u003c');
    copy.querySelector('#series-note-seed').textContent = JSON.stringify(seriesNotes).replace(/</g, '\\u003c');
    copy.querySelectorAll('dialog[open]').forEach(dialog => dialog.removeAttribute('open'));
    copy.querySelector('body').classList.remove('exhibitions-page', 'series-open', 'contact-page');
    copy.querySelector('#works-view').hidden = false;
    copy.querySelector('#exhibitions-view').hidden = true;
    copy.querySelector('#contact-view').hidden = true;
    copy.querySelector('#series-view').hidden = true;
    copy.querySelector('.intro').hidden = false;
    copy.querySelector('.collection').hidden = false;
    copy.querySelector('#admin').hidden = false;
    copy.querySelector('#upload-form').reset();
    copy.querySelector('#series-rename-form').reset();
    copy.querySelector('#exhibition-form').reset();
    copy.querySelector('#contact-form').reset();
    copy.querySelector('#note-form').reset();
    copy.querySelector('#note-view').hidden = true;
    copy.querySelector('body').classList.remove('note-open');
    copy.querySelector('#inbox-form').reset();
    copy.querySelector('#inbox-messages').replaceChildren();
    copy.querySelector('#contact-status').textContent = '';
    copy.querySelector('#inbox-status').textContent = '';
    const blob = new Blob(['<!doctype html>\n' + copy.outerHTML], {type:'text/html;charset=utf-8'});
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = 'Park-Hyun-Sook-gallery.html';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
})();
