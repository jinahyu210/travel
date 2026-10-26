/* List images are lightweight derivatives; detail views retain the originals. */
(function (root) {
  function thumbnailPath(source) {
    if (root.galleryStore || !source || /^(?:data|blob):/.test(source)) return null;
    let url;
    try { url = new URL(source, root.location.href); } catch { return null; }
    const local = url.origin === root.location.origin && url.pathname.startsWith('/images/');
    const storage = url.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname)
      && url.pathname.startsWith('/storage/v1/object/public/gallery-artworks/');
    if ((!local && !storage) || url.search || url.hash) return null;
    const filename = url.pathname.split('/').pop();
    if (!/^(?:exhibition-)?[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(filename)) return null;
    const prefix = local ? '/images/' : '/storage/v1/object/public/gallery-artworks/';
    return url.pathname === prefix + filename ? filename : null;
  }

  function setSource(image, source, {priority = false} = {}) {
    image.decoding = 'async';
    image.loading = priority ? 'eager' : 'lazy';
    image.fetchPriority = priority ? 'high' : 'auto';
    const filename = thumbnailPath(source);
    if (filename) {
      image.addEventListener('error', () => {
        image.removeAttribute('srcset');
        image.src = source;
      }, {once: true});
      image.srcset = `/api/thumbnails/640/${filename} 1x, /api/thumbnails/1280/${filename} 2x`;
      image.src = `/api/thumbnails/640/${filename}`;
    } else image.src = source;
  }

  root.GalleryImages = {setSource};
})(globalThis);
