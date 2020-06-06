import { checkGitStatus } from 'clean-scripts'

const tsFiles = `"src/**/*.ts"`
const jsFiles = `"*.config.js"`

export default {
  build: [
    'rimraf dist/',
    'tsc -p src/',
    'node dist/index.js demo/*.ts demo/*.tsx demo/*.less demo/*.scss src/*.ts --need-module tslib --ignore-module glob --strict --suppressError > demo/result.txt'
  ],
  lint: {
    ts: `eslint --ext .js,.ts,.tsx ${tsFiles} ${jsFiles}`,
    export: `node dist/index.js ${tsFiles} --need-module tslib --strict`,
    commit: `commitlint --from=HEAD~1`,
    markdown: `markdownlint README.md`,
    typeCoverage: 'type-coverage -p src --strict --ignore-catch'
  },
  test: [
    'clean-release --config clean-run.config.ts',
    () => checkGitStatus()
  ],
  fix: `eslint --ext .js,.ts,.tsx ${tsFiles} ${jsFiles} --fix`
}
