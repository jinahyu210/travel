(function(root) {
  // Korean canvas sizes in cm: number, long side, F/P/M short sides.
  const sizes = [
    [1,22.7,15.8,13.9,12],[2,25.8,17.9,16,13.9],[3,27.3,22,19,16],
    [4,33.4,24.2,21.2,19],[5,34.8,27.3,24.2,21.2],[6,40.9,31.8,27.3,24.2],
    [8,45.5,37.9,33.4,27.3],[10,53,45.5,40.9,33.4],[12,60.6,50,45.5,40.9],
    [15,65.2,53,50,45.5],[20,72.7,60.6,53,50],[25,80.3,65.2,60.6,53],
    [30,90.9,72.7,65.2,60.6],[40,100,80.3,72.7,65.2],[50,116.8,91,80.3,72.7],
    [60,130.3,97,89.4,80.3],[80,145.5,112.1,97,89.4],[100,162.2,130.3,112.1,97]
  ];
  function canvasSize(width, height) {
    if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return '';
    const long = Math.max(width, height), short = Math.min(width, height);
    for (const [number, edge, ...shorts] of sizes) {
      if (Math.abs(long - edge) > .15) continue;
      if (Math.abs(short - edge) <= .15) return `${number}호 S`;
      for (let index = 0; index < shorts.length; index++) {
        if (Math.abs(short - shorts[index]) <= .15) return `${number}호 ${['F','P','M'][index]}`;
      }
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
  const rules = {canvasSize, seoulDate, validDate, exhibitionStatus};
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
  else root.GalleryRules = rules;
})(typeof window === 'undefined' ? globalThis : window);
