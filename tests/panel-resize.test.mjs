import test from 'node:test';
import assert from 'node:assert/strict';
import {
  panelBounds,
  readPanelSizes,
} from '../dist/typescript/renderer/ui/panel-resize.js';

test('panel bounds preserve editor space, including undersized windows', () => {
  assert.deepEqual(panelBounds(1000, 260, 300), { min: 260, max: 700 });
  assert.deepEqual(panelBounds(280, 260, 300), { min: 130, max: 130 });
  assert.deepEqual(panelBounds(0, 140, 140), { min: 0, max: 0 });
});
test('panel preferences reject invalid values and inaccessible storage', () => {
  for (const value of ['null', 'oops', '{}', '{"width":-5,"height":"300"}'])
    assert.deepEqual(readPanelSizes({ getItem: () => value }), {});

  assert.deepEqual(
    readPanelSizes({ getItem: () => '{"width":550,"height":220}' }),
    { width: 550, height: 220 },
  );
  assert.deepEqual(
    readPanelSizes({
      getItem() {
        throw new Error('blocked');
      },
    }),
    {},
  );
});
