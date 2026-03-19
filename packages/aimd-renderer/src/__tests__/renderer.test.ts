import { describe, expect, it } from 'vitest'

import { resolveQuizPreviewOptions } from '../common/quiz-preview'
import {
  createCustomElementAimdRenderer,
  parseAndExtract,
  renderToHtmlSync,
  renderToVue,
  createRenderer,
} from '../common/processor'
import { getFinalIndent, parseFieldTag } from '../index'
import { createStepCardRenderer } from '../vue/vue-renderer'

function findVNodeByType(node: any, expectedType: string): any | null {
  if (!node || typeof node !== 'object') {
    return null
  }

  if (node.type === expectedType) {
    return node
  }

  const children = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.component?.subTree?.children)
      ? node.component.subTree.children
      : []

  for (const child of children) {
    const match = findVNodeByType(child, expectedType)
    if (match) {
      return match
    }
  }

  return null
}

function findVNodeByClass(node: any, expectedClass: string): any | null {
  if (!node || typeof node !== 'object') {
    return null
  }

  const classValue = node.props?.class
  const classes = Array.isArray(classValue)
    ? classValue
    : typeof classValue === 'string'
      ? classValue.split(/\s+/)
      : []

  if (classes.includes(expectedClass)) {
    return node
  }

  const children = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.component?.subTree?.children)
      ? node.component.subTree.children
      : []

  for (const child of children) {
    const match = findVNodeByClass(child, expectedClass)
    if (match) {
      return match
    }
  }

  return null
}

function collectVNodeText(node: any): string {
  if (node == null) {
    return ''
  }

  if (typeof node === 'string') {
    return node
  }

  if (Array.isArray(node)) {
    return node.map((item) => collectVNodeText(item)).join(' ')
  }

  if (typeof node === 'object') {
    return collectVNodeText(node.children)
  }

  return ''
}

// ---------------------------------------------------------------------------
// resolveQuizPreviewOptions
// ---------------------------------------------------------------------------

