import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import * as parse5 from 'parse5'

// tslint:disable-next-line:cognitive-complexity no-big-function
export function check(uniqFiles: string[]) {
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
  const unusedExportsErrors: CheckError[] = []
  function collectErrors(file: string, identifier: ts.Identifier | undefined, sourceFile: ts.SourceFile, type: string) {
    if (identifier) {
      const references = languageService.getReferencesAtPosition(file, identifier.end)
      if (references && references.every(r => r.fileName === file)) {
        const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile))
        unusedExportsErrors.push({ file, name: identifier.text, line, character, type })
      }
    }
  }
  const unreferencedMembersErrors: CheckError[] = []
  const canOnlyBePublicErrors: CheckError[] = []
  const missingKeyErrors: CheckError[] = []
  const missingDependencyErrors: CheckError[] = []
  const unusedDependencyErrors: CheckError[] = []
  const packageJsonMap = new Map<string, { name: string, imported: boolean }[]>()
  for (const file of uniqFiles) {
    const sourceFile = program.getSourceFile(file)
    if (sourceFile === undefined) {
      continue
    }
    sourceFile.forEachChild(node => {
      if (node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const jsDocs = getJsDocs(node)
        const isPublic = jsDocs.find(jsDoc => jsDoc.name === 'public')
        if (!isPublic) {
          if (node.kind === ts.SyntaxKind.TypeAliasDeclaration) {
            collectErrors(file, (node as ts.TypeAliasDeclaration).name, sourceFile, 'type')
          } else if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
            collectErrors(file, (node as ts.FunctionDeclaration).name, sourceFile, 'function')
          } else if (node.kind === ts.SyntaxKind.ClassDeclaration) {
            collectErrors(file, (node as ts.ClassDeclaration).name, sourceFile, 'class')
          } else if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
            collectErrors(file, (node as ts.InterfaceDeclaration).name, sourceFile, 'interface')
          } else if (node.kind === ts.SyntaxKind.VariableStatement) {
            const declarationList = (node as ts.VariableStatement).declarationList
            for (const declaration of declarationList.declarations) {
              collectErrors(file, declaration.name as ts.Identifier, sourceFile, 'variable')
            }
          }
        }
      }

      if (node.kind === ts.SyntaxKind.ClassDeclaration) {
        const referencedMembers = new Set<ts.ClassElement>()
        const decoratedMembers = new Set<string>()
        const classDeclaration = node as ts.ClassDeclaration
        const members = classDeclaration.members
        for (const member of members) {
          if (member.kind === ts.SyntaxKind.Constructor) {
            referencedMembers.add(member)
          } else if (member.modifiers
            && member.modifiers.some(m => m.kind === ts.SyntaxKind.PublicKeyword
              || m.kind === ts.SyntaxKind.PrivateKeyword
              || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
            referencedMembers.add(member)
          } else {
            const identifier = member.name as ts.Identifier
            if (hookNames.includes(identifier.text)) {
              referencedMembers.add(member)
            } else if (member.decorators) {
              for (const decorator of member.decorators) {
                if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
                  const { expression } = decorator.expression as ts.CallExpression
                  const text = (expression as ts.Identifier).text
                  if (text === 'Input' || text === 'Output') {
                    referencedMembers.add(member)
                    decoratedMembers.add(identifier.text)
                    break
                  }
                }
              }
            } else if (decoratedMembers.has(identifier.text)) {
              referencedMembers.add(member)
            }

            if (!referencedMembers.has(member)) {
              const references = languageService.getReferencesAtPosition(file, identifier.end)
              if (references
                && references.some(r => r.fileName !== file
                  || r.textSpan.start < node.pos
                  || r.textSpan.start > node.end)) {
                referencedMembers.add(member)
              }
            }
          }
        }

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
                        checkMemberUsedInTemplate(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration)
                        checkKeyExists(propertyName, property.initializer, text, missingKeyErrors, file, sourceFile)
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
                          checkMemberUsedInTemplate(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration)
                          checkKeyExists(propertyName, property.initializer, text, missingKeyErrors, file, sourceFile)
                        }
                      } else if (propertyName === 'host' && property.initializer.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                        const hostProperties = (property.initializer as ts.ObjectLiteralExpression).properties
                        for (const hostProperty of hostProperties) {
                          if (hostProperty.kind === ts.SyntaxKind.PropertyAssignment) {
                            const key = getText(program, languageService, file, hostProperty.name)
                            if (key && isAngularAttrName(key)) {
                              const text = getText(program, languageService, file, hostProperty.initializer)
                              checkMemberUsedInTemplate(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration)
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

        for (const member of members) {
          if (!referencedMembers.has(member)) {
            const identifier = member.name as ts.Identifier
            const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile))
            unreferencedMembersErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name!.text} member` })
          }
        }
      }

      if (node.kind === ts.SyntaxKind.ImportDeclaration) {
        const importDeclaration = node as ts.ImportDeclaration
        if (importDeclaration.moduleSpecifier.kind === ts.SyntaxKind.StringLiteral) {
          checkImport(importDeclaration.moduleSpecifier as ts.StringLiteral, languageService, file, packageJsonMap, missingDependencyErrors, sourceFile)
        }
      } else if (node.kind === ts.SyntaxKind.ImportEqualsDeclaration) {
        const importDeclaration = node as ts.ImportEqualsDeclaration
        if (importDeclaration.moduleReference.kind === ts.SyntaxKind.ExternalModuleReference) {
          const expression = (importDeclaration.moduleReference as ts.ExternalModuleReference).expression
          if (expression.kind === ts.SyntaxKind.StringLiteral) {
            checkImport(expression as ts.StringLiteral, languageService, file, packageJsonMap, missingDependencyErrors, sourceFile)
          }
        }
      }
    })
  }
  for (const [file, values] of packageJsonMap) {
    const absolutePath = path.relative('.', file)
    for (const value of values) {
      if (!value.imported && value.name !== 'tslib') {
        unusedDependencyErrors.push({ file: absolutePath, name: value.name, line: 0, character: 0, type: `'package.json'` })
      }
    }
  }
  return {
    unusedExportsErrors,
    unreferencedMembersErrors,
    canOnlyBePublicErrors,
    missingKeyErrors,
    missingDependencyErrors,
    unusedDependencyErrors
  }
}

function checkImport(
  stringLiteral: ts.StringLiteral,
  languageService: ts.LanguageService,
  file: string,
  packageJsonMap: Map<string, { name: string, imported: boolean }[]>,
  missingDependencyErrors: CheckError[],
  sourceFile: ts.SourceFile
) {
  if (stringLiteral.text.startsWith('.')) {
    return
  }
  const definitions = languageService.getDefinitionAtPosition(file, stringLiteral.end)
  let isValidPackage = false
  if (definitions && definitions.length > 0) {
    const definition = definitions[0]
    if (!definition.fileName.includes(nodePath)) {
      isValidPackage = true
    }
  } else {
    isValidPackage = true
  }
  if (isValidPackage) {
    const packageJson = getPackageJson(file, packageJsonMap)
    const dependency = packageJson.find(p => p.name === stringLiteral.text)
    if (dependency) {
      dependency.imported = true
    } else {
      const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, stringLiteral.getStart(sourceFile))
      missingDependencyErrors.push({ file, name: stringLiteral.text, line, character, type: `'import'` })
    }
  }
}

const nodePath = path.join('node_modules', '@types', 'node')

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
  } catch (error) {
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

function checkKeyExists(propertyName: string, propertyInitialize: ts.Expression, templateText: string | undefined, missingKeyErrors: CheckError[], file: string, sourceFile: ts.SourceFile) {
  if (templateText) {
    const fragment = parse5.parseFragment(templateText) as parse5.DefaultTreeDocumentFragment
    const errorCount = keyExistsInNode(0, fragment)
    if (errorCount > 0) {
      const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, propertyInitialize.getStart(sourceFile))
      missingKeyErrors.push({ file, name: propertyName, line, character, type: `'v-for' or '*ngFor'(error count: ${errorCount})` })
    }
  }
}

// tslint:disable-next-line:cognitive-complexity
function checkMemberUsedInTemplate(members: ts.NodeArray<ts.ClassElement>, referencedMembers: Set<ts.ClassElement>, templateText: string | undefined, canOnlyBePublicErrors: CheckError[], file: string, sourceFile: ts.SourceFile, classDeclaration: ts.ClassDeclaration) {
  if (templateText && members.length > 0) {
    const fragment = parse5.parseFragment(templateText) as parse5.DefaultTreeDocumentFragment
    for (const member of members) {
      const identifier = member.name as ts.Identifier
      if (identifier) {
        const templateType = memberIsUsedInNode(identifier.text, fragment)
        if (templateType) {
          if (!referencedMembers.has(member)) {
            referencedMembers.add(member)
          }
          if (templateType !== TemplateType.vue
            && member.modifiers
            && member.modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword
              || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
            const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile))
            canOnlyBePublicErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name!.text} member` })
          }
        }
      }
    }
  }
}

