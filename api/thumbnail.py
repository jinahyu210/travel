"""Public image function; deliberately independent of database initialization."""
import hashlib
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

from image_delivery import thumbnail_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = parse_qs(urlsplit(self.path).query).get('route', [None])[0]
        path = '/api/thumbnails/' + route if route is not None else self.path
        status, body, mime, cache = thumbnail_response(path)
        etag = '"' + hashlib.sha256(body).hexdigest() + '"' if status == 200 else None
        if etag and self.headers.get('If-None-Match') == etag:
            status, body = 304, b''
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        if etag:
            self.send_header('ETag', etag)
        if status != 304:
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_HEAD = do_GET