describe('resolveQuizPreviewOptions', () => {
  it('defaults to hidden in preview mode', () => {
    const result = resolveQuizPreviewOptions('preview')
    expect(result.showAnswers).toBe(false)
    expect(result.showRubric).toBe(false)
  })

  it('defaults to revealed in report mode', () => {
    const result = resolveQuizPreviewOptions('report')
    expect(result.showAnswers).toBe(true)
    expect(result.showRubric).toBe(true)
  })

  it('normalizes timeline to preview', () => {
    const result = resolveQuizPreviewOptions('timeline')
    expect(result.showAnswers).toBe(false)
    expect(result.showRubric).toBe(false)
  })

  it('respects explicit overrides', () => {
    const result = resolveQuizPreviewOptions('preview', {
      showAnswers: true,
      showRubric: false,
    })
    expect(result.showAnswers).toBe(true)
    expect(result.showRubric).toBe(false)
  })

  it('overrides report defaults', () => {
    const result = resolveQuizPreviewOptions('report', {
      showAnswers: false,
    })
    expect(result.showAnswers).toBe(false)
    expect(result.showRubric).toBe(true)
  })

  it('handles unknown modes as non-report', () => {
    const result = resolveQuizPreviewOptions('unknown')
    expect(result.showAnswers).toBe(false)
    expect(result.showRubric).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseAndExtract
// ---------------------------------------------------------------------------

describe('parseAndExtract', () => {
  it('extracts var fields', () => {
    const fields = parseAndExtract('{{var|temperature: float = 36.5}}')
    expect(fields.var).toContain('temperature')
  })

  it('extracts step fields', () => {
    const fields = parseAndExtract('{{step|wash_hands}}')
    expect(fields.step.length).toBeGreaterThan(0)
  })

  it('extracts check fields', () => {
    const fields = parseAndExtract('{{check|verify_result}}')
    expect(fields.check.length).toBeGreaterThan(0)
  })

  it('returns empty fields for plain markdown', () => {
    const fields = parseAndExtract('# Hello World\n\nJust some text.')
    expect(fields.var).toHaveLength(0)
    expect(fields.step).toHaveLength(0)
    expect(fields.quiz).toHaveLength(0)
  })

  it('extracts multiple fields from mixed content', () => {
    const content = [
      '{{var|name: str = "Alice"}}',
      '{{var|age: int = 25}}',
      '{{step|step1}}',
    ].join('\n\n')
    const fields = parseAndExtract(content)
    expect(fields.var).toContain('name')
    expect(fields.var).toContain('age')
    expect(fields.step.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// renderToHtmlSync
// ---------------------------------------------------------------------------

describe('renderToHtmlSync', () => {
  it('renders plain markdown to HTML', () => {
    const { html } = renderToHtmlSync('# Hello')
    expect(html).toContain('<h1')
    expect(html).toContain('Hello')
  })

  it('renders AIMD var fields', () => {
    const { html, fields } = renderToHtmlSync('{{var|temperature}}')
    expect(fields.var).toContain('temperature')
    expect(html).toContain('temperature')
  })

  it('returns extracted fields alongside HTML', () => {
    const { fields } = renderToHtmlSync('{{step|wash}} and {{check|verify}}')
    expect(fields.step.length).toBeGreaterThan(0)
    expect(fields.check.length).toBeGreaterThan(0)
  })

  it('renders GFM tables', () => {
    const content = '| A | B |\n|---|---|\n| 1 | 2 |'
    const { html } = renderToHtmlSync(content)
    expect(html).toContain('<table')
    expect(html).toContain('<td')
  })

  it('upgrades markdown alerts into structured callouts', () => {
    const { html } = renderToHtmlSync(
      [
        '> [!TIP|Specimen Field]',
        '>',
        '> **用途：** 标记样本编号。',
        '>',
        '> - 使用 `specimen_id` 填写记录',
      ].join('\n'),
    )

    expect(html).toContain('class="aimd-callout aimd-callout--tip"')
    expect(html).toContain('class="aimd-callout__badge aimd-callout__badge--tip"')
    expect(html).toContain('<span class="aimd-callout__title-text">Specimen Field</span>')
    expect(html).toContain('<div class="aimd-callout__body">')
    expect(html).toContain('<strong>用途：</strong>')
    expect(html).toContain('<code>specimen_id</code>')
  })

  it('supports attribute-style custom titles while keeping first-line body text', () => {
    const { html } = renderToHtmlSync(
      [
        '> [!WARNING]{title="Cold Chain"} Keep samples refrigerated.',
        '>',
        '> Temperature drift invalidates the batch.',
      ].join('\n'),
    )

    expect(html).toContain('class="aimd-callout aimd-callout--warning"')
    expect(html).toContain('<span class="aimd-callout__title-text">Cold Chain</span>')
    expect(html).toContain('<p>Keep samples refrigerated.</p>')
    expect(html).toContain('Temperature drift invalidates the batch.')
  })

  it('supports info and abstract callouts with collapsible and icon attributes', () => {
    const { html } = renderToHtmlSync(
      [
        '> [!ABSTRACT]{title="Study Summary", collapsible=true, collapsed=true, icon="document"}',
        '>',
        '> This section summarizes the protocol.',
        '',
        '> [!INFO|Run Context]{icon="bookmark"}',
        '>',
        '> Captured on instrument A.',
      ].join('\n'),
    )

    expect(html).toContain('<details class="aimd-callout aimd-callout--abstract aimd-callout--collapsible"')
    expect(html).toContain('data-aimd-callout-icon="document"')
    expect(html).toContain('<span class="aimd-callout__title-text">Study Summary</span>')
    expect(html).toContain('This section summarizes the protocol.')
    expect(html).toContain('class="aimd-callout aimd-callout--info"')
    expect(html).toContain('data-aimd-callout-icon="bookmark"')
    expect(html).toContain('<span class="aimd-callout__title-text">Run Context</span>')
  })

  it('supports the extended callout type set', () => {
    const { html } = renderToHtmlSync(
      [
        '> [!EXAMPLE|Usage]',
        '> Example body.',
        '',
        '> [!SUCCESS|Completed]',
        '> Success body.',
        '',
        '> [!DANGER|Hazard]',
        '> Danger body.',
        '',
        '> [!BUG|Regression]',
        '> Bug body.',
        '',
        '> [!QUOTE|Reference]',
        '> Quote body.',
      ].join('\n'),
    )

    expect(html).toContain('class="aimd-callout aimd-callout--example"')
    expect(html).toContain('class="aimd-callout aimd-callout--success"')
    expect(html).toContain('class="aimd-callout aimd-callout--danger"')
    expect(html).toContain('class="aimd-callout aimd-callout--bug"')
    expect(html).toContain('class="aimd-callout aimd-callout--quote"')
    expect(html).toContain('Example body.')
    expect(html).toContain('Success body.')
    expect(html).toContain('Danger body.')
    expect(html).toContain('Bug body.')
    expect(html).toContain('Quote body.')
  })

  it('renders badge-only callouts when no custom or inferred title is present', () => {
    const { html } = renderToHtmlSync(
      [
        '> [!NOTE]',
        '>',
        '> - Body only content.',
      ].join('\n'),
    )

    expect(html).toContain('aimd-callout__title aimd-callout__title--badge-only')
    expect(html).not.toContain('aimd-callout__title-text')
    expect(html).toContain('<li>Body only content.</li>')
  })

  it('supports host custom element renderers for AIMD nodes', () => {
    const { html } = renderToHtmlSync(
      "{{step|verify, 2, title='Verify Output', subtitle='Cross-check', check=True, result=True}}\n\nStep body content.",
      {
        groupStepBodies: true,
        aimdElementRenderers: {
          step: createCustomElementAimdRenderer('step-card', (node) => {
            const stepNode = node as any
            return {
              'step-id': stepNode.id,
              'step-number': stepNode.step,
              title: stepNode.title,
              subtitle: stepNode.subtitle,
              level: String(stepNode.level),
              'has-check': stepNode.check ? 'true' : undefined,
              'is-result': stepNode.result ? 'true' : undefined,
            }
          }, {
            container: true,
            stripDefaultChildren: true,
          }),
        },
      },
    )

    expect(html).toContain('<step-card')
    expect(html).toContain('step-id="verify"')
    expect(html).toContain('step-number="1"')
    expect(html).toContain('title="Verify Output"')
    expect(html).toContain('subtitle="Cross-check"')
    expect(html).toContain('has-check="true"')
    expect(html).toContain('is-result="true"')
    expect(html).toContain('data-aimd-step-body="true"')
    expect(html).toContain('Step body content.')
  })

  it('stops grouped step bodies at headings and dividers', () => {
    const { html } = renderToHtmlSync(
      [
        '## Section',
        '',
        "{{step|step1, title='Step One'}}",
        '',
        'Body one.',
        '',
        '---',
        '',
        '## Next',
        '',
        '{{step|step2}}',
        '',
        'Body two.',
      ].join('\n'),
      {
        groupStepBodies: true,
        aimdElementRenderers: {
          step: createCustomElementAimdRenderer('step-card', (node) => ({
            'step-id': node.id,
            'step-number': (node as any).step,
            title: (node as any).title || node.id,
          }), {
            container: true,
            stripDefaultChildren: true,
          }),
        },
      },
    )

    expect(html).toContain('<h2>Section</h2>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<h2>Next</h2>')
    expect(html).toContain('step-id="step1"')
    expect(html).toContain('step-id="step2"')
    expect(html).toContain('Body one.')
    expect(html).toContain('Body two.')
    expect(html.indexOf('Body one.')).toBeLessThan(html.indexOf('<hr>'))
    expect(html.indexOf('<hr>')).toBeLessThan(html.indexOf('step-id="step2"'))
  })

  it('absorbs a preceding heading into the next grouped step title', () => {
    const { html } = renderToHtmlSync(
      [
        '## Cell Seeding',
        '',
        '{{step|cell_seeding}} Cell Seeding',
        '',
        'Plate the cells and continue incubation.',
      ].join('\n'),
      {
        groupStepBodies: true,
        aimdElementRenderers: {
          step: createCustomElementAimdRenderer('step-card', (node) => ({
            'step-id': node.id,
            title: (node as any).title,
          }), {
            container: true,
            stripDefaultChildren: true,
          }),
        },
      },
    )

    expect(html).toContain('<step-card')
    expect(html).toContain('step-id="cell_seeding"')
    expect(html).toContain('title="Cell Seeding"')
    expect(html).toContain('Plate the cells and continue incubation.')
    expect(html).not.toContain('<h2>Cell Seeding</h2>')
  })

  it('can lift block-style var types out of inline paragraphs', () => {
    const { html } = renderToHtmlSync(
      'Experiment summary: {{var|summary: AiralogyMarkdown}}',
      { blockVarTypes: ['AiralogyMarkdown'] },
    )

    expect(html).toContain('<p>Experiment summary: </p>')
    expect(html).toContain('<div class="aimd-field aimd-field--var aimd-block-var"')
    expect(html).not.toContain('<p>Experiment summary: <span')
  })

  it('can lift block-style var types out of tight list items', () => {
    const { html } = renderToHtmlSync(
      '- Experiment summary: {{var|summary: AiralogyMarkdown}}',
      { blockVarTypes: ['AiralogyMarkdown'] },
    )

    expect(html).toContain('<li><p>Experiment summary: </p><div class="aimd-field aimd-field--var aimd-block-var"')
    expect(html).not.toContain('<li>Experiment summary: <span')
  })
})

describe('renderToVue', () => {
  it('renders host-ready step cards with grouped body content', async () => {
    const { nodes } = await renderToVue(
      "{{step|verify, 2, title='Verify Output', subtitle='Cross-check', check=True}}\n\nStep body content.",
      {
        groupStepBodies: true,
        aimdRenderers: {
          step: createStepCardRenderer(),
        },
      },
    )

    expect(nodes).toHaveLength(1)
    const card = findVNodeByType(nodes[0], 'article') as any
    expect(card).toBeTruthy()
    expect(card.props.class).toContain('aimd-step-card')
    expect(card.props['data-aimd-step-id']).toBe('verify')
    const header = card.children[0] as any
    const leftCluster = header.children[0] as any
    const contentStack = leftCluster.children[1] as any
    expect(contentStack.children[1].children).toBe('Verify Output')
    expect(contentStack.children[2].children).toBe('Cross-check')
    const body = card.children[1] as any
    expect(body.props.class).toContain('aimd-step-card__body')
    expect(collectVNodeText(body)).toContain('Step body content.')
  })

  it('renders markdown alerts as structured callouts in Vue output', async () => {
    const { nodes } = await renderToVue(
      [
        '> [!WARNING|Handling]',
        '>',
        '> Double-check every reagent before proceeding.',
      ].join('\n'),
    )

    const callout = findVNodeByClass(nodes[0], 'aimd-callout') as any
    expect(callout).toBeTruthy()
    expect(callout.props['data-aimd-callout']).toBe('warning')

    const title = findVNodeByClass(callout, 'aimd-callout__title')
    const body = findVNodeByClass(callout, 'aimd-callout__body')
    expect(collectVNodeText(title)).toContain('Handling')
    expect(collectVNodeText(title)).toContain('Warning')
    expect(collectVNodeText(body)).toContain('Double-check every reagent before proceeding.')
  })

  it('renders collapsible abstract callouts in Vue output', async () => {
    const { nodes } = await renderToVue(
      [
        '> [!ABSTRACT]{title="Protocol Summary", collapsible=true, icon="document"}',
        '>',
        '> Includes the top-level overview.',
      ].join('\n'),
    )

    const callout = findVNodeByClass(nodes[0], 'aimd-callout') as any
    expect(callout).toBeTruthy()
    expect(callout.type).toBe('details')
    expect(callout.props['data-aimd-callout']).toBe('abstract')
    expect(callout.props['data-aimd-callout-collapsible']).toBe('true')
    expect(callout.props['data-aimd-callout-icon']).toBe('document')
    expect(collectVNodeText(callout)).toContain('Protocol Summary')
    expect(collectVNodeText(callout)).toContain('Abstract')
  })

  it('uses a preceding heading as the grouped step card title without leaking the step id', async () => {
    const { nodes } = await renderToVue(
      [
        '## Cell Seeding',
        '',
        '{{step|cell_seeding}} Cell Seeding',
        '',
        'Plate the cells and continue incubation.',
      ].join('\n'),
      {
        groupStepBodies: true,
        aimdRenderers: {
          step: createStepCardRenderer(),
        },
      },
    )

    expect(nodes).toHaveLength(1)
    const card = findVNodeByType(nodes[0], 'article') as any
    expect(card).toBeTruthy()
    expect(collectVNodeText(card)).toContain('Cell Seeding')
    expect(collectVNodeText(card)).toContain('Plate the cells and continue incubation.')
    expect(collectVNodeText(card)).not.toContain('cell_seeding')
  })
})

// ---------------------------------------------------------------------------
// createRenderer
// ---------------------------------------------------------------------------

describe('createRenderer', () => {
  it('creates a reusable renderer', () => {
    const renderer = createRenderer()
    expect(renderer).toHaveProperty('toHtml')
    expect(renderer).toHaveProperty('toVue')
    expect(renderer).toHaveProperty('extractFields')
  })

  it('renderer.extractFields works', () => {
    const renderer = createRenderer()
    const fields = renderer.extractFields('{{var|x}}')
    expect(fields.var).toContain('x')
  })
})

// ---------------------------------------------------------------------------
// getFinalIndent
// ---------------------------------------------------------------------------

describe('getFinalIndent', () => {
  it('returns simple index for level 1', () => {
    expect(getFinalIndent({ sequence: 0, level: 1 })).toBe('1')
    expect(getFinalIndent({ sequence: 4, level: 1 })).toBe('5')
  })

  it('builds hierarchical indent from parent chain', () => {
    const parent = { sequence: 0, level: 1, parent: undefined }
    expect(getFinalIndent({ parent, sequence: 1, level: 2 })).toBe('1.2')
  })

  it('handles deeply nested parents', () => {
    const grandparent = { sequence: 0, level: 1, parent: undefined }
    const parent = { sequence: 2, level: 2, parent: grandparent }
    expect(getFinalIndent({ parent, sequence: 0, level: 3 })).toBe('1.3.1')
  })
})

// ---------------------------------------------------------------------------
// parseFieldTag
// ---------------------------------------------------------------------------

describe('parseFieldTag', () => {
  it('parses simple var tag', () => {
    const result = parseFieldTag('var|temperature')
    expect(result).toEqual([{ type: 'var', name: 'temperature' }])
  })

  it('parses step tag', () => {
    const result = parseFieldTag('step|wash_hands')
    expect(result).toEqual([{ type: 'step', name: 'wash_hands' }])
  })

  it('parses var_table tag', () => {
    const result = parseFieldTag('var_table|measurements|col1,col2')
    expect(result[0].type).toBe('var_table')
  })
})
