import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/build/**', 'tmp_check/**', 'android/**', 'ios/**'] },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, __DEV__: 'readonly' } },
    rules: { ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^(React|_)' }],
      'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['src/db/*.js'],
    plugins: { nudgr: { rules: { 'snapshot-exists': {
      meta: { type: 'problem', schema: [], messages: { method: 'React Native Firebase 25 snapshots require exists(), not an exists property check.' } },
      create(context) { return { MemberExpression(node) {
        if (!node.computed && node.property.name === 'exists' &&
          !(node.parent.type === 'CallExpression' && node.parent.callee === node)) {
          context.report({ node, messageId: 'method' });
        }
      } }; },
    } } } },
    rules: { 'nudgr/snapshot-exists': 'error' },
  },
];
