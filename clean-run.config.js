module.exports = {
  include: [
    'bin/*',
    'dist/*.js',
    'demo/*',
    'package.json',
    'yarn.lock'
  ],
  exclude: [
  ],
  postScript: [
    'cd "[dir]" && yarn --production',
    'node [dir]/dist/index.js demo/*.ts demo/*.less demo/*.scss --suppressError'
  ]
}
