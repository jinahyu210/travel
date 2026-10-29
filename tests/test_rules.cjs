const {test} = require('node:test');
const assert = require('node:assert/strict');
const {canvasSize, exhibitionStatus, seoulDate} = require('../static/gallery-rules.js');

test('canvas matches F, P, M standards regardless of orientation', () => {
  assert.equal(canvasSize(53, 45.5), '10호 F');
  assert.equal(canvasSize(45.5, 53), '10호 F');
  assert.equal(canvasSize(53, 40.9), '10호 P');
  assert.equal(canvasSize(33.4, 53), '10호 M');
  assert.equal(canvasSize(72.7, 60.6), '20호 F');
  assert.equal(canvasSize(116.8, 91), '50호 F');
  assert.equal(canvasSize(162.2, 130.3), '100호 F');
  assert.equal(canvasSize(45.5, 45.5), '10호 S');
});
test('canvas allows millimetre rounding without guessing custom dimensions', () => {
  assert.equal(canvasSize(90.9, 72.8), '30호 F');
  assert.equal(canvasSize(60, 60), '비규격');
  assert.equal(canvasSize(53, 44), '비규격');
  assert.equal(canvasSize(0, 53), '');
  assert.equal(canvasSize(NaN, 53), '');
});
test('exhibition remains current until Seoul end-date midnight', () => {
  const exhibition = {start_date:'2026-10-20', end_date:'2026-10-24'};
  assert.equal(exhibitionStatus(exhibition, new Date('2026-10-24T14:59:59.999Z')), 'current');
  assert.equal(exhibitionStatus(exhibition, new Date('2026-10-24T15:00:00Z')), 'past');
  assert.equal(seoulDate(new Date('2026-10-24T15:00:00Z')), '2026-10-25');
  assert.equal(exhibitionStatus(exhibition, new Date('2026-10-19T14:59:59Z')), 'upcoming');
  assert.equal(exhibitionStatus(exhibition, new Date('2026-10-19T15:00:00Z')), 'current');
});
test('invalid dates never become legitimate exhibitions', () => {
  assert.equal(exhibitionStatus({start_date:'2026-02-30', end_date:'2026-03-01'}), null);
  assert.equal(exhibitionStatus({start_date:'2026-10-25', end_date:'2026-10-24'}), null);
  assert.equal(exhibitionStatus({}), null);
});

test('every selectable format matches its dimensions in either orientation', () => {
  const {canvasFormats} = require('../static/gallery-rules.js');
  assert.equal(new Set(canvasFormats.map(format => format.label)).size, canvasFormats.length);
  for (const format of canvasFormats) {
    assert.equal(canvasSize(format.width, format.height), format.label);
    assert.equal(canvasSize(format.height, format.width), format.label);
  }
});

test('F/P/M dropdown dimensions match the Korean 0–100 canvas chart exactly', () => {
  const {canvasFormats} = require('../static/gallery-rules.js');
  const rows = [
    [0,18,14,12,10],[1,22.7,15.8,14,12],[2,25.8,17.9,16,14],[3,27.3,22,19,16],
    [4,33.4,24.2,21.2,19],[5,34.8,27.3,24.2,21.2],[6,40.9,31.8,27.3,24.2],
    [8,45.5,37.9,33.4,27.3],[10,53,45.5,40.9,33.4],[12,60.6,50,45.5,40.9],
    [15,65.1,53,50,45.5],[20,72.7,60.6,53,50],[25,80.3,65.1,60.6,53],
    [30,90.9,72.7,65.1,60.6],[40,100,80.3,72.7,65.1],[50,116.8,91,80.3,72.7],
    [60,130.3,97,89.4,80.3],[80,145.5,112.1,97,89.4],[100,162.2,130.3,112.1,97]
  ];
  const expected = rows.flatMap(([number,long,f,p,m]) =>
    [['F',f],['P',p],['M',m]].map(([type,short]) =>
      [`${number}호 ${type}`,long,short]));
  assert.deepEqual(canvasFormats.filter(format => format.type !== 'S').map(({label,width,height}) => [label,width,height]), expected);
});

test('Korean square sizes use their own chart for selection and dimension recognition', () => {
  const {canvasFormats} = require('../static/gallery-rules.js');
  const squares = [[1,15.8],[2,17.9],[3,22],[4,24.2],[5,27.3],[6,31.8],[8,37.9],
    [10,45.5],[12,50],[15,53],[20,60.6],[25,65.1],[30,72.7],[40,80.3],
    [50,91],[60,97],[80,112.1],[100,130.3]];
  for (const [number, side] of squares) {
    const format = canvasFormats.find(format => format.label === `${number}호 S`);
    assert.deepEqual([format.width, format.height], [side, side]);
    assert.equal(canvasSize(side, side), `${number}호 S`);
  }
  assert.equal(canvasSize(60.6, 60.6), '20호 S');
  assert.equal(canvasSize(72.7, 72.7), '30호 S');
  assert.equal(canvasSize(53, 53), '15호 S');
  assert.equal(canvasSize(90.9, 90.9), '50호 S');
  assert.equal(canvasFormats.some(format => format.label === '0호 S'), false);
  assert.equal(canvasSize(19, 19), '비규격');
});

test('legacy manufacturer rounding still resolves to the corrected size', () => {
  assert.equal(canvasSize(65.2, 53), '15호 F');
  assert.equal(canvasSize(80.3, 65.2), '25호 F');
  assert.equal(canvasSize(22.7, 13.9), '1호 P');
  assert.equal(canvasSize(25.8, 13.9), '2호 M');
});
