import ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'

import { collectMissingDependencyErrors, collectUnusedDependencyErrors } from './dependency'
import { collectCanOnlyBePublicErrors, isAngularAttrName } from './template'
import { collectMissingKeyErrors } from './key'
import { collectUnusedExportsErrors } from './export'
import { collectUnreferencedMembersErrors, collectReferencedMembers } from './class-member'
import { collectPromiseNotAwaitErrors } from './promise'

// tslint:disable-next-line:cognitive-complexity no-big-function
export function check(uniqFiles: string[], ignoreModules: string[], needModules: string[], strict: boolean) {
  const languageService = ts.createLanguageService({
    getCompilationSettings() {
      return {
        jsx: ts.JsxEmit.React
      }
    },
    getScriptFileNames() {
      return uniqFiles
    },
    getScriptVersion(fileName: string) {
      return ''
    },
    getScriptSnapshot(fileName: string) {
      if (fileName === '.ts') {
        return ts.ScriptSnapshot.fromString('')
      }
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, { encoding: 'utf8' }))
    },
    getCurrentDirectory: () => '.',
    getDefaultLibFileName(options: ts.CompilerOptions) {
      return ts.getDefaultLibFilePath(options)
    },
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory
  })
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

      if (node.kind === ts.SyntaxKind.ClassDeclaration) {
        const classDeclaration = node as ts.ClassDeclaration
        const members = classDeclaration.members
        const referencedMembers = collectReferencedMembers(classDeclaration, languageService, file, node)

        const decorators = classDeclaration.decorators
        if (decorators) {
          for (const decorator of decorators) {
            if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
              const { expression, arguments: expressionArguments } = decorator.expression as ts.CallExpression
              if ((expression as ts.Identifier).text === 'Component' && expressionArguments.length > 0) {
                const argument = expressionArguments[0]
                if (argument.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                  const properties = (argument as ts.ObjectLiteralExpression).properties
                  for (const property of properties) {
                    if (property.kind === ts.SyntaxKind.PropertyAssignment) {
                      const propertyName = (property.name as ts.Identifier).text
                      if (propertyName === 'template') {
                        const text = getText(program, languageService, file, property.initializer)
                        collectCanOnlyBePublicErrors(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration)
                        collectMissingKeyErrors(propertyName, property.initializer, text, missingKeyErrors, file, sourceFile)
                      } else if (propertyName === 'props') {
                        if (property.initializer.kind === ts.SyntaxKind.ArrayLiteralExpression) {
                          const elements = (property.initializer as ts.ArrayLiteralExpression).elements
                          for (const member of members) {
                            if (!referencedMembers.has(member)
                              && elements.some(e => getText(program, languageService, file, e) === (member.name as ts.Identifier).text)) {
                              referencedMembers.add(member)
                            }
                          }
                        }
                      } else if (propertyName === 'templateUrl') {
                        const url = getText(program, languageService, file, property.initializer)
                        if (url) {
                          let text: string | undefined
                          try {
                            text = fs.readFileSync(path.resolve(path.dirname(file), url), { encoding: 'utf8' })
                          } catch (error) {
                            // no action
                          }
                          collectCanOnlyBePublicErrors(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration)
                          collectMissingKeyErrors(propertyName, property.initializer, text, missingKeyErrors, file, sourceFile)
                        }
                      } else if (propertyName === 'host' && property.initializer.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                        const hostProperties = (property.initializer as ts.ObjectLiteralExpression).properties
                        for (const hostProperty of hostProperties) {
                          if (hostProperty.kind === ts.SyntaxKind.PropertyAssignment) {
                            const key = getText(program, languageService, file, hostProperty.name)
                            if (key && isAngularAttrName(key)) {
                              const text = getText(program, languageService, file, hostProperty.initializer)
                              collectCanOnlyBePublicErrors(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration)
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
        }

        collectUnreferencedMembersErrors(referencedMembers, unreferencedMembersErrors, file, sourceFile, classDeclaration)
      }

      if (strict) {
        collectMissingDependencyErrors(node, file, packageJsonMap, missingDependencyErrors, sourceFile, ignoreModules)

        for (const child of iterateNode(node)) {
          if (child.kind === ts.SyntaxKind.CallExpression) {
            collectPromiseNotAwaitErrors(child as ts.CallExpression, checker, promiseNotAwaitErrors, file, sourceFile)
          }
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
  if (node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    || node.kind === ts.SyntaxKind.StringLiteral) {
    return (node as ts.NoSubstitutionTemplateLiteral | ts.StringLiteral).text
  } else if (node.kind === ts.SyntaxKind.Identifier) {
    const identifier = node as ts.Identifier
    const definitions = languageService.getDefinitionAtPosition(file, identifier.end)
    if (definitions && definitions.length > 0) {
      const definition = definitions[0]
      const child = findNodeAtDefinition(program, definition)
      if (child && child.kind === ts.SyntaxKind.VariableStatement) {
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

function getVariableValue(child: ts.Node, variableName: string, program: ts.Program, languageService: ts.LanguageService, file: string) {
  const declarations = (child as ts.VariableStatement).declarationList.declarations
  for (const declaration of declarations) {
    if (declaration.kind === ts.SyntaxKind.VariableDeclaration) {
      const name = declaration.name
      if (name.kind === ts.SyntaxKind.Identifier
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
