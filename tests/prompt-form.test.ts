import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblePrompt, chipPresets, cleanFormTypes, defaultFormTypes, emptyForm, FormTypeError, readFormState, switchType, type FormLabels } from '../web/src/lib/promptForm';

const tr = (k: string) => k.split('.').pop()!;
const L: FormLabels = {
  goal: 'Goal', context: 'Background', files: 'Files', repro: 'Repro', actual: 'Actual', expected: 'Expected', logs: 'Log', requirements: 'Requirements',
  constraints: 'Constraints', done: 'Done when', approach: 'Approach', output: 'Reply', notes: 'Notes', verify: 'Check passes: {cmd}',
  approachText: { direct: 'Do it.', plan: 'Plan first.', ask: 'Ask first.' },
};

test('prompt form: sections for filled fields the type shows, in order', () => {
  const [feature, bugfix] = defaultFormTypes(tr);
  assert.equal(feature.name, 'feature');
  assert.deepEqual(feature.constraints, ['keepStyle', 'noDeps']);
  const s = { ...emptyForm(feature), goal: ' Add dark mode ', files: ['web/src/App.tsx'], requirements: ['toggle in settings', ' '], repro: 'hidden for features' };
  assert.equal(assemblePrompt(s, feature, L, 'npm test'), [
    '## Goal\nAdd dark mode',
    '## Files\n- `web/src/App.tsx`',
    '## Requirements\n- toggle in settings',
    '## Constraints\n- keepStyle\n- noDeps',
    '## Done when\n- Check passes: `npm test`\n- tests',
    '## Approach\nDo it.',
    '## Reply\n- changedFiles',
  ].join('\n\n'));
  // No verify command: that line is dropped. Unchecked verify too.
  assert.doesNotMatch(assemblePrompt(s, feature, L, null), /Check passes/);
  assert.doesNotMatch(assemblePrompt({ ...s, verify: false }, feature, L, 'npm test'), /Check passes/);

  const b = { ...switchType(s, bugfix), logs: 'Error: x\n```inner```\n\n', approach: 'plan' as const };
  const out = assemblePrompt(b, bugfix, L);
  assert.ok(out.startsWith('instruction\n\n## Goal'), out);
  assert.match(out, /## Log\n~~~\nError: x\n```inner```\n~~~/);
  assert.match(out, /## Approach\nPlan first\./);
  assert.doesNotMatch(out, /## Requirements/);
  // Switching type keeps typed text and takes the new type's chips.
  assert.equal(b.goal, ' Add dark mode ');
  assert.deepEqual(b.constraints, ['minimal']);
  assert.equal(assemblePrompt(emptyForm(feature), { ...feature, approach: 'direct', fields: [] }, L), '');
  assert.ok(chipPresets(tr).constraints.includes('noEdit'));
});

test('prompt form: drafts and saved types are validated', () => {
  const [feature] = defaultFormTypes(tr);
  const fallback = emptyForm(feature);
  assert.deepEqual(readFormState(null, fallback), fallback);
  const r = readFormState({ goal: 'g', files: ['a', 1], approach: 'nope', verify: 'yes' }, fallback);
  assert.equal(r.goal, 'g');
  assert.deepEqual(r.files, ['a']);
  assert.equal(r.approach, fallback.approach);
  assert.equal(r.verify, fallback.verify);

  const clean = cleanFormTypes([{ id: 'a b', name: ' Ops ', fields: ['files', 'bogus', 'context'], constraints: ['x', 'x', ' ', 'y'], approach: 'plan', verify: 1 }, { id: 'ab', name: 'Dup id' }]);
  assert.deepEqual(clean[0], { id: 'ab', name: 'Ops', instruction: '', fields: ['context', 'files'], constraints: ['x', 'y'], done: [], verify: false, output: [], approach: 'plan' });
  assert.equal(clean[1].id, 'ab_');
  assert.throws(() => cleanFormTypes([]), FormTypeError);
  assert.throws(() => cleanFormTypes([{ name: '' }]), /needs a name/);
  assert.throws(() => cleanFormTypes('x'), FormTypeError);
});
