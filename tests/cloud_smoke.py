"""Optional isolated PostgreSQL smoke test: pip install pgserver -r requirements.txt, then python tests/cloud_smoke.py. No real cloud credentials used."""
import os, tempfile, sys, threading, json, base64
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
import pgserver, psycopg
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
pg = pgserver.get_server(tempfile.mkdtemp(prefix='gallery-pg-'), cleanup_mode='delete')
uri = pg.get_uri()
with psycopg.connect(uri) as db:
    db.execute('CREATE ROLE anon')
    db.execute('CREATE ROLE authenticated')
    db.execute('CREATE TABLE exhibitions (id TEXT PRIMARY KEY, title TEXT NOT NULL, venue TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, description TEXT NOT NULL)')
    db.execute("INSERT INTO exhibitions (id,title,venue,start_date,end_date,description) VALUES ('legacy','Legacy Show','Seoul','2025-01-01','2025-01-02','')")
os.environ.update(SUPABASE_DB_URL=uri, SUPABASE_URL='https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY='test', GALLERY_ADMIN_PASSWORD='test-admin')
import server
from api.index import handler
server.save_image = lambda filename, raw, mime: 'https://example.supabase.co/storage/v1/object/public/gallery-artworks/' + filename
removed_images = []
server.remove_image = removed_images.append
http = server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=http.serve_forever, daemon=True).start()
def call(route, payload=None, admin=False):
    headers={'Authorization': 'Bearer test-admin'} if admin else {}
    req=Request(f'http://127.0.0.1:{http.server_port}/api/index.py?route='+route, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
    try: res=urlopen(req)
    except HTTPError as error: res=error
    with res: return res.status, json.load(res)
payload=dict(title='Relation',artist='Mari',series='Relation',image=base64.b64encode(b'\x89PNG\r\n\x1a\nexample').decode())
assert call('artworks', payload)[0] == 401
status, created = call('artworks',payload,True)
assert status == 201, (status,created)
assert call('artworks')[1][0]['id'] == created['id']
assert call('series-notes',dict(series='Relation',note='작가노트'),True)[0] == 200
assert call('series/rename',dict(source='Relation',target='관계'),True)[0] == 200
assert call('series-notes')[1] == {'관계':'작가노트'}
edit={**payload,'id':created['id'],'title':'Edited','series':'관계'}
del edit['image']
assert call('artworks/update',edit,True)[0] == 200
assert call('artworks')[1][0]['title'] == 'Edited'
legacy = call('exhibitions')[1]
assert len(legacy) == 1 and legacy[0]['id'] == 'legacy' and legacy[0]['image'] == ''
assert call('exhibitions',dict(title='Show',venue='Seoul',start_date='2026-10-25',end_date='2026-10-26'),True)[0] == 201
status, exhibition = call('exhibitions',dict(title='Image Show',venue='Seoul',start_date='2026-11-01',end_date='2026-11-02',image=payload['image']),True)
assert status == 201, (status, exhibition)
stored_exhibition = next(item for item in call('exhibitions')[1] if item['id'] == exhibition['id'])
assert stored_exhibition['image'].startswith('https://example.supabase.co/storage/v1/object/public/gallery-artworks/exhibition-')
original_exhibition_image = stored_exhibition['image']
edit_exhibition = dict(title='Edited Image Show',venue='Busan',start_date='2026-11-03',end_date='2026-11-04',description='Edited',id=exhibition['id'])
assert call('exhibitions/update',edit_exhibition)[0] == 401
assert call('exhibitions/update',edit_exhibition,True)[0] == 200
stored_exhibition = next(item for item in call('exhibitions')[1] if item['id'] == exhibition['id'])
assert stored_exhibition['title'] == 'Edited Image Show' and stored_exhibition['image'] == original_exhibition_image
assert call('exhibitions/update',{**edit_exhibition,'image':payload['image']},True)[0] == 200
stored_exhibition = next(item for item in call('exhibitions')[1] if item['id'] == exhibition['id'])
assert stored_exhibition['image'] != original_exhibition_image
assert removed_images == [original_exhibition_image.rsplit('/',1)[1]]
assert call('messages',dict(message='private'))[0] == 201
assert call('messages')[0] == 401
assert call('messages',admin=True)[1][0]['message'] == 'private'

# Simulate a new function instance against the migrated database. It must only
# inspect the schema once, with no lock/DDL before serving the combined read.
import cloud_backend
with server.connect_database() as db:
    assert cloud_backend.schema_ready(db)
queries = []
execute = cloud_backend.Database.execute
def record_execute(self, query, values=()):
    queries.append(query)
    return execute(self, query, values)
server._schema_ready = False
with patch.object(cloud_backend.Database, 'execute', record_execute):
    status, gallery = call('gallery')
assert status == 200, (status, gallery)
assert gallery['artworks'][0]['id'] == created['id']
assert gallery['seriesNotes'] == {'관계': '작가노트'}
assert set(gallery) == {'artworks', 'seriesNotes'}
assert len(queries) == 3, queries
assert not any(word in query.upper() for query in queries for word in ('CREATE ', 'ALTER ', 'REVOKE ', 'ADVISORY'))

# The fast path must not skip repairs when privacy configuration has drifted.
with psycopg.connect(uri) as db:
    db.execute('GRANT SELECT ON messages TO anon')
with server.connect_database() as db:
    assert not cloud_backend.schema_ready(db)
server._schema_ready = False
assert call('gallery')[0] == 200
with server.connect_database() as db:
    assert cloud_backend.schema_ready(db)
with psycopg.connect(uri) as db:
    assert db.execute("SELECT column_default FROM information_schema.columns WHERE table_name='exhibitions' AND column_name='image'").fetchone() is not None
    assert db.execute("SELECT relrowsecurity FROM pg_class WHERE relname='messages'").fetchone()[0]
    assert not db.execute("SELECT has_table_privilege('anon','messages','SELECT')").fetchone()[0]
http.shutdown()
pg.cleanup()
print('PostgreSQL + rewritten Vercel API: create/read/edit/rename/notes/exhibitions/private messages, 3-query cold gallery fast path, and privacy repair passed. Storage upload mocked.')
