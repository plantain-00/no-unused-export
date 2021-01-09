import ts from 'typescript'
import * as parse5 from 'parse5'

export function collectCanOnlyBePublicErrors(members: ts.NodeArray<ts.ClassElement>, referencedMembers: Set<ts.ClassElement>, templateText: string | undefined, canOnlyBePublicErrors: CheckError[], file: string, sourceFile: ts.SourceFile, classDeclaration: ts.ClassDeclaration) {
  if (templateText && members.length > 0) {
    const fragment = parse5.parseFragment(templateText) as parse5.ChildNode
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

function memberIsUsedInNode(memberName: string, node: parse5.ChildNode): boolean | TemplateType {
  if (node.nodeName.startsWith('#')) {
    if (node.nodeName === '#text') {
      const textNode = node as parse5.TextNode
      return !!textNode.value
        && textNode.value.includes(memberName)
        && !new RegExp(`{{.*'.*${memberName}.*'.*}}`).test(textNode.value)
        && !new RegExp(`{{.*".*${memberName}.*".*}}`).test(textNode.value)
    } else if (node.nodeName === '#document-fragment') {
      for (const childNode of (node as parse5.Element).childNodes) {
        const isUsed = memberIsUsedInNode(memberName, childNode)
        if (isUsed) {
          return isUsed
        }
      }
      return false
    }
  } else {
    const elementNode = node as parse5.Element
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
        const isUsed = memberIsUsedInNode(memberName, childNode)
        if (isUsed) {
          return isUsed
        }
      }
    }
    const content = (elementNode as unknown as { content?: parse5.ChildNode }).content
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

const enum TemplateType {
  angular = 'angular',
  vue = 'vue'
}

export function isAngularAttrName(attrName: string) {
  return attrName.startsWith('*ng')
    || (attrName.startsWith('[') && attrName.endsWith(']'))
    || (attrName.startsWith('(') && attrName.endsWith(')'))
}
