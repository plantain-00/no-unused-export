import ts from 'typescript'

export function collectPromiseNotAwaitErrors(
  callExpression: ts.CallExpression,
  checker: ts.TypeChecker,
  promiseNotAwaitErrors: CheckError[],
  file: string,
  sourceFile: ts.SourceFile
) {
  if (callExpression.parent.kind === ts.SyntaxKind.ReturnStatement || callExpression.parent.kind === ts.SyntaxKind.AwaitExpression) {
    return
  }

  const functionNode = findFunction(callExpression)
  if (!functionNode || !functionNode.modifiers || functionNode.modifiers.every((m) => m.kind !== ts.SyntaxKind.AsyncKeyword)) {
    return
  }

  const signature = checker.getResolvedSignature(callExpression)
  if (signature) {
    const returnType = checker.getReturnTypeOfSignature(signature)
    if (returnType.symbol && returnType.symbol.escapedName === 'Promise') {
      const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, callExpression.getStart(sourceFile))
      const text = callExpression.expression.kind === ts.SyntaxKind.Identifier
        ? (callExpression.expression as ts.Identifier).text
        : ''
      promiseNotAwaitErrors.push({ file, name: text, line, character, type: '' })
    }
  }
}

function findFunction(node: ts.Node) {
  // tslint:disable-next-line:max-union-size
  return findParentFunction(node) as ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | undefined
}

function findParentFunction(node: ts.Node): ts.Node | undefined {
  const parent = node.parent
  if (parent.kind === ts.SyntaxKind.FunctionDeclaration
    || parent.kind === ts.SyntaxKind.FunctionExpression
    || parent.kind === ts.SyntaxKind.ArrowFunction
    || parent.kind === ts.SyntaxKind.MethodDeclaration) {
    return parent
  }
  if (parent.kind === ts.SyntaxKind.SourceFile) {
    return undefined
  }
  return findParentFunction(parent)
}
