/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true
  },
  extends: [
    '@hellomouse/wolfy1339'
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': 1,
    'valid-jsdoc': 0,
    'jsdoc/no-defaults': 0
  }
};
