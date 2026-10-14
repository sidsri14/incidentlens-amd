import assert from 'node:assert/strict';
import test from 'node:test';
import { CitationValidator } from '../src/citation_validator.mjs';

test('CitationValidator approves well-cited response referencing valid events', () => {
  const validator = new CitationValidator();
  const validIds = new Set(['EVT-001', 'EVT-002', 'EVT-003']);
  const content = 'The connection aborted prematurely [EVT-002] causing ghost token usage [EVT-003]. Remediation: cancel upstream [EVT-001].';

  const verdict = validator.validate(content, validIds);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.failureReason, null);
  assert.equal(verdict.totalCitations, 3);
  assert.deepEqual(verdict.uniqueValidCitations.sort(), ['EVT-001', 'EVT-002', 'EVT-003']);
  assert.equal(verdict.invalidCitations.length, 0);
  assert.ok(verdict.citationDensity > 0);
});

test('CitationValidator rejects response with zero citations', () => {
  const validator = new CitationValidator();
  const validIds = new Set(['EVT-001', 'EVT-002']);
  const content = 'The connection aborted prematurely and caused high latency.';

  const verdict = validator.validate(content, validIds);
  assert.equal(verdict.valid, false);
  assert.match(verdict.failureReason, /contains zero event citations/);
  assert.equal(verdict.totalCitations, 0);
});

test('CitationValidator rejects response with hallucinated event IDs', () => {
  const validator = new CitationValidator();
  const validIds = new Set(['EVT-001', 'EVT-002']);
  const content = 'The connection aborted [EVT-001], but event [EVT-999] was hallucinated.';

  const verdict = validator.validate(content, validIds);
  assert.equal(verdict.valid, false);
  assert.match(verdict.failureReason, /hallucinated non-existent event IDs/);
  assert.deepEqual(verdict.invalidCitations, ['EVT-999']);
});

test('CitationValidator rejects invalid argument types', () => {
  const validator = new CitationValidator();
  assert.throws(() => validator.validate(null, new Set()), /must be a string/);
  assert.throws(() => validator.validate('text', []), /must be a Set/);
});
