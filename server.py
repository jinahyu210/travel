"""Small, dependency-free gallery. Run with Python 3.12+."""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import secrets
import sqlite3
from io import BytesIO
from datetime import date
from contextlib import contextmanager
from threading import Lock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent
CLOUD = bool(os.environ.get('VERCEL') or os.environ.get('SUPABASE_DB_URL'))
MAX_IMAGE_BYTES = 3_000_000

def is_heif(raw):
    """Recognize HEIC/HEIF containers without trusting the file extension."""
    return (len(raw) >= 12 and raw[4:8] == b'ftyp' and
            raw[8:12] in {b'heic', b'heix', b'hevc', b'hevx', b'heim', b'heis', b'mif1', b'msf1'})

def convert_heif(raw):
    """Convert HEIC/HEIF to a browser-safe JPEG within the storage limit."""
    from PIL import Image, ImageOps
    from pillow_heif import register_heif_opener
    register_heif_opener()
    Image.MAX_IMAGE_PIXELS = 60_000_000
    with Image.open(BytesIO(raw)) as source:
        source.load()
        image = ImageOps.exif_transpose(source)
        if image.mode != 'RGB':
            if 'A' in image.getbands():
                background = Image.new('RGB', image.size, 'white')
                background.paste(image, mask=image.getchannel('A'))
                image = background
            else:
                image = image.convert('RGB')
        for quality in (90, 85, 80, 75, 68):
            output = BytesIO()
            image.save(output, 'JPEG', quality=quality, optimize=True)
            if output.tell() <= MAX_IMAGE_BYTES:
                return output.getvalue()
        image.thumbnail((4000, 4000))
        output = BytesIO()
        image.save(output, 'JPEG', quality=75, optimize=True)
        converted = output.getvalue()
        if len(converted) > MAX_IMAGE_BYTES:
            raise ValueError('converted image is too large')
        return converted
if CLOUD:
    for key in ['SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GALLERY_ADMIN_PASSWORD']:
        if not os.environ.get(key):
            raise RuntimeError(f'Missing required server configuration: {key}')
    from cloud_backend import database as connect_database, save_image, remove_image, supabase_url, StorageAuthenticationError, schema_ready
    PASSWORD = os.environ['GALLERY_ADMIN_PASSWORD']
else:
    DATA = Path(os.environ.get('GALLERY_DATA_DIR', ROOT / '.gallery')).resolve()
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'images').mkdir(exist_ok=True)
    password_file = DATA / 'admin-password'
    if not os.environ.get('GALLERY_ADMIN_PASSWORD') and not password_file.exists():
        fd = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_urlsafe(24))
    PASSWORD = os.environ.get('GALLERY_ADMIN_PASSWORD') or password_file.read_text().strip()

    def connect_database():
        db = sqlite3.connect(DATA / 'gallery.sqlite3')
        db.row_factory = sqlite3.Row
        return db
if not PASSWORD:
    raise RuntimeError('Administrator password must not be empty')

