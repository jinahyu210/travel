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
