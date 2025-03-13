import eslintConfig from '@hellomouse/eslint-config-wolfy1339';
import globals from 'globals';

export default [
  ...eslintConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': 1,
      'valid-jsdoc': 0,
      'jsdoc/no-defaults': 0
    }
  }
];
