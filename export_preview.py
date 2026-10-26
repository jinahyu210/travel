"""Export a self-contained visual preview; the live app still needs server.py."""
from pathlib import Path
import base64
import json
import mimetypes
import sqlite3

root = Path(__file__).resolve().parent
static = root / 'static'
html = (static / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="./style.css">', '<style>' + (static / 'style.css').read_text() + '</style>')
html = html.replace('<script defer src="./app.js"></script>', '')
html = html.replace('<script defer src="./gallery-rules.js"></script>', '')
html = html.replace('<script defer src="./gallery-images.js"></script>', '')
script = (static / 'app.js').read_text()
# Use registered works when available. Until then, show neutral layout frames,
# never invented paintings or biographical information attributed to the artist.
works = []
exhibitions = []
series_notes = {}


def embed_local_image(item):
    value = item.get('image', '')
    if not value.startswith('/images/'):
        return
    image = root / '.gallery' / 'images' / Path(value).name
    mime = mimetypes.guess_type(image.name)[0] or 'application/octet-stream'
    item['image'] = f'data:{mime};base64,' + base64.b64encode(image.read_bytes()).decode()


db_path = root / '.gallery' / 'gallery.sqlite3'
if db_path.is_file():
    with sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        works = [dict(row) for row in db.execute('SELECT * FROM artworks ORDER BY created_at DESC, rowid DESC')]
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='series_notes'").fetchone():
            series_notes = {row['series']: row['note'] for row in db.execute('SELECT series,note FROM series_notes')}
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exhibitions'").fetchone():
            exhibitions = [dict(row) for row in db.execute('SELECT * FROM exhibitions ORDER BY start_date DESC, rowid DESC')]
    for item in works + exhibitions:
        embed_local_image(item)
if not works:
    for series_index, count in enumerate([3, 2, 4], start=1):
        for index in range(count):
            width, height = [(300, 380), (380, 300), (320, 350)][index % 3]
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="100%" height="100%" fill="#efefed"/></svg>'
            works.append({'preview_frame': True, 'series': f'Series {series_index:02}', 'title': '', 'artist': '', 'year': '', 'description': '', 'image': 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()})
encoded = json.dumps(works, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
html = html.replace('</head>', '<script id="gallery-seed" type="application/json">' + encoded + '</script></head>')
encoded_exhibitions = json.dumps(exhibitions, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
encoded_notes = json.dumps(series_notes, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
html = html.replace('</head>', '<script id="series-note-seed" type="application/json">' + encoded_notes + '</script></head>')
html = html.replace('</head>', '<script id="exhibition-seed" type="application/json">' + encoded_exhibitions + '</script></head>')
html = html.replace('<p id="upload-status"', '<p id="upload-storage-note" class="muted" role="status"></p><button id="backup-works" type="button" class="quiet">작품 백업 ↓</button><button id="restore-works" type="button" class="quiet">백업 불러오기 ↑</button><input id="restore-file" type="file" accept=".html,.json" hidden><p id="restore-status" class="muted" role="status"></p><p id="upload-status"')
script = (static / 'gallery-rules.js').read_text() + '\n' + (static / 'gallery-images.js').read_text() + '\n' + (static / 'preview-store.js').read_text() + '\n' + script + '\n' + (static / 'exhibitions.js').read_text() + '\n' + (static / 'contact.js').read_text()
# Preview hosts can block navigation to sibling files. Keep both views in one
# document, without iframe loads, network requests, or cross-file navigation.
exhibitions_source = (static / 'exhibitions.html').read_text()
exhibitions_content = '<main>' + exhibitions_source.split('<main>', 1)[1].split('</body>', 1)[0]
html = html.replace('<main>', '<div id="works-view"><main>', 1)
html = html.replace('</footer>', '</footer></div><div id="exhibitions-view" hidden>' + exhibitions_content + '</div>', 1)
contact_source = (static / 'contact.html').read_text()
contact_content = '<main>' + contact_source.split('<main>', 1)[1].split('</body>', 1)[0]
html = html.replace('</body>', '<div id="contact-view" hidden>' + contact_content + '</div></body>')
html = html.replace('</head>', '<style>' + (static / 'exhibitions.css').read_text() + '\n[hidden]{display:none!important}</style></head>')
html = html.replace('href="/exhibitions"', 'href="#exhibitions"').replace('href="/contact"', 'href="#contact"').replace('href="/"', 'href="#works"')
navigation = """
function showPreviewView(view) {
  if (!document.getElementById('note-view').hidden) closeArtistNote();
  const exhibition = view === 'exhibitions';
  const contact = view === 'contact';
  if (!exhibition && activeSeries !== null) closeSeries();
  document.getElementById('works-view').hidden = exhibition || contact;
  document.getElementById('exhibitions-view').hidden = !exhibition;
  document.getElementById('contact-view').hidden = !contact;
  document.body.classList.toggle('exhibitions-page', exhibition);
  document.body.classList.toggle('contact-page', contact);
  document.getElementById('admin').hidden = false;
  document.querySelectorAll('.site-nav a').forEach(link => {
    const active = link.getAttribute('href') === '#' + view;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = contact ? 'Contact — Park Hyun Sook' : exhibition ? '전시 — 마리박현숙' : '마리박현숙 — 작품과 기록';
  window.scrollTo(0, 0);
  requestAnimationFrame(updateNavigation);
}
document.querySelectorAll('a[href="#works"], a[href="#exhibitions"], a[href="#contact"]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    showPreviewView(link.getAttribute('href').slice(1));
  });
});
"""
html = html.replace('</body>', '<script>' + script + navigation + '</script></body>')
(root / 'gallery-preview.html').write_text(html)
exhibitions = html.replace('</body>', '<script>showPreviewView("exhibitions");</script></body>')
(root / 'exhibitions-preview.html').write_text(exhibitions)
contact = html.replace('</body>', '<script>showPreviewView("contact");</script></body>')
(root / 'contact-preview.html').write_text(contact)
print('Created single-document gallery and exhibition previews (no cross-file navigation).')
