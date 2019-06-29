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
      if (node.kind === ts.SyntaxKind.TypeAliasDeclaration) {
        collectErrors(file, (node as ts.TypeAliasDeclaration).name, sourceFile, 'type', languageService, unusedExportsErrors)
      } else if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
        collectErrors(file, (node as ts.FunctionDeclaration).name, sourceFile, 'function', languageService, unusedExportsErrors)
      } else if (node.kind === ts.SyntaxKind.ClassDeclaration) {
        collectErrors(file, (node as ts.ClassDeclaration).name, sourceFile, 'class', languageService, unusedExportsErrors)
      } else if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
        collectErrors(file, (node as ts.InterfaceDeclaration).name, sourceFile, 'interface', languageService, unusedExportsErrors)
      } else if (node.kind === ts.SyntaxKind.VariableStatement) {
        const declarationList = (node as ts.VariableStatement).declarationList
        for (const declaration of declarationList.declarations) {
          collectErrors(file, declaration.name as ts.Identifier, sourceFile, 'variable', languageService, unusedExportsErrors)
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

type JsDoc = {
  name: string;
  comment?: string;
}
