// ESLint v9 flat config with JSX + React Hooks support.
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
]
