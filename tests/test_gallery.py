import base64
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

from server import is_heif

ROOT = Path(__file__).resolve().parents[1]
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afoQAAAAASUVORK5CYII=')

class GalleryTest(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.TemporaryDirectory()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.url = f'http://127.0.0.1:{self.port}'
        self.env = dict(os.environ, PORT=str(self.port), GALLERY_DATA_DIR=self.data.name, GALLERY_ADMIN_PASSWORD='test-only-password')
        self.start()

    def start(self):
        self.process = subprocess.Popen([sys.executable, 'server.py'], cwd=ROOT, env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(80):
            try:
                self.request('/api/artworks')
                return
            except OSError:
                if self.process.poll() is not None:
                    self.fail('Server exited before becoming ready')
                time.sleep(.05)
        self.fail('Server did not become ready')

    def tearDown(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.data.cleanup()

    def request(self, path, payload=None, password=None):
        headers = {}
        if password is not None:
            headers['Authorization'] = 'Bearer ' + password
        body = None if payload is None else json.dumps(payload).encode()
        try:
            response = urllib.request.urlopen(urllib.request.Request(self.url + path, data=body, headers=headers), timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    def artwork(self, **changes):
        return dict(title='고요한 아침', artist='김화가', year='2026', description='<script>untrusted</script>', image=base64.b64encode(PNG).decode(), **changes)

    def test_heic_container_detection_does_not_trust_extension(self):
        self.assertTrue(is_heif(b'\x00\x00\x00\x18ftypheic' + b'\x00' * 12))
        self.assertTrue(is_heif(b'\x00\x00\x00\x18ftypmif1' + b'\x00' * 12))
        self.assertFalse(is_heif(PNG))
        self.assertFalse(is_heif(b'not really a heic'))

    def test_admin_upload_public_read_and_restart(self):
        payload = self.artwork()
        self.assertEqual(self.request('/api/artworks', payload)[0], 401)
        self.assertEqual(self.request('/api/artworks', payload, 'wrong')[0], 401)
        self.assertEqual(self.request('/api/artworks', payload, 'test-only-password')[0], 201)
        status, body, _ = self.request('/api/artworks')
        self.assertEqual(status, 200)
        rows = json.loads(body)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], payload['title'])
        status, body, headers = self.request(rows[0]['image'])
        self.assertEqual(status, 200)
        self.assertEqual(body, PNG)
        self.assertEqual(headers['Content-Type'], 'image/png')
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        self.assertEqual(len(json.loads(self.request('/api/artworks')[1])), 1)

    def test_reject_invalid_data_and_path_traversal(self):
        payload = self.artwork()
        payload['image'] = base64.b64encode(b'<svg/>').decode()
        self.assertEqual(self.request('/api/artworks', payload, 'test-only-password')[0], 400)
        payload['image'] = 'invalid base64'
        self.assertEqual(self.request('/api/artworks', payload, 'test-only-password')[0], 400)
        payload = self.artwork()
        payload['title'] = ''
        self.assertEqual(self.request('/api/artworks', payload, 'test-only-password')[0], 400)
        self.assertEqual(self.request('/images/../admin-password')[0], 404)
        self.assertEqual(self.request('/.gallery/admin-password')[0], 404)
        self.assertEqual(json.loads(self.request('/api/artworks')[1]), [])

    def test_frontend_resources(self):
        for path in ['/', '/app.js', '/style.css', '/gallery-rules.js', '/exhibitions', '/exhibitions.js', '/contact', '/contact.js']:
            status, body, headers = self.request(path)
            self.assertEqual(status, 200)
            self.assertTrue(body)
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')

    def test_series_saved_validated_and_retained_after_restart(self):
        payload = self.artwork(series='빛의 기록')
        self.assertEqual(self.request('/api/artworks', payload, 'test-only-password')[0], 201)
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        self.assertEqual(json.loads(self.request('/api/artworks')[1])[0]['series'], '빛의 기록')
        payload['series'] = 'x' * 121
        self.assertEqual(self.request('/api/artworks', payload, 'test-only-password')[0], 400)

    def test_existing_gallery_is_migrated_without_losing_artworks(self):
        self.assertEqual(self.request('/api/artworks', self.artwork(), 'test-only-password')[0], 201)
        self.process.terminate()
        self.process.wait(timeout=5)
        with sqlite3.connect(Path(self.data.name) / 'gallery.sqlite3') as db:
            for column in ['series', 'medium', 'price', 'dimensions', 'canvas_size']:
                db.execute(f'ALTER TABLE artworks DROP COLUMN {column}')
        self.start()
        rows = json.loads(self.request('/api/artworks')[1])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], '고요한 아침')
        self.assertEqual(rows[0]['series'], '')
        for column in ['medium', 'price', 'dimensions', 'canvas_size']:
            self.assertEqual(rows[0][column], '')

    def test_artwork_metadata_persists_and_rejects_invalid_fields(self):
        details = dict(medium='Acrylic on canvas', price='₩1,500,000', dimensions='53 × 45.5 cm', canvas_size='10호 F')
        payload = self.artwork(**details)
        self.assertEqual(self.request('/api/artworks', payload, 'test-only-password')[0], 201)
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        row = json.loads(self.request('/api/artworks')[1])[0]
        for key, value in details.items():
            self.assertEqual(row[key], value)
        for key, invalid in [('medium', 'x' * 161), ('price', {'amount': 1}), ('dimensions', 'x' * 121), ('canvas_size', 'x' * 41)]:
            with self.subTest(key=key):
                self.assertEqual(self.request('/api/artworks', dict(payload, **{key: invalid}), 'test-only-password')[0], 400)

    def test_rename_series_updates_all_works_and_rejects_collisions(self):
        for series in ['Series 01', 'Series 01', 'Series 02']:
            self.assertEqual(self.request('/api/artworks', self.artwork(series=series), 'test-only-password')[0], 201)
        change = {'source': 'Series 01', 'target': '빛의 기록'}
        self.assertEqual(self.request('/api/series/rename', change)[0], 401)
        self.assertEqual(self.request('/api/series/rename', change, 'test-only-password')[0], 200)
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        rows = json.loads(self.request('/api/artworks')[1])
        self.assertEqual(sum(row['series'] == '빛의 기록' for row in rows), 2)
        self.assertEqual(sum(row['series'] == 'Series 02' for row in rows), 1)
        for source, target, status in [('빛의 기록', 'Series 02', 409), ('빛의 기록', '  ', 400), ('없는 시리즈', '새 시리즈', 404)]:
            with self.subTest(source=source, target=target):
                self.assertEqual(self.request('/api/series/rename', {'source': source, 'target': target}, 'test-only-password')[0], status)

    def test_exhibition_dates_are_validated_and_saved(self):
        item = dict(title='빛의 기록', venue='갤러리', start_date='2026-10-20', end_date='2026-10-24', description='전시 소개')
        self.assertEqual(self.request('/api/exhibitions', item)[0], 401)
        self.assertEqual(self.request('/api/exhibitions', item, 'test-only-password')[0], 201)
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        rows = json.loads(self.request('/api/exhibitions')[1])
        self.assertEqual(len(rows), 1)
        for key, value in item.items():
            self.assertEqual(rows[0][key], value)
        self.assertEqual(rows[0]['image'], '')
        for change in [dict(end_date='2026-10-19'), dict(start_date='2026-02-30'), dict(end_date='20261024'), dict(title='')]:
            with self.subTest(change=change):
                self.assertEqual(self.request('/api/exhibitions', dict(item, **change), 'test-only-password')[0], 400)

    def test_exhibition_representative_image_is_validated_stored_and_served(self):
        item = dict(title='이미지가 있는 전시', venue='갤러리', start_date='2026-10-20', end_date='2026-10-24', description='전시 소개', image=base64.b64encode(PNG).decode())
        status, body, _ = self.request('/api/exhibitions', item, 'test-only-password')
        self.assertEqual(status, 201)
        identifier = json.loads(body)['id']
        row = next(item for item in json.loads(self.request('/api/exhibitions')[1]) if item['id'] == identifier)
        self.assertTrue(row['image'].startswith('/images/exhibition-'))
        status, body, headers = self.request(row['image'])
        self.assertEqual(status, 200)
        self.assertEqual(body, PNG)
        self.assertEqual(headers['Content-Type'], 'image/png')
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        row = next(item for item in json.loads(self.request('/api/exhibitions')[1]) if item['id'] == identifier)
        self.assertTrue(row['image'].startswith('/images/exhibition-'))
        for invalid in ['invalid base64', base64.b64encode(b'<svg/>').decode()]:
            with self.subTest(image=invalid):
                self.assertEqual(self.request('/api/exhibitions', dict(item, image=invalid), 'test-only-password')[0], 400)

    def test_existing_exhibitions_are_migrated_without_losing_records(self):
        item = dict(title='기존 전시', venue='갤러리', start_date='2026-10-20', end_date='2026-10-24', description='전시 소개')
        self.assertEqual(self.request('/api/exhibitions', item, 'test-only-password')[0], 201)
        self.process.terminate()
        self.process.wait(timeout=5)
        with sqlite3.connect(Path(self.data.name) / 'gallery.sqlite3') as db:
            db.execute('ALTER TABLE exhibitions DROP COLUMN image')
        self.start()
        rows = json.loads(self.request('/api/exhibitions')[1])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], item['title'])
        self.assertEqual(rows[0]['image'], '')

    def test_export_preview_embeds_local_exhibition_images(self):
        with tempfile.TemporaryDirectory() as directory:
            preview_root = Path(directory)
            shutil.copy(ROOT / 'export_preview.py', preview_root / 'export_preview.py')
            shutil.copytree(ROOT / 'static', preview_root / 'static')
            images = preview_root / '.gallery' / 'images'
            images.mkdir(parents=True)
            (images / 'exhibition.png').write_bytes(PNG)
            with sqlite3.connect(preview_root / '.gallery' / 'gallery.sqlite3') as db:
                db.execute('CREATE TABLE artworks (id TEXT PRIMARY KEY, created_at TEXT)')
                db.execute('CREATE TABLE exhibitions (id TEXT PRIMARY KEY, title TEXT, venue TEXT, start_date TEXT, end_date TEXT, description TEXT, image TEXT)')
                db.execute("INSERT INTO exhibitions VALUES ('show','전시','갤러리','2026-10-20','2026-10-24','','/images/exhibition.png')")
            subprocess.run([sys.executable, 'export_preview.py'], cwd=preview_root, check=True, capture_output=True)
            preview = (preview_root / 'gallery-preview.html').read_text()
            encoded = base64.b64encode(PNG).decode()
            self.assertIn('data:image/png;base64,' + encoded, preview)
            self.assertNotIn('/images/exhibition.png', preview)

    def test_edit_artwork_preserves_image_and_identity_and_requires_admin(self):
        payload = self.artwork(series='Series 01', medium='Acrylic on canvas', price='가격 문의')
        status, body, _ = self.request('/api/artworks', payload, 'test-only-password')
        identifier = json.loads(body)['id']
        original = json.loads(self.request('/api/artworks')[1])[0]
        change = dict(payload, id=identifier, title='수정한 작품', series='새 시리즈', price='₩1,000,000')
        del change['image']
        self.assertEqual(self.request('/api/artworks/update', change)[0], 401)
        self.assertEqual(self.request('/api/artworks/update', change, 'test-only-password')[0], 200)
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        rows = json.loads(self.request('/api/artworks')[1])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['id'], identifier)
        self.assertEqual(rows[0]['image'], original['image'])
        self.assertEqual(rows[0]['title'], '수정한 작품')
        self.assertEqual(rows[0]['series'], '새 시리즈')
        self.assertEqual(rows[0]['price'], '₩1,000,000')
        self.assertEqual(self.request('/api/artworks/update', dict(change, image='invalid'), 'test-only-password')[0], 400)
        self.assertEqual(self.request('/api/artworks/update', dict(change, id='missing'), 'test-only-password')[0], 404)
        self.assertEqual(self.request('/api/artworks/update', dict(change, image=payload['image']), 'test-only-password')[0], 200)
        self.assertNotEqual(json.loads(self.request('/api/artworks')[1])[0]['image'], original['image'])

    def test_visitor_messages_are_saved_but_only_admin_can_read(self):
        message = dict(name='방문객', reply_to='reply@example.com', message='<script>비공개 문의</script>')
        self.assertEqual(self.request('/api/messages', message)[0], 201)
        for password in [None, 'wrong']:
            status, body, _ = self.request('/api/messages', password=password)
            self.assertEqual(status, 401)
            self.assertNotIn('비공개 문의', body.decode())
            self.assertNotIn('reply@example.com', body.decode())
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        status, body, headers = self.request('/api/messages', password='test-only-password')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        rows = json.loads(body)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['message'], message['message'])
        for invalid in ['', ' ' * 5, 'x' * 4001, {'text': 'invalid'}]:
            self.assertEqual(self.request('/api/messages', dict(message, message=invalid))[0], 400)

    def test_series_notes_require_admin_persist_and_follow_renaming(self):
        self.assertEqual(self.request('/api/artworks', self.artwork(series='Relation'), 'test-only-password')[0], 201)
        note = {'series': 'Relation', 'note': '첫 문단\n\n두 번째 문단 <script>그대로 표시</script>'}
        self.assertEqual(self.request('/api/series-notes', note)[0], 401)
        self.assertEqual(self.request('/api/series-notes', note, 'test-only-password')[0], 200)
        self.process.terminate()
        self.process.wait(timeout=5)
        self.start()
        notes = json.loads(self.request('/api/series-notes')[1])
        self.assertEqual(notes['Relation'], note['note'])
        self.assertEqual(self.request('/api/series/rename', {'source':'Relation','target':'관계'}, 'test-only-password')[0], 200)
        notes = json.loads(self.request('/api/series-notes')[1])
        self.assertNotIn('Relation', notes)
        self.assertEqual(notes['관계'], note['note'])
        self.assertEqual(self.request('/api/series-notes', {'series':'관계','note':'x'*20001}, 'test-only-password')[0], 400)
        self.assertEqual(self.request('/api/series-notes', {'series':'없는 시리즈','note':'글'}, 'test-only-password')[0], 404)

if __name__ == '__main__':
    unittest.main()
