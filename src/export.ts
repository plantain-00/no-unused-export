import ts from 'typescript'

export function collectUnusedExportsErrors(
  node: ts.Node,
  file: string,
  sourceFile: ts.SourceFile,
  languageService: ts.LanguageService,
  unusedExportsErrors: CheckError[]
) {
  if (node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
    const jsDocs = getJsDocs(node)
    const isPublic = jsDocs.find(jsDoc => jsDoc.name === 'public')
    if (!isPublic) {
      if (ts.isTypeAliasDeclaration(node)) {
        collectErrors(file, node.name, sourceFile, 'type', languageService, unusedExportsErrors)
      } else if (ts.isFunctionDeclaration(node)) {
        collectErrors(file, node.name, sourceFile, 'function', languageService, unusedExportsErrors)
      } else if (ts.isClassDeclaration(node)) {
        collectErrors(file, node.name, sourceFile, 'class', languageService, unusedExportsErrors)
      } else if (ts.isInterfaceDeclaration(node)) {
        collectErrors(file, node.name, sourceFile, 'interface', languageService, unusedExportsErrors)
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            collectErrors(file, declaration.name, sourceFile, 'variable', languageService, unusedExportsErrors)
          }
        }
      }
    }
  }
}

function collectErrors(
  file: string,
  identifier: ts.Identifier | undefined,
  sourceFile: ts.SourceFile,
  type: string,
  languageService: ts.LanguageService,
  unusedExportsErrors: CheckError[]
) {
  if (identifier) {
    const references = languageService.getReferencesAtPosition(file, identifier.end)
    if (references && references.every(r => r.fileName === file)) {
      const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile))
      unusedExportsErrors.push({ file, name: identifier.text, line, character, type })
    }
  }
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

interface JsDoc {
  name: string;
  comment?: string;
}
