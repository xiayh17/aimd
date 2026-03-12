import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseAndExtract, renderToHtml } from '../dist/html.js'

const TABLE_WITH_INLINE_VAR = `
| Ingredient | Amount |
| --- | --- |
| Water | {{var|water_volume_ml: float}} mL |
`

test('renderToHtml renders inline var inside markdown table without escape syntax', async () => {
  const { html, fields } = await renderToHtml(TABLE_WITH_INLINE_VAR)

  assert.match(html, /data-aimd-name="water_volume_ml"/)
  assert.match(html, /aimd-field--var/)
  assert.match(html, /<td><span class="aimd-field aimd-field--var"/)
  assert.deepEqual(fields.var, ['water_volume_ml'])
})

test('parseAndExtract finds inline vars inside markdown table', () => {
  const fields = parseAndExtract(TABLE_WITH_INLINE_VAR)

  assert.deepEqual(fields.var, ['water_volume_ml'])
})