def initialize_database(db):
    if CLOUD and schema_ready(db):
        return
    if CLOUD:
        db.execute('SELECT pg_advisory_xact_lock(73190421)')
    db.execute('CREATE TABLE IF NOT EXISTS series_notes (series TEXT PRIMARY KEY, note TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, name TEXT NOT NULL, reply_to TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)')
    db.execute("CREATE TABLE IF NOT EXISTS exhibitions (id TEXT PRIMARY KEY, title TEXT NOT NULL, venue TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL DEFAULT '')")
    db.execute('CREATE TABLE IF NOT EXISTS artworks (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, year TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)')
    columns = ({row['column_name'] for row in db.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='artworks'")} if CLOUD else {row['name'] for row in db.execute('PRAGMA table_info(artworks)')})
    for column in ['series', 'medium', 'price', 'dimensions', 'canvas_size']:
        if column not in columns:
            db.execute(f"ALTER TABLE artworks ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
    exhibition_columns = ({row['column_name'] for row in db.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='exhibitions'")} if CLOUD else {row['name'] for row in db.execute('PRAGMA table_info(exhibitions)')})
    if 'image' not in exhibition_columns:
        db.execute("ALTER TABLE exhibitions ADD COLUMN image TEXT NOT NULL DEFAULT ''")
    if CLOUD:
        for table in ['artworks', 'exhibitions', 'series_notes', 'messages']:
            db.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
            db.execute(f'REVOKE ALL ON TABLE {table} FROM anon, authenticated')


_schema_ready = False
_schema_lock = Lock()


@contextmanager
def database_transaction():
    connection = connect_database()
    try:
        with connection as db:
            yield db
    finally:
        # SQLite's transaction context commits/rolls back, but does not close.
        if not CLOUD:
            connection.close()


@contextmanager
def database():
    """Initialize once, using the first request's connection rather than a cold-start connection."""
    global _schema_ready
    if _schema_ready:
        with database_transaction() as db:
            yield db
        return
    # Keep concurrent first requests from observing a migration before it commits.
    with _schema_lock:
        with database_transaction() as db:
            if not _schema_ready:
                initialize_database(db)
            yield db
        _schema_ready = True


class ImageValidationError(Exception):
    pass


class ImageStorageError(Exception):
    pass


def save_uploaded_image(encoded, prefix=''):
    if not isinstance(encoded, str):
        raise ImageValidationError('이미지 파일을 다시 선택해 주세요.')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ImageValidationError('이미지 파일을 읽지 못했습니다. 다시 선택해 주세요.') from None
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ImageValidationError('이미지는 3MB 이하로 올려 주세요.')
    if is_heif(raw):
        try:
            raw = convert_heif(raw)
        except (OSError, ValueError):
            raise ImageValidationError('HEIC 이미지를 변환하지 못했습니다. 원본 사진을 다시 선택해 주세요.') from None
        extension = '.jpg'
    elif raw.startswith(b'\x89PNG\r\n\x1a\n'):
        extension = '.png'
    elif raw.startswith(b'\xff\xd8\xff'):
        extension = '.jpg'
    elif raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
        extension = '.webp'
    else:
        raise ImageValidationError('JPG, PNG, WebP, HEIC 이미지만 지원합니다.')
    filename = prefix + secrets.token_hex(16) + extension
    if CLOUD:
        mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'}[extension]
        try:
            return save_image(filename, raw, mime), filename
        except StorageAuthenticationError:
            raise ImageStorageError('사진 저장소 인증 설정을 확인해 주세요.') from None
        except HTTPError as error:
            if error.code in (401, 403):
                raise ImageStorageError('사진 저장소 인증 설정을 확인해 주세요.') from None
            raise ImageStorageError(f'사진 저장소 연결 오류가 발생했습니다. ({error.code})') from None
        except (ValueError, TypeError, URLError):
            raise ImageStorageError('사진 저장소 주소 설정을 확인해 주세요.') from None
    image_path = DATA / 'images' / filename
    image_path.write_bytes(raw)
    return '/images/' + filename, image_path


def discard_uploaded_image(image_path):
    if not image_path:
        return
    try:
        if CLOUD:
            remove_image(image_path)
        else:
            image_path.unlink(missing_ok=True)
    except Exception:
        # Cleanup must not hide the database error that prevented the record.
        pass


def discard_existing_image(image_url, prefix):
    """Best-effort deletion limited to files named and stored by this app."""
    if not isinstance(image_url, str):
        return
    parsed = urlsplit(image_url)
    filename = Path(parsed.path).name
    if not re.fullmatch(re.escape(prefix) + r'[0-9a-f]{32}\.(?:png|jpg|webp)', filename):
        return
    try:
        if CLOUD:
            if (parsed.scheme != 'https' or parsed.netloc != urlsplit(supabase_url()).netloc or
                    parsed.path != '/storage/v1/object/public/gallery-artworks/' + filename):
                return
            remove_image(filename)
        elif image_url == '/images/' + filename:
            (DATA / 'images' / filename).unlink(missing_ok=True)
    except Exception:
        # The edited database row is valid even if old-file cleanup is delayed.
        pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Do not log request headers, passwords, or image data.
        super().log_message(fmt, *args)

    def respond(self, status, body, content_type='application/json; charset=utf-8', cache_control='no-store'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        etag = None
        if status == 200 and cache_control != 'no-store':
            etag = '"' + hashlib.sha256(body).hexdigest() + '"'
            candidates = [item.strip().removeprefix('W/') for item in self.headers.get('If-None-Match', '').split(',')]
            if etag in candidates or '*' in candidates:
                status = 304
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        if status != 304:
            self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', cache_control)
        if etag:
            self.send_header('ETag', etag)
        image_source = urlsplit(os.environ.get('SUPABASE_URL', '')).netloc
        remote_images = f' https://{image_source}' if CLOUD and image_source else ''
        self.send_header('Content-Security-Policy', f"default-src 'self'; img-src 'self' blob:{remote_images}; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        if status != 304:
            self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        public_cache = 'public, max-age=0, must-revalidate'
        if path == '/api/gallery':
            with database() as db:
                rows = [dict(row) for row in db.execute('SELECT * FROM artworks ORDER BY created_at DESC, rowid DESC')]
                notes = {row['series']: row['note'] for row in db.execute('SELECT series,note FROM series_notes')}
            return self.respond(200, {'artworks': rows, 'seriesNotes': notes}, cache_control=public_cache)
        if path == '/api/series-notes':
            with database() as db:
                notes = {row['series']: row['note'] for row in db.execute('SELECT series,note FROM series_notes')}
            return self.respond(200, notes, cache_control=public_cache)
        if path == '/api/messages':
            supplied = self.headers.get('Authorization', '').removeprefix('Bearer ')
            if not hmac.compare_digest(hashlib.sha256(supplied.encode()).digest(), hashlib.sha256(PASSWORD.encode()).digest()):
                return self.respond(401, {'error': '관리자 비밀번호를 확인해 주세요.'})
            with database() as db:
                rows = [dict(row) for row in db.execute('SELECT * FROM messages ORDER BY created_at DESC, rowid DESC')]
            return self.respond(200, rows)
        if path == '/api/exhibitions':
            with database() as db:
                rows = [dict(row) for row in db.execute('SELECT * FROM exhibitions ORDER BY start_date DESC, rowid DESC')]
            return self.respond(200, rows, cache_control=public_cache)
        if path == '/api/artworks':
            with database() as db:
                rows = [dict(row) for row in db.execute('SELECT * FROM artworks ORDER BY created_at DESC, rowid DESC')]
            return self.respond(200, rows, cache_control=public_cache)
        static = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
        static.update({'/exhibitions': ('exhibitions.html', 'text/html; charset=utf-8'), '/exhibitions.html': ('exhibitions.html', 'text/html; charset=utf-8'), '/exhibitions.css': ('exhibitions.css', 'text/css; charset=utf-8')})
        static.update({f'/{name}': (name, 'text/javascript; charset=utf-8') for name in ['gallery-rules.js', 'gallery-images.js', 'exhibitions.js']})
        static.update({'/contact': ('contact.html', 'text/html; charset=utf-8'), '/contact.html': ('contact.html', 'text/html; charset=utf-8')})
        static['/contact.js'] = ('contact.js', 'text/javascript; charset=utf-8')
        if path in static:
            name, mime = static[path]
            return self.respond(200, (ROOT / 'static' / name).read_bytes(), mime, cache_control=public_cache)
        if not CLOUD and path.startswith('/api/thumbnails/'):
            from image_delivery import thumbnail_response
            status, body, mime, cache_control = thumbnail_response(path, DATA / 'images')
            return self.respond(status, body, mime, cache_control=cache_control)
        if not CLOUD and path.startswith('/images/'):
            name = path.removeprefix('/images/')
            if '/' not in name and name.endswith(('.png', '.jpg', '.webp')):
                file = DATA / 'images' / name
                if file.is_file():
                    return self.respond(200, file.read_bytes(), {'.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'}[file.suffix], cache_control='public, max-age=31536000, immutable')
        self.respond(404, {'error': '찾을 수 없습니다.'})

    def do_POST(self):
        if self.path == '/api/messages':
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size <= 0 or size > 32000:
                    return self.respond(413, {'error': '메모는 4,000자 이내로 작성해 주세요.'})
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    raise ValueError()
                fields = {}
                for key, limit in [('name', 80), ('reply_to', 200), ('message', 4000)]:
                    value = payload.get(key, '')
                    if not isinstance(value, str) or len(value) > limit:
                        raise ValueError()
                    fields[key] = value.strip()
                if not fields['message']:
                    raise ValueError()
                with database() as db:
                    db.execute('INSERT INTO messages (id,name,reply_to,message) VALUES (?,?,?,?)', (secrets.token_hex(16), fields['name'], fields['reply_to'], fields['message']))
                return self.respond(201, {'status': 'received'})
            except (ValueError, KeyError, TypeError):
                return self.respond(400, {'error': '메모 내용을 확인해 주세요. 최대 4,000자까지 입력할 수 있습니다.'})
        if self.path not in ['/api/artworks', '/api/artworks/update', '/api/series/rename', '/api/exhibitions', '/api/exhibitions/update', '/api/series-notes']:
            return self.respond(404, {'error': '찾을 수 없습니다.'})
        supplied = self.headers.get('Authorization', '').removeprefix('Bearer ')
        if not hmac.compare_digest(hashlib.sha256(supplied.encode()).digest(), hashlib.sha256(PASSWORD.encode()).digest()):
            return self.respond(401, {'error': '관리자 비밀번호를 확인해 주세요.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 4_100_000:
                return self.respond(413, {'error': '이미지는 3MB 이하로 올려 주세요.'})
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError()
            if self.path == '/api/series-notes':
                series, note = payload.get('series'), payload.get('note')
                if not isinstance(series, str) or not series.strip() or len(series) > 120 or not isinstance(note, str) or len(note) > 20000:
                    return self.respond(400, {'error': '시리즈를 선택하고 작가노트를 20,000자 이내로 입력해 주세요.'})
                series = series.strip()
                with database() as db:
                    if not db.execute("SELECT 1 FROM artworks WHERE COALESCE(NULLIF(trim(series),''),'Works')=?", (series,)).fetchone():
                        return self.respond(404, {'error': '해당 시리즈를 찾을 수 없습니다.'})
                    db.execute('INSERT INTO series_notes (series,note) VALUES (?,?) ON CONFLICT(series) DO UPDATE SET note=excluded.note', (series, note.strip()))
                return self.respond(200, {'series': series})
            if self.path in ['/api/exhibitions', '/api/exhibitions/update']:
                exhibition = {}
                for key, limit in [('title', 200), ('venue', 200), ('start_date', 10), ('end_date', 10), ('description', 2000)]:
                    value = payload.get(key, '')
                    if not isinstance(value, str) or len(value) > limit:
                        return self.respond(400, {'error': '전시 정보를 확인해 주세요.'})
                    exhibition[key] = value.strip()
                try:
                    start = date.fromisoformat(exhibition['start_date'])
                    end = date.fromisoformat(exhibition['end_date'])
                    valid = start.isoformat() == exhibition['start_date'] and end.isoformat() == exhibition['end_date'] and start <= end
                except ValueError:
                    valid = False
                if not valid or not exhibition['title'] or not exhibition['venue']:
                    return self.respond(400, {'error': '전시명, 장소와 올바른 시작일·종료일을 입력해 주세요.'})
                existing = None
                if self.path == '/api/exhibitions/update':
                    identifier = payload.get('id')
                    if not isinstance(identifier, str) or not identifier or len(identifier) > 100:
                        return self.respond(400, {'error': '수정할 전시를 확인해 주세요.'})
                    with database() as db:
                        existing = db.execute('SELECT * FROM exhibitions WHERE id=?', (identifier,)).fetchone()
                    if existing is None:
                        return self.respond(404, {'error': '수정할 전시를 찾을 수 없습니다.'})
                else:
                    identifier = secrets.token_hex(16)
                image_path = None
                image_url = existing['image'] if existing else ''
                if 'image' in payload:
                    try:
                        image_url, image_path = save_uploaded_image(payload['image'], 'exhibition-')
                    except ImageValidationError as error:
                        return self.respond(400, {'error': str(error)})
                    except ImageStorageError as error:
                        return self.respond(502, {'error': str(error)})
                try:
                    with database() as db:
                        values = (exhibition['title'], exhibition['venue'], exhibition['start_date'], exhibition['end_date'], exhibition['description'], image_url)
                        if existing:
                            db.execute('UPDATE exhibitions SET title=?,venue=?,start_date=?,end_date=?,description=?,image=? WHERE id=?', values + (identifier,))
                        else:
                            db.execute('INSERT INTO exhibitions (id,title,venue,start_date,end_date,description,image) VALUES (?,?,?,?,?,?,?)', (identifier,) + values)
                except Exception:
                    discard_uploaded_image(image_path)
                    raise
                if existing and image_path:
                    discard_existing_image(existing['image'], 'exhibition-')
                return self.respond(200 if existing else 201, {'id': identifier})
            if self.path == '/api/series/rename':
                source, target = payload.get('source'), payload.get('target')
                if not isinstance(source, str) or not isinstance(target, str) or len(source) > 120 or len(target) > 120 or not target.strip():
                    return self.respond(400, {'error': '새 시리즈 제목을 120자 이내로 입력해 주세요.'})
                source, target = source.strip(), target.strip()
                with database() as db:
                    if not db.execute('SELECT 1 FROM artworks WHERE trim(series)=?', (source,)).fetchone():
                        return self.respond(404, {'error': '해당 시리즈를 찾을 수 없습니다.'})
                    if source != target and db.execute('SELECT 1 FROM artworks WHERE trim(series)=?', (target,)).fetchone():
                        return self.respond(409, {'error': '이미 있는 시리즈 제목입니다. 다른 이름을 입력해 주세요.'})
                    note_source = source or 'Works'
                    if note_source != target and db.execute('SELECT 1 FROM series_notes WHERE series=?', (note_source,)).fetchone():
                        if db.execute('SELECT 1 FROM series_notes WHERE series=?', (target,)).fetchone():
                            return self.respond(409, {'error': '같은 이름의 작가노트가 있습니다. 다른 시리즈 이름을 입력해 주세요.'})
                        db.execute('UPDATE series_notes SET series=? WHERE series=?', (target, note_source))
                    db.execute('UPDATE artworks SET series=? WHERE trim(series)=?', (target, source))
                return self.respond(200, {'series': target})
            fields = {}
            for key, limit in [('title', 120), ('artist', 120), ('series', 120), ('year', 20), ('medium', 160), ('price', 80), ('dimensions', 120), ('canvas_size', 40), ('description', 2000)]:
                value = payload.get(key, '')
                if not isinstance(value, str) or len(value) > limit:
                    raise ValueError()
                fields[key] = value.strip()
            if not fields['title']:
                return self.respond(400, {'error': '작품명을 입력해 주세요.'})
            if not fields['artist']:
                return self.respond(400, {'error': '작가명을 확인해 주세요.'})
            existing = None
            if self.path == '/api/artworks/update':
                identifier = payload.get('id')
                if not isinstance(identifier, str) or not identifier or len(identifier) > 100:
                    return self.respond(400, {'error': '수정할 작품을 확인해 주세요.'})
                with database() as db:
                    existing = db.execute('SELECT * FROM artworks WHERE id=?', (identifier,)).fetchone()
                if existing is None:
                    return self.respond(404, {'error': '수정할 작품을 찾을 수 없습니다.'})
            image_path = None
            image_url = existing['image'] if existing else None
            if 'image' in payload:
                try:
                    image_url, image_path = save_uploaded_image(payload['image'])
                except ImageValidationError as error:
                    return self.respond(400, {'error': str(error)})
                except ImageStorageError as error:
                    return self.respond(502, {'error': str(error)})
            elif existing is None:
                return self.respond(400, {'error': '작품 이미지를 선택해 주세요.'})
            artwork_id = existing['id'] if existing else secrets.token_hex(16)
            values = (fields['title'], fields['artist'], fields['series'], fields['year'], fields['medium'], fields['price'], fields['dimensions'], fields['canvas_size'], fields['description'], image_url)
            try:
                with database() as db:
                    if existing:
                        db.execute('UPDATE artworks SET title=?,artist=?,series=?,year=?,medium=?,price=?,dimensions=?,canvas_size=?,description=?,image=? WHERE id=?', values + (artwork_id,))
                    else:
                        db.execute('INSERT INTO artworks (id,title,artist,series,year,medium,price,dimensions,canvas_size,description,image) VALUES (?,?,?,?,?,?,?,?,?,?,?)', (artwork_id,) + values)
            except Exception:
                discard_uploaded_image(image_path)
                raise
            self.respond(200 if existing else 201, {'id': artwork_id})
        except (ValueError, KeyError, TypeError):
            self.respond(400, {'error': '작품명, 작가명과 올바른 이미지를 입력해 주세요.'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '3000'))
    print(f'Gallery listening on port {port}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