const enum TemplateType {
  angular = 'angular',
  vue = 'vue'
}

// tslint:disable-next-line:cognitive-complexity
function keyExistsInNode(errorCount: number, node: parse5.DefaultTreeNode): number {
  if (node.nodeName.startsWith('#')) {
    if (node.nodeName === '#document-fragment') {
      for (const childNode of (node as parse5.DefaultTreeDocumentFragment).childNodes) {
        errorCount = keyExistsInNode(errorCount, childNode as parse5.DefaultTreeElement)
      }
    }
  } else {
    const elementNode = node as parse5.DefaultTreeElement
    if (elementNode.tagName !== 'template' && elementNode.attrs) {
      const angularAttr = elementNode.attrs.find(attr => attr.name === '*ngfor')
      if (angularAttr && (!angularAttr.value || !angularAttr.value.includes('trackBy'))) {
        errorCount++
      }

      const vueAttr = elementNode.attrs.find(attr => attr.name === 'v-for')
      if (vueAttr && elementNode.attrs.every(attr => attr.name !== 'key' && attr.name !== ':key')) {
        errorCount++
      }
    }
    if (elementNode.childNodes) {
      for (const childNode of elementNode.childNodes) {
        errorCount = keyExistsInNode(errorCount, childNode as parse5.DefaultTreeElement)
      }
    }
    const content = (elementNode as unknown as { content?: parse5.DefaultTreeDocumentFragment }).content
    if (content) {
      errorCount = keyExistsInNode(errorCount, content)
    }
  }
  return errorCount
}

