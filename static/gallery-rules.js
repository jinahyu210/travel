(function(root) {
  // Korean canvas sizes in cm: number, long side, F/P/M short sides.
  const sizes = [
    [0,18,14,12,10],[1,22.7,15.8,14,12],[2,25.8,17.9,16,14],[3,27.3,22,19,16],
    [4,33.4,24.2,21.2,19],[5,34.8,27.3,24.2,21.2],[6,40.9,31.8,27.3,24.2],
    [8,45.5,37.9,33.4,27.3],[10,53,45.5,40.9,33.4],[12,60.6,50,45.5,40.9],
    [15,65.1,53,50,45.5],[20,72.7,60.6,53,50],[25,80.3,65.1,60.6,53],
    [30,90.9,72.7,65.1,60.6],[40,100,80.3,72.7,65.1],[50,116.8,91,80.3,72.7],
    [60,130.3,97,89.4,80.3],[80,145.5,112.1,97,89.4],[100,162.2,130.3,112.1,97]
  ];
  // Korean S sizes are a separate square chart, not the F long side.
  // 0호 S has no entry in this chart; custom dimensions remain available.
  const squareSides = new Map([
    [1,15.8],[2,17.9],[3,22],[4,24.2],[5,27.3],[6,31.8],[8,37.9],
    [10,45.5],[12,50],[15,53],[20,60.6],[25,65.1],[30,72.7],[40,80.3],
    [50,91],[60,97],[80,112.1],[100,130.3]
  ]);
  const canvasFormats = sizes.flatMap(([number, width, f, p, m]) => {
    const formats = [['F', f], ['P', p], ['M', m]].map(([type, height]) =>
      ({label: `${number}호 ${type}`, number, type, width, height}));
    if (squareSides.has(number)) {
      const side = squareSides.get(number);
      formats.push({label: `${number}호 S`, number, type: 'S', width: side, height: side});
    }
    return formats.map(Object.freeze);
  });
  function canvasSize(width, height) {
    if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return '';
    const long = Math.max(width, height), short = Math.min(width, height);
    for (const format of canvasFormats) {
      if (Math.abs(long - format.width) <= .15 && Math.abs(short - format.height) <= .15) return format.label;
    }
    return '비규격';
  }
  function seoulDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get = name => parts.find(part => part.type === name).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
  }
  function exhibitionStatus(exhibition, now = new Date()) {
    if (!validDate(exhibition.start_date) || !validDate(exhibition.end_date) || exhibition.start_date > exhibition.end_date) return null;
    const today = seoulDate(now);
    return today > exhibition.end_date ? 'past' : today < exhibition.start_date ? 'upcoming' : 'current';
  }
  const rules = {canvasFormats: Object.freeze(canvasFormats), canvasSize, seoulDate, validDate, exhibitionStatus};
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
  else root.GalleryRules = rules;
})(typeof window === 'undefined' ? globalThis : window);
