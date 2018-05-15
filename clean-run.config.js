module.exports = {
  include: [
    'bin/*',
    'dist/*.js',
    'package.json',
    'yarn.lock'
  ],
  exclude: [
  ],
  postScript: [
    'cd "[dir]" && yarn --production',
    '[dir]/bin/no-unused-export demo/*.ts demo/*.less demo/*.scss --suppressError'
  ]
}
