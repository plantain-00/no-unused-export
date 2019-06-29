import ts from 'typescript'

export function collectUnreferencedMembersErrors(
  referencedMembers: Set<ts.ClassElement>,
  unreferencedMembersErrors: CheckError[],
  file: string,
  sourceFile: ts.SourceFile,
  classDeclaration: ts.ClassDeclaration
) {
  for (const member of classDeclaration.members) {
    if (!referencedMembers.has(member)) {
      const identifier = member.name as ts.Identifier
      const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile))
      unreferencedMembersErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name!.text} member` })
    }
  }
}

// tslint:disable-next-line:cognitive-complexity
export function collectReferencedMembers(
  classDeclaration: ts.ClassDeclaration,
  languageService: ts.LanguageService,
  file: string,
  node: ts.Node
) {
  const referencedMembers = new Set<ts.ClassElement>()
  const decoratedMembers = new Set<string>()
  for (const member of classDeclaration.members) {
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
  return referencedMembers
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
