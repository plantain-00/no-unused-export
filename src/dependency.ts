import ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import module from 'module'

export function collectMissingDependencyErrors(
  node: ts.Node,
  file: string,
  packageJsonMap: Map<string, { name: string, imported: boolean }[]>,
  missingDependencyErrors: CheckError[],
  sourceFile: ts.SourceFile,
  ignoreModules: string[]
) {
  if (ts.isImportDeclaration(node)) {
    if (ts.isStringLiteral(node.moduleSpecifier)) {
      checkImport(node.moduleSpecifier, file, packageJsonMap, missingDependencyErrors, sourceFile, ignoreModules)
    }
  } else if (ts.isImportEqualsDeclaration(node)
    && ts.isExternalModuleReference(node.moduleReference)
    && ts.isStringLiteral(node.moduleReference.expression)) {
    checkImport(node.moduleReference.expression, file, packageJsonMap, missingDependencyErrors, sourceFile, ignoreModules)
  }
}

export function collectUnusedDependencyErrors(
  unusedDependencyErrors: CheckError[],
  packageJsonMap: Map<string, { name: string, imported: boolean }[]>,
  needModules: string[]
) {
  for (const [file, values] of packageJsonMap) {
    const absolutePath = path.relative('.', file).split('\\').join('/')
    for (const value of values) {
      if (!value.imported && !needModules.includes(value.name)) {
        unusedDependencyErrors.push({ file: absolutePath, name: value.name, line: 0, character: 0, type: `'package.json'` })
      }
    }
  }
}

function checkImport(
  stringLiteral: ts.StringLiteral,
  file: string,
  packageJsonMap: Map<string, { name: string, imported: boolean }[]>,
  missingDependencyErrors: CheckError[],
  sourceFile: ts.SourceFile,
  ignoreModules: string[]
) {
  if (stringLiteral.text.startsWith('.')) {
    return
  }
  const moduleNameParts = stringLiteral.text.split('/')
  const moduleName = moduleNameParts[0]!.startsWith('@') && moduleNameParts.length > 1
    ? moduleNameParts[0] + '/' + moduleNameParts[1]
    : moduleNameParts[0]!
  if (module.Module.builtinModules.includes(moduleName)) {
    return
  }
  if (ignoreModules.includes(moduleName)) {
    return
  }
  const packageJson = getPackageJson(file, packageJsonMap)
  const dependency = packageJson.find(p => p.name === moduleName)
  if (dependency) {
    dependency.imported = true
  } else {
    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, stringLiteral.getStart(sourceFile))
    missingDependencyErrors.push({ file, name: moduleName, line, character, type: `'import'` })
  }
}

function getPackageJson(file: string, map: Map<string, { name: string, imported: boolean }[]>): { name: string, imported: boolean }[] {
  const dirname = path.dirname(file)
  const packageJsonPath = path.resolve(dirname, 'package.json')
  let dependencies = map.get(packageJsonPath)
  if (dependencies) {
    return dependencies
  }
  let packageJson: { dependencies: unknown, peerDependencies: unknown } | undefined
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, { encoding: 'utf8' }))
  } catch {
    // no action
  }
  if (packageJson) {
    dependencies = []
    if (typeof packageJson.dependencies === 'object' && packageJson.dependencies) {
      dependencies.push(...Object.keys(packageJson.dependencies).map(d => ({ name: d, imported: false })))
    }
    if (typeof packageJson.peerDependencies === 'object' && packageJson.peerDependencies) {
      dependencies.push(...Object.keys(packageJson.peerDependencies).map(d => ({ name: d, imported: false })))
    }
    map.set(packageJsonPath, dependencies)
    return dependencies
  }
  if (dirname === '.') {
    map.set(packageJsonPath, [])
    return []
  }
  return getPackageJson(dirname, map)
}
