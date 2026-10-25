"""Supabase Postgres and Storage adapters; credentials stay on the server."""
import json
import os
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit


def environment_value(name):
    """Accept values copied from dashboards without retaining wrappers."""
    value = os.environ[name].strip()
    prefix = name + '='
    if value.startswith(prefix):
        value = value[len(prefix):].strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1].strip()
    if not value:
        raise ValueError(f'{name} is empty')
    return value


def supabase_url():
    try:
        value = environment_value('SUPABASE_URL').rstrip('/')
        parsed = urlsplit(value)
        if parsed.scheme == 'https' and parsed.netloc and not parsed.path and not parsed.query and not parsed.fragment:
            return value
    except (KeyError, ValueError):
        pass

    # Supabase pooler usernames are `postgres.<project-ref>`. This public
    # project reference lets us recover safely from a badly copied URL.
    try:
        database_url = environment_value('SUPABASE_DB_URL')
    except (KeyError, ValueError):
        raise ValueError('SUPABASE_URL must be an HTTPS project origin') from None
    username = urlsplit(database_url).username or ''
    match = re.fullmatch(r'postgres\.([a-z0-9]{15,40})', username)
    if not match:
        raise ValueError('SUPABASE_URL must be an HTTPS project origin')
    return f'https://{match.group(1)}.supabase.co'


def database():
    import psycopg
    from psycopg.rows import dict_row
    return Database(psycopg.connect(os.environ['SUPABASE_DB_URL'], row_factory=dict_row,
                                   prepare_threshold=None, connect_timeout=10, sslmode='require'))


class Database:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, *args):
        return self.connection.__exit__(*args)

    def execute(self, query, values=()):
        # Only application-owned SQL enters this adapter; values remain bound.
        query = query.replace('?', '%s').replace('rowid DESC', 'id DESC')
        return self.connection.execute(query, values)


def storage_request(path, data, method='POST', mime='application/json'):
    key = environment_value('SUPABASE_SERVICE_ROLE_KEY')
    url = supabase_url() + '/storage/v1/' + path
    request = Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': mime})
    with urlopen(request, timeout=30) as response:
        return response.read()


def save_image(filename, raw, mime):
    # Existing buckets respond 400/409. Check the bucket rather than swallowing errors.
    try:
        storage_request('bucket/gallery-artworks', None, 'GET')
    except HTTPError as error:
        if error.code not in (400, 404):
            raise
        try:
            storage_request('bucket', json.dumps({
                'id': 'gallery-artworks', 'name': 'gallery-artworks', 'public': True,
                'file_size_limit': 3000000,
                'allowed_mime_types': ['image/png', 'image/jpeg', 'image/webp']
            }).encode())
        except HTTPError as conflict:
            if conflict.code not in (400, 409):
                raise
            storage_request('bucket/gallery-artworks', None, 'GET')
    storage_request('object/gallery-artworks/' + filename, raw, mime=mime)
    return supabase_url() + '/storage/v1/object/public/gallery-artworks/' + filename


def remove_image(filename):
    storage_request('object/gallery-artworks', json.dumps({'prefixes': [filename]}).encode(), 'DELETE')
