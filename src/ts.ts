import ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import { getLanguageService } from 'ts-lib-utils'

import { collectMissingDependencyErrors, collectUnusedDependencyErrors } from './dependency'
import { collectCanOnlyBePublicErrors, isAngularAttrName } from './template'
import { collectMissingKeyErrors } from './key'
import { collectUnusedExportsErrors } from './export'
import { collectUnreferencedMembersErrors, collectReferencedMembers } from './class-member'
import { collectPromiseNotAwaitErrors } from './promise'

export function check(uniqFiles: string[], ignoreModules: string[], needModules: string[], strict: boolean) {
  const languageService = getLanguageService(uniqFiles)
  const program = ts.createProgram(uniqFiles, { target: ts.ScriptTarget.ESNext })
  const checker = program.getTypeChecker()
  const unusedExportsErrors: CheckError[] = []
  const unreferencedMembersErrors: CheckError[] = []
  const canOnlyBePublicErrors: CheckError[] = []
  const missingKeyErrors: CheckError[] = []
  const missingDependencyErrors: CheckError[] = []
  const unusedDependencyErrors: CheckError[] = []
  const promiseNotAwaitErrors: CheckError[] = []
  const packageJsonMap = new Map<string, { name: string, imported: boolean }[]>()
  for (const file of uniqFiles) {
    const sourceFile = program.getSourceFile(file)
    if (sourceFile === undefined) {
      continue
    }
    sourceFile.forEachChild(node => {
      collectUnusedExportsErrors(node, file, sourceFile, languageService, unusedExportsErrors)

      if (ts.isClassDeclaration(node)) {
        const referencedMembers = collectReferencedMembers(node, languageService, file, node)

        const decorators = node.decorators
        if (decorators) {
          for (const decorator of decorators) {
            if (ts.isCallExpression(decorator.expression)
              && ts.isIdentifier(decorator.expression.expression)
              && decorator.expression.expression.text === 'Component'
              && decorator.expression.arguments.length > 0) {
              const argument = decorator.expression.arguments[0]!
              if (ts.isObjectLiteralExpression(argument)) {
                for (const property of argument.properties) {
                  if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
                    const propertyName = property.name.text
                    if (propertyName === 'template') {
                      const text = getText(program, languageService, file, property.initializer)
                      collectCanOnlyBePublicErrors(node.members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, node)
                      collectMissingKeyErrors(propertyName, property.initializer, text, missingKeyErrors, file, sourceFile)
                    } else if (propertyName === 'props') {
                      if (ts.isArrayLiteralExpression(property.initializer)) {
                        for (const member of node.members) {
                          if (!referencedMembers.has(member)
                            && member.name
                            && ts.isIdentifier(member.name)) {
                            const text = member.name.text
                            if (property.initializer.elements.some(e => getText(program, languageService, file, e) === text)) {
                              referencedMembers.add(member)
                            }
                          }
                        }
                      }
                    } else if (propertyName === 'templateUrl') {
                      const url = getText(program, languageService, file, property.initializer)
                      if (url) {
                        let text: string | undefined
                        try {
                          text = fs.readFileSync(path.resolve(path.dirname(file), url), { encoding: 'utf8' })
                        } catch {
                          // no action
                        }
                        collectCanOnlyBePublicErrors(node.members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, node)
                        collectMissingKeyErrors(propertyName, property.initializer, text, missingKeyErrors, file, sourceFile)
                      }
                    } else if (propertyName === 'host' && ts.isObjectLiteralExpression(property.initializer)) {
                      const hostProperties = property.initializer.properties
                      for (const hostProperty of hostProperties) {
                        if (ts.isPropertyAssignment(hostProperty)) {
                          const key = getText(program, languageService, file, hostProperty.name)
                          if (key && isAngularAttrName(key)) {
                            const text = getText(program, languageService, file, hostProperty.initializer)
                            collectCanOnlyBePublicErrors(node.members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, node)
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        collectUnreferencedMembersErrors(referencedMembers, unreferencedMembersErrors, file, sourceFile, node)
      }

      if (strict) {
        collectMissingDependencyErrors(node, file, packageJsonMap, missingDependencyErrors, sourceFile, ignoreModules)

        for (const child of iterateNode(node)) {
          collectPromiseNotAwaitErrors(child, checker, promiseNotAwaitErrors, file, sourceFile)
        }
      }
    })
  }
  if (strict) {
    collectUnusedDependencyErrors(unusedDependencyErrors, packageJsonMap, needModules)
  }
  return {
    unusedExportsErrors,
    unreferencedMembersErrors,
    canOnlyBePublicErrors,
    missingKeyErrors,
    missingDependencyErrors,
    unusedDependencyErrors,
    promiseNotAwaitErrors
  }
}

function* iterateNode(node: ts.Node): IterableIterator<ts.Node> {
  yield node
  const children = node.getChildren()
  for (const child of children) {
    yield* iterateNode(child)
  }
}

function getText(program: ts.Program, languageService: ts.LanguageService, file: string, node: ts.Node): string | undefined {
  if (ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isStringLiteral(node)) {
    return node.text
  } else if (ts.isIdentifier(node)) {
    const definitions = languageService.getDefinitionAtPosition(file, node.end)
    if (definitions && definitions.length > 0) {
      const definition = definitions[0]!
      const child = findNodeAtDefinition(program, definition)
      if (child && ts.isVariableStatement(child)) {
        return getVariableValue(child, definition.name, program, languageService, file)
      }
    }
  }
  return undefined
}

function findNodeAtDefinition(program: ts.Program, definition: ts.DefinitionInfo) {
  const sourceFile = program.getSourceFile(definition.fileName)
  if (sourceFile) {
    return sourceFile.forEachChild(child => {
      if (child.pos < definition.textSpan.start && child.end > definition.textSpan.start + definition.textSpan.length) {
        return child
      }
      return undefined
    })
  }
  return undefined
}

function getVariableValue(child: ts.VariableStatement, variableName: string, program: ts.Program, languageService: ts.LanguageService, file: string) {
  const declarations = child.declarationList.declarations
  for (const declaration of declarations) {
    if (ts.isVariableDeclaration(declaration)) {
      const name = declaration.name
      if (ts.isIdentifier(name)
        && name.text === variableName) {
        const initializer = declaration.initializer
        if (initializer) {
          return getText(program, languageService, file, initializer)
        }
      }
    }
  }
  return undefined
}
