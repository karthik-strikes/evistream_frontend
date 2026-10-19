const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

function setup() {
  const saved = new Map();
  const timers = new Map();
  let timerId = 0;
  const storage = {
    get length() { return saved.size; },
    key: i => [...saved.keys()][i] ?? null,
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  };
  const filename = path.resolve('app/(dashboard)/manual-extraction/_hooks/useDraftAutoSave.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exported = {};
  const toast = () => {};
  vm.runInNewContext(code, {
    exports: exported,
    require: name => name === 'react' ? React : { useToast: () => ({ toast }) },
    localStorage: storage,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  }, { filename });
  let state;
  function Harness({ userId, role = 'reviewer_1', doc = 'paper', enabled = true }) {
    const [data, setData] = React.useState({ answer: '' });
    const { clearDraft } = exported.useDraftAutoSave('form', doc, data, setData, enabled, userId, role);
    state = { data, setData, clearDraft };
    return null;
  }
  let renderer;
  return {
    saved, storage, exported,
    render: props => act(() => { renderer ? renderer.update(React.createElement(Harness, props)) : renderer = create(React.createElement(Harness, props)); }),
    edit: answer => act(() => state.setData({ answer })),
    flush: () => act(() => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); }),
    answer: () => state.data.answer,
    clear: () => act(() => state.clearDraft()),
    unmount: () => { if (renderer) act(() => renderer.unmount()); renderer = null; },
  };
}

test('another reviewer cannot restore, list, or clear the first reviewer draft', () => {
  const h = setup();
  h.render({ userId: 'alice' }); h.edit('Alice answer'); h.flush(); h.unmount();
  h.render({ userId: 'bob' });
  assert.equal(h.answer(), '');
  assert.equal(h.exported.getDraftStatus('bob', 'reviewer_1', 'form', 'paper'), false);
  h.clear(); h.unmount();
  h.render({ userId: 'alice' });
  assert.equal(h.answer(), 'Alice answer');
  h.unmount();
});

test('changing accounts or roles while mounted resets answers and preserves separate drafts', () => {
  const h = setup();
  h.render({ userId: 'alice' }); h.edit('R1 answer'); h.flush();
  h.render({ userId: 'alice', role: 'reviewer_2' });
  assert.equal(h.answer(), '');
  h.edit('R2 answer'); h.flush();
  h.render({ userId: 'bob', role: 'reviewer_2' });
  assert.equal(h.answer(), ''); h.flush();
  assert.equal(h.exported.getDraftStatus('bob', 'reviewer_2', 'form', 'paper'), false);
  h.render({ userId: 'alice' });
  assert.equal(h.answer(), 'R1 answer');
  h.unmount();
});

test('logout cancels a pending save and missing identity never accesses a draft', () => {
  const h = setup();
  h.render({ userId: 'alice' }); h.edit('unsaved');
  h.render({ userId: undefined }); h.flush();
  assert.equal(h.saved.size, 0);
  assert.equal(h.exported.getDraftStatus(undefined, null, 'form', 'paper'), false);
  h.unmount();
});

test('unattributed legacy drafts are discarded instead of assigned to a new user', () => {
  const h = setup();
  h.storage.setItem('evistream:draft:v2:form:paper', JSON.stringify({ formData: { answer: 'other reviewer' }, updatedAt: new Date().toISOString() }));
  h.render({ userId: 'bob' });
  assert.equal(h.answer(), '');
  assert.equal(h.saved.size, 0);
  h.unmount();
});
