"""Vercel Python function. Rewrite query preserves nested API routes."""
from urllib.parse import parse_qs, urlsplit
from server import Handler


class handler(Handler):
    def dispatch(self, method):
        route = parse_qs(urlsplit(self.path).query).get('route', [None])[0]
        if route is not None:
            self.path = '/api/' + route
        try:
            method(self)
        except Exception:
            # Never return database URLs, credentials or visitor messages in errors.
            self.respond(503, {'error': '저장소 연결을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'})

    def do_GET(self):
        self.dispatch(Handler.do_GET)

    def do_POST(self):
        self.dispatch(Handler.do_POST)
