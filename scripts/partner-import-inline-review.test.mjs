import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

// Synthetic keys and events only; no photos, network requests, or live databases.
const keys = [1, 2].map(id => '00000000-0000-0000-0000-' + String(id).padStart(12, '0') + '.jpg');
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)];

function fixture(photos = keys) {
  let cursor = 0;
  const slots = [];
  const mocks = {
    'react/jsx-runtime': jsx,
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    } },
    '../partner-import/FinalReviewPanel': { FinalReviewPanel: 'FinalReviewPanel' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/adminzhangzhang/submissions/InlineImportReview.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    assert.ok(Object.hasOwn(mocks, name), 'Unexpected dependency: ' + name);
    return mocks[name];
  } });
  return { render() {
    cursor = 0;
    const tree = exports.InlineImportReview({ submissionId: 2, draftId: 7, version: 8, photos });
    const nodes = walk(tree);
    return { tree, nodes, images: nodes.filter(node => node.type === 'img'), panel: nodes.find(node => node.type === 'FinalReviewPanel') };
  } };
}

test('inline review binds the submission version and previews only saved private photos', () => {
  const view = fixture().render();
  assert.equal(view.tree.props['aria-label'], '投稿 2 终审');
  assert.equal(view.panel.props.submissionId, 2);
  assert.equal(view.panel.props.version, 8);
  assert.equal(view.panel.props.previewReady, false);
  assert.equal(view.images.length, 2);
  view.images.forEach((image, index) => {
    assert.equal(image.props.src, '/adminzhangzhang/partner-import/photos/7/' + keys[index] + '?v=8');
    assert.equal(image.props.referrerPolicy, 'no-referrer');
    assert.equal(image.props.loading, 'lazy');
    assert.doesNotMatch(image.props.src, /cover=|https?:/);
  });
  assert.match(JSON.stringify(view.tree), /审核发布不会再次扣除/);
});

test('every photo must load before the existing final review confirmation can be enabled', () => {
  const f = fixture();
  f.render().images[0].props.onLoad();
  assert.equal(f.render().panel.props.previewReady, false);
  f.render().images[0].props.onLoad();
  assert.equal(f.render().panel.props.previewReady, false);
  f.render().images[1].props.onLoad();
  assert.equal(f.render().panel.props.previewReady, true);
});

test('failed photo previews immediately block publication and may recover after a successful reload', () => {
  const f = fixture();
  f.render().images.forEach(image => image.props.onLoad());
  assert.equal(f.render().panel.props.previewReady, true);
  f.render().images[1].props.onError();
  f.render().images[1].props.onError();
  assert.equal(f.render().panel.props.previewReady, false);
  f.render().images[0].props.onLoad();
  assert.equal(f.render().panel.props.previewReady, false);
  f.render().images[1].props.onLoad();
  assert.equal(f.render().panel.props.previewReady, true);
});

test('empty photos are allowed while unreadable photo records show an error and remain blocked', () => {
  const empty = fixture([]).render();
  assert.equal(empty.images.length, 0);
  assert.equal(empty.panel.props.previewReady, true);
  const invalid = fixture(null).render();
  assert.equal(invalid.images.length, 0);
  assert.equal(invalid.panel.props.previewReady, false);
  assert.ok(invalid.nodes.some(node => node.props?.role === 'alert'));
  assert.match(JSON.stringify(invalid.tree), /照片记录无法读取/);
});
