import minimist from 'minimist'
import glob from 'glob'
import * as packageJson from '../package.json'
import * as ts from './ts'
import * as less from './less'
import * as scss from './scss'

let suppressError = false

function showToolVersion() {
  console.log(`Version: ${packageJson.version}`)
}

function globAsync(pattern: string, ignore?: string | string[]) {
  return new Promise<string[]>((resolve, reject) => {
    glob(pattern, { ignore }, (error, matches) => {
      if (error) {
        reject(error)
      } else {
        resolve(matches)
      }
    })
  })
}

async function executeCommandLine() {
  const argv = minimist(process.argv.slice(2), { '--': true }) as unknown as {
    v: boolean
    version: boolean
    suppressError: boolean
    _: string[]
    e: string | string[]
    exclude: string | string[]
    strict: boolean
    'ignore-module' ?: string | string[]
    'need-module' ?: string | string[]
  }

  const showVersion = argv.v || argv.version
  if (showVersion) {
    showToolVersion()
    return
  }

  suppressError = argv.suppressError

  const inputFiles = argv._
  if (inputFiles.length === 0) {
    throw new Error('expect the path of source files')
  }

  const exclude: string | string[] = argv.e || argv.exclude
  let excludeFiles: string[] = []
  if (Array.isArray(exclude)) {
    for (const e of exclude) {
      excludeFiles = excludeFiles.concat(e.split(','))
    }
  } else if (exclude) {
    excludeFiles = excludeFiles.concat(exclude.split(','))
  }

  const uniqFiles = await globAsync(inputFiles.length === 1 ? inputFiles[0] : `{${inputFiles.join(',')}}`, excludeFiles)

  let errorCount = 0

  let ignoreModules: string[] = []
  if (Array.isArray(argv['ignore-module'])) {
    ignoreModules = argv['ignore-module']
  } else if (argv['ignore-module']) {
    ignoreModules.push(argv['ignore-module'])
  }

  let needModules: string[] = []
  if (Array.isArray(argv['need-module'])) {
    needModules = argv['need-module']
  } else if (argv['need-module']) {
    needModules.push(argv['need-module'])
  }

  const strict = argv.strict

  const tsFiles = uniqFiles.filter(file => file.toLowerCase().endsWith('.ts') || file.toLowerCase().endsWith('.tsx'))
  if (tsFiles.length > 0) {
    const {
      unusedExportsErrors,
      unreferencedMembersErrors,
      canOnlyBePublicErrors,
      missingKeyErrors,
      missingDependencyErrors,
      unusedDependencyErrors,
      promiseNotAwaitErrors
    } = ts.check(tsFiles, ignoreModules, needModules, strict)
    if (unusedExportsErrors.length > 0) {
      console.log(`unused exported things found, please remove "export" or add "@public":`)
      for (const error of unusedExportsErrors) {
        console.log(`${error.file}:${error.line + 1}:${error.character + 1} unused exported ${error.type}: ${error.name}`)
      }
      errorCount += unusedExportsErrors.length

    }
    if (unreferencedMembersErrors.length > 0) {
      console.log(`unreferenced members found, please add "private" or "public":`)
      for (const error of unreferencedMembersErrors) {
        console.log(`${error.file}:${error.line + 1}:${error.character + 1} unreferenced ${error.type}: ${error.name}`)
      }
      errorCount += unreferencedMembersErrors.length
    }
    if (canOnlyBePublicErrors.length > 0) {
      console.log(`non-public members that used in template found, will be error when it works with angular AOT, please remove the modifier:`)
      for (const error of canOnlyBePublicErrors) {
        console.log(`${error.file}:${error.line + 1}:${error.character + 1} non-public ${error.type}: ${error.name}`)
      }
      errorCount += canOnlyBePublicErrors.length
    }
    if (missingKeyErrors.length > 0) {
      console.log(`key is missing in the template, please add it:`)
      for (const error of missingKeyErrors) {
        console.log(`${error.file}:${error.line + 1}:${error.character + 1} missing 'key' or 'trackBy' for ${error.type}: ${error.name}`)
      }
      errorCount += missingKeyErrors.length
    }
    if (strict) {
      if (missingDependencyErrors.length > 0) {
        console.log(`dependency is missing in package.json, please add it:`)
        for (const error of missingDependencyErrors) {
          console.log(`${error.file}:${error.line + 1}:${error.character + 1} missing dependency for ${error.type}: ${error.name}`)
        }
        errorCount += missingDependencyErrors.length
      }
      if (unusedDependencyErrors.length > 0) {
        console.log(`dependency is unused in package.json, please remove it:`)
        for (const error of unusedDependencyErrors) {
          console.log(`${error.file}:${error.line + 1}:${error.character + 1} unused dependency for ${error.type}: ${error.name}`)
        }
        errorCount += unusedDependencyErrors.length
      }
      if (promiseNotAwaitErrors.length > 0) {
        console.log(`promise is not await in async function or method, maybe it's a bug:`)
        for (const error of promiseNotAwaitErrors) {
          console.log(`${error.file}:${error.line + 1}:${error.character + 1} promise is not await: ${error.name}`)
        }
        errorCount += promiseNotAwaitErrors.length
      }
    }
  }

  const lessFiles = uniqFiles.filter(file => file.toLowerCase().endsWith('.less'))
  if (lessFiles.length > 0) {
    const { unusedVariables } = less.check(lessFiles)
    if (unusedVariables.length > 0) {
      console.log(`unreferenced less variables found, please remove it or add "@public":`)
      for (const error of unusedVariables) {
        console.log(`${error.file}:${error.line}:${error.character} unreferenced less ${error.type}: ${error.name}`)
      }
      errorCount += unusedVariables.length
    }
  }

  const scssFiles = uniqFiles.filter(file => file.toLowerCase().endsWith('.scss'))
  if (scssFiles.length > 0) {
    const { unusedVariables } = scss.check(scssFiles)
    if (unusedVariables.length > 0) {
      console.log(`unreferenced scss variables found, please remove it or add "@public":`)
      for (const error of unusedVariables) {
        console.log(`${error.file}:${error.line}:${error.character} unreferenced scss ${error.type}: ${error.name}`)
      }
      errorCount += unusedVariables.length
    }
  }

  if (errorCount > 0) {
    throw new Error('check no unused export fail.')
  }
}

executeCommandLine().then(() => {
  console.log('check no unused export success.')
}, (error: Error) => {
  if (error instanceof Error) {
    console.log(error.message)
  } else {
    console.log(error)
  }
  if (!suppressError) {
    process.exit(1)
  }
})