// tslint:disable-next-line:cognitive-complexity
function memberIsUsedInNode(memberName: string, node: parse5.DefaultTreeNode): boolean | TemplateType {
  if (node.nodeName.startsWith('#')) {
    if (node.nodeName === '#text') {
      const textNode = node as parse5.DefaultTreeTextNode
      return !!textNode.value
        && textNode.value.includes(memberName)
        && !new RegExp(`{{.*'.*${memberName}.*'.*}}`).test(textNode.value)
        && !new RegExp(`{{.*".*${memberName}.*".*}}`).test(textNode.value)
    } else if (node.nodeName === '#document-fragment') {
      for (const childNode of (node as parse5.DefaultTreeDocumentFragment).childNodes) {
        const isUsed = memberIsUsedInNode(memberName, childNode as parse5.DefaultTreeElement)
        if (isUsed) {
          return isUsed
        }
      }
      return false
    }
  } else {
    const elementNode = node as parse5.DefaultTreeElement
    if (elementNode.attrs) {
      for (const attr of elementNode.attrs) {
        let templateType: TemplateType | undefined
        if (isVuejsAttrName(attr.name)) {
          templateType = TemplateType.vue
        } else if (isAngularAttrName(attr.name)) {
          templateType = TemplateType.angular
        }
        if (templateType) {
          const isUsed = attr.value
            && attr.value.includes(memberName)
            && !new RegExp(`'.*${memberName}.*'`).test(attr.value)
            && !new RegExp(`".*${memberName}.*"`).test(attr.value)
          if (isUsed) {
            return templateType
          }
        }
      }
    }
    if (elementNode.childNodes) {
      for (const childNode of elementNode.childNodes) {
        const isUsed = memberIsUsedInNode(memberName, childNode as parse5.DefaultTreeElement)
        if (isUsed) {
          return isUsed
        }
      }
    }
    const content = (elementNode as unknown as { content?: parse5.DefaultTreeDocumentFragment }).content
    if (content) {
      return memberIsUsedInNode(memberName, content)
    }
  }
  return false
}

function isVuejsAttrName(attrName: string) {
  return attrName.startsWith('v-')
    || attrName.startsWith(':')
    || attrName.startsWith('@')
}

function isAngularAttrName(attrName: string) {
  return attrName.startsWith('*ng')
    || (attrName.startsWith('[') && attrName.endsWith(']'))
    || (attrName.startsWith('(') && attrName.endsWith(')'))
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

const hookNames = [
  'beforeCreate', 'created',
  'beforeMount', 'mounted',
  'beforeUpdate', 'updated',
  'activated', 'deactivated',
  'beforeDestroy', 'destroyed',

  'render',
  'componentWillMount', 'componentDidMount',
  'componentWillReceiveProps',
  'shouldComponentUpdate',
  'componentWillUpdate', 'componentDidUpdate',
  'componentWillUnmount',

  'ngOnInit',
  'ngOnChanges',
  'ngDoCheck',
  'ngOnDestroy',
  'ngAfterContentInit',
  'ngAfterContentChecked',
  'ngAfterViewInit',
  'ngAfterViewChecked'
]

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

function getJsDocs(node: ts.Node) {
  const jsDocs = (node as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc
  const result: JsDoc[] = []
  if (jsDocs && jsDocs.length > 0) {
    for (const jsDoc of jsDocs) {
      if (jsDoc.tags) {
        for (const tag of jsDoc.tags) {
          result.push({
            name: tag.tagName.text,
            comment: tag.comment
          })
        }
      }
    }
  }
  return result
}

type JsDoc = {
  name: string;
  comment?: string;
}
