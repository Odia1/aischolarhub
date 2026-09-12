const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRegionalContext, buildRegionalContextOverlay } = require('../../../../server/services/Config/regionalContext');

test('normalizes metadata', () => {
  const v = normalizeRegionalContext({ countryCode:' in ', country:' India ', region:' Odisha ', city:' Bhubaneswar ', currency:' inr ', languages:['English','Odia','odia'] });
  assert.equal(v.countryCode, 'IN');
  assert.equal(v.currency, 'INR');
  assert.deepEqual(v.languages, ['English','Odia']);
});

test('missing or disabled context emits no overlay', () => {
  assert.equal(buildRegionalContextOverlay({ _id:'TEST' }), '');
  assert.equal(buildRegionalContextOverlay({ regionalContext:{ enabled:false, country:'India' } }), '');
});

test('overlay includes precedence and safety', () => {
  const o = buildRegionalContextOverlay({ regionalContext:{ country:'India', region:'Odisha', city:'Bhubaneswar', currency:'INR' } });
  assert.match(o, /Bhubaneswar, Odisha, India/);
  assert.match(o, /explicit location or jurisdiction.*overrides institution context/i);
  assert.match(o, /Do not force regional references/i);
  assert.match(o, /Never infer an individual user/i);
  assert.ok(o.length < 2200);
});
