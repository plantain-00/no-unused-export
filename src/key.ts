
import ts from 'typescript'
import * as parse5 from 'parse5'

export function collectMissingKeyErrors(propertyName: string, propertyInitialize: ts.Expression, templateText: string | undefined, missingKeyErrors: CheckError[], file: string, sourceFile: ts.SourceFile) {
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
