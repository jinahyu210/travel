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
  assert.equal(canvasSize(53, 53), '10호 S');
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

test('dropdown dimensions match the Korean 0–100 canvas chart exactly', () => {
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
    [['F',f],['P',p],['M',m],['S',long]].map(([type,short]) =>
      [`${number}호 ${type}`,long,short]));
  assert.deepEqual(canvasFormats.map(({label,width,height}) => [label,width,height]), expected);
});

test('legacy manufacturer rounding still resolves to the corrected size', () => {
  assert.equal(canvasSize(65.2, 53), '15호 F');
  assert.equal(canvasSize(80.3, 65.2), '25호 F');
  assert.equal(canvasSize(22.7, 13.9), '1호 P');
  assert.equal(canvasSize(25.8, 13.9), '2호 M');
});
