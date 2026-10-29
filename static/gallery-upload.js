(() => {
  async function request(path, payload, password) {
    const response = await fetch(path, {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${password}`},
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다. 다시 시도해 주세요.');
    return result;
  }
  async function image(file, password, status) {
    if (!file.size || file.size > 10_000_000) throw new Error('이미지는 10MB 이하로 올려 주세요.');
    if (status) status.textContent = '사진 업로드 중…';
    // Large files go straight to private storage, below Vercel's request limit.
    if (!window.galleryStore && file.size > 3_000_000) {
      const signed = await request('/api/images/sign', {size: file.size}, password);
      if (signed.direct) {
        const response = await fetch(signed.url, {
          method: 'PUT', headers: {'Content-Type': file.type || 'application/octet-stream'}, body: file
        });
        if (!response.ok) throw new Error('사진 업로드에 실패했습니다. 연결을 확인하고 다시 시도해 주세요.');
        if (status) status.textContent = '사진 확인 및 저장 중…';
        return {upload_token: signed.upload_token};
      }
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('사진을 읽지 못했습니다. 다시 선택해 주세요.'));
      reader.readAsDataURL(file);
    });
  }
  window.GalleryUpload = {image, request};
})();
