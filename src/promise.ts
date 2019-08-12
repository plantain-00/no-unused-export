import ts from 'typescript'

export function collectPromiseNotAwaitErrors(
  node: ts.Node,
  checker: ts.TypeChecker,
  promiseNotAwaitErrors: CheckError[],
  file: string,
  sourceFile: ts.SourceFile
) {
  if (ts.isCallExpression(node)) {
    if (ts.isReturnStatement(node.parent) || ts.isAwaitExpression(node.parent)) {
      return
    }

    const functionNode = findFunction(node)
    if (!functionNode || !functionNode.modifiers || functionNode.modifiers.every((m) => m.kind !== ts.SyntaxKind.AsyncKeyword)) {
      return
    }

    checkCallExpressionReturnPromise(node, checker, promiseNotAwaitErrors, file, sourceFile)
  } else if (ts.isIfStatement(node) || ts.isWhileStatement(node)) {
    if (ts.isCallExpression(node.expression)) {
      checkCallExpressionReturnPromise(node.expression, checker, promiseNotAwaitErrors, file, sourceFile)
    } else if (ts.isIdentifier(node.expression)) {
      const type = checker.getTypeAtLocation(node.expression)
      checkTypeIsPromise(node, type, promiseNotAwaitErrors, file, sourceFile)
    }
  }
}

function checkCallExpressionReturnPromise(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  promiseNotAwaitErrors: CheckError[],
  file: string,
  sourceFile: ts.SourceFile
) {
  const signature = checker.getResolvedSignature(node)
  if (signature) {
    const returnType = checker.getReturnTypeOfSignature(signature)
    checkTypeIsPromise(node, returnType, promiseNotAwaitErrors, file, sourceFile)
  }
}

function checkTypeIsPromise(
  node: ts.IfStatement | ts.WhileStatement | ts.CallExpression,
  type: ts.Type,
  promiseNotAwaitErrors: CheckError[],
  file: string,
  sourceFile: ts.SourceFile
) {
  if (type.symbol && type.symbol.escapedName === 'Promise') {
    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile))
    const text = ts.isIdentifier(node.expression) ? node.expression.text : ''
    promiseNotAwaitErrors.push({ file, name: text, line, character, type: '' })
  }
}

function findFunction(node: ts.Node) {
  return findParentFunction(node) as ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | undefined
}

function findParentFunction(node: ts.Node): ts.Node | undefined {
  const parent = node.parent
  if (ts.isFunctionDeclaration(parent)
    || ts.isFunctionExpression(parent)
    || ts.isArrowFunction(parent)
    || ts.isMethodDeclaration(parent)) {
    return parent
  }
  if (ts.isSourceFile(parent)) {
    return undefined
  }
  return findParentFunction(parent)
}
