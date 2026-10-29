const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function uploader(fetch) {
  const context = {window: {}, fetch, FileReader: class { constructor() { throw Error('Large images must not be base64 encoded'); } }};
  vm.runInNewContext(fs.readFileSync('static/gallery-upload.js', 'utf8'), context);
  return context.window.GalleryUpload;
}

test('10MB goes directly to signed storage without forwarding the admin password', async () => {
  const calls = [];
  const upload = uploader(async (url, options) => {
    calls.push({url, options});
    return {ok: true, json: async () => ({direct: true, url: 'https://storage.example/upload?token=scoped', upload_token: 'ticket'})};
  });
  const file = {size: 10_000_000, type: 'image/jpeg'}, status = {};
  const result = await upload.image(file, 'admin-password', status);
  assert.equal(result.upload_token, 'ticket');
  assert.equal(calls[0].url, '/api/images/sign');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-password');
  assert.equal(calls[1].options.method, 'PUT');
  assert.equal(calls[1].options.body, file);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.ok(!JSON.stringify(result).includes('admin-password'));
});

test('oversize or empty files do not start an upload', async () => {
  const upload = uploader(() => { throw Error('should not fetch'); });
  for (const size of [0, 10_000_001]) await assert.rejects(upload.image({size}, 'pw'), /10MB/);
});

test('failed authentication stops before sending the image', async () => {
  let calls = 0;
  const upload = uploader(async () => { calls++; return {ok: false, json: async () => ({error: '관리자 비밀번호를 확인해 주세요.'})}; });
  await assert.rejects(upload.image({size: 5_000_000}, 'wrong'), /비밀번호/);
  assert.equal(calls, 1);
});

test('failed storage upload never returns a completed image reference', async () => {
  let calls = 0;
  const upload = uploader(async () => ++calls === 1
    ? {ok: true, json: async () => ({direct: true, url: 'https://storage.example', upload_token: 'ticket'})}
    : {ok: false});
  await assert.rejects(upload.image({size: 5_000_000}, 'pw'), /사진 업로드에 실패/);
});
