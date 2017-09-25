"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const parse5 = require("parse5");
function check(uniqFiles) {
    const languageService = ts.createLanguageService({
        getCompilationSettings() {
            return {};
        },
        getScriptFileNames() {
            return uniqFiles;
        },
        getScriptVersion(fileName) {
            return "";
        },
        getScriptSnapshot(fileName) {
            if (fileName === ".ts") {
                return ts.ScriptSnapshot.fromString("");
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, { encoding: "utf8" }));
        },
        getCurrentDirectory: () => ".",
        getDefaultLibFileName(options) {
            return ts.getDefaultLibFilePath(options);
        },
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    });
    const program = ts.createProgram(uniqFiles, { target: ts.ScriptTarget.ESNext });
    const unusedExportsErrors = [];
    function collectErrors(file, identifier, sourceFile, type) {
        if (identifier) {
            const references = languageService.getReferencesAtPosition(file, identifier.end);
            if (references && references.every(r => r.fileName === file)) {
                const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile));
                unusedExportsErrors.push({ file, name: identifier.text, line, character, type });
            }
        }
    }
    const unreferencedMembersErrors = [];
    const canOnlyBePublicErrors = [];
    for (const file of uniqFiles) {
        const sourceFile = program.getSourceFile(file);
        sourceFile.forEachChild(node => {
            if (node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                const jsDocs = getJsDocs(node);
                const isPublic = jsDocs.find(jsDoc => jsDoc.name === "public");
                if (!isPublic) {
                    if (node.kind === ts.SyntaxKind.TypeAliasDeclaration) {
                        collectErrors(file, node.name, sourceFile, "type");
                    }
                    else if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
                        collectErrors(file, node.name, sourceFile, "function");
                    }
                    else if (node.kind === ts.SyntaxKind.ClassDeclaration) {
                        collectErrors(file, node.name, sourceFile, "class");
                    }
                    else if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
                        collectErrors(file, node.name, sourceFile, "interface");
                    }
                    else if (node.kind === ts.SyntaxKind.VariableStatement) {
                        const declarationList = node.declarationList;
                        for (const declaration of declarationList.declarations) {
                            collectErrors(file, declaration.name, sourceFile, "variable");
                        }
                    }
                }
            }
            if (node.kind === ts.SyntaxKind.ClassDeclaration) {
                const referencedMembers = new Set();
                const decoratedMembers = new Set();
                const classDeclaration = node;
                const members = classDeclaration.members;
                for (const member of members) {
                    if (member.kind === ts.SyntaxKind.Constructor) {
                        referencedMembers.add(member);
                    }
                    else if (member.modifiers
                        && member.modifiers.some(m => m.kind === ts.SyntaxKind.PublicKeyword
                            || m.kind === ts.SyntaxKind.PrivateKeyword
                            || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
                        referencedMembers.add(member);
                    }
                    else {
                        const identifier = member.name;
                        if (hookNames.includes(identifier.text)) {
                            referencedMembers.add(member);
                        }
                        else if (member.decorators) {
                            for (const decorator of member.decorators) {
                                if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
                                    const { expression } = decorator.expression;
                                    const text = expression.text;
                                    if (text === "Input" || text === "Output") {
                                        referencedMembers.add(member);
                                        decoratedMembers.add(identifier.text);
                                        break;
                                    }
                                }
                            }
                        }
                        else if (decoratedMembers.has(identifier.text)) {
                            referencedMembers.add(member);
                        }
                        if (!referencedMembers.has(member)) {
                            const references = languageService.getReferencesAtPosition(file, identifier.end);
                            if (references
                                && references.some(r => r.fileName !== file
                                    || r.textSpan.start < node.pos
                                    || r.textSpan.start > node.end)) {
                                referencedMembers.add(member);
                            }
                        }
                    }
                }
                const decorators = classDeclaration.decorators;
                if (decorators) {
                    for (const decorator of decorators) {
                        if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
                            const { expression, arguments: expressionArguments } = decorator.expression;
                            if (expression.text === "Component") {
                                if (expressionArguments.length > 0) {
                                    const argument = expressionArguments[0];
                                    if (argument.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                                        const properties = argument.properties;
                                        for (const property of properties) {
                                            if (property.kind === ts.SyntaxKind.PropertyAssignment) {
                                                const propertyName = property.name.text;
                                                if (propertyName === "template") {
                                                    const text = getText(program, languageService, file, property.initializer);
                                                    checkMemberUsedInTemplate(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration);
                                                }
                                                else if (propertyName === "props") {
                                                    if (property.initializer.kind === ts.SyntaxKind.ArrayLiteralExpression) {
                                                        const elements = property.initializer.elements;
                                                        for (const member of members) {
                                                            if (!referencedMembers.has(member)
                                                                && elements.some(e => getText(program, languageService, file, e) === member.name.text)) {
                                                                referencedMembers.add(member);
                                                            }
                                                        }
                                                    }
                                                }
                                                else if (propertyName === "templateUrl") {
                                                    const url = getText(program, languageService, file, property.initializer);
                                                    if (url) {
                                                        let text;
                                                        try {
                                                            text = fs.readFileSync(path.resolve(path.dirname(file), url), { encoding: "utf8" });
                                                        }
                                                        catch (error) {
                                                            // no action
                                                        }
                                                        checkMemberUsedInTemplate(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration);
                                                    }
                                                }
                                                else if (propertyName === "host") {
                                                    if (property.initializer.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                                                        const hostProperties = property.initializer.properties;
                                                        for (const hostProperty of hostProperties) {
                                                            if (hostProperty.kind === ts.SyntaxKind.PropertyAssignment) {
                                                                const key = getText(program, languageService, file, hostProperty.name);
                                                                if (key && isAngularAttrName(key)) {
                                                                    const text = getText(program, languageService, file, hostProperty.initializer);
                                                                    checkMemberUsedInTemplate(members, referencedMembers, text, canOnlyBePublicErrors, file, sourceFile, classDeclaration);
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
                    }
                }
                for (const member of members) {
                    if (!referencedMembers.has(member)) {
                        const identifier = member.name;
                        const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile));
                        unreferencedMembersErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name.text} member` });
                    }
                }
            }
        });
    }
    return { unusedExportsErrors, unreferencedMembersErrors, canOnlyBePublicErrors };
}
exports.check = check;
function checkMemberUsedInTemplate(members, referencedMembers, templateText, canOnlyBePublicErrors, file, sourceFile, classDeclaration) {
    if (templateText && members.length > 0) {
        const fragment = parse5.parseFragment(templateText);
        for (const member of members) {
            const identifier = member.name;
            if (identifier) {
                const templateType = isUsedInNode(identifier.text, fragment);
                if (templateType) {
                    if (!referencedMembers.has(member)) {
                        referencedMembers.add(member);
                    }
                    if (templateType !== "vue" /* vue */
                        && member.modifiers
                        && member.modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword
                            || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
                        const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile));
                        canOnlyBePublicErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name.text} member` });
                    }
                }
            }
        }
    }
}
function isUsedInNode(memberName, node) {
    if (node.nodeName.startsWith("#")) {
        if (node.nodeName === "#text") {
            const textNode = node;
            return !!textNode.value
                && textNode.value.includes(memberName)
                && !new RegExp(`{{.*'.*${memberName}.*'.*}}`).test(textNode.value)
                && !new RegExp(`{{.*".*${memberName}.*".*}}`).test(textNode.value);
        }
        else if (node.nodeName === "#document-fragment") {
            for (const childNode of node.childNodes) {
                const isUsed = isUsedInNode(memberName, childNode);
                if (isUsed) {
                    return isUsed;
                }
            }
            return false;
        }
    }
    else {
        const elementNode = node;
        if (elementNode.attrs) {
            for (const attr of elementNode.attrs) {
                let templateType;
                if (isVuejsAttrName(attr.name)) {
                    templateType = "vue" /* vue */;
                }
                else if (isAngularAttrName(attr.name)) {
                    templateType = "angular" /* angular */;
                }
                if (templateType) {
                    const isUsed = attr.value
                        && attr.value.includes(memberName)
                        && !new RegExp(`'.*${memberName}.*'`).test(attr.value)
                        && !new RegExp(`".*${memberName}.*"`).test(attr.value);
                    if (isUsed) {
                        return templateType;
                    }
                }
            }
        }
        if (elementNode.childNodes) {
            for (const childNode of elementNode.childNodes) {
                const isUsed = isUsedInNode(memberName, childNode);
                if (isUsed) {
                    return isUsed;
                }
            }
        }
        const content = elementNode.content;
        if (content) {
            return isUsedInNode(memberName, content);
        }
    }
    return false;
}
function isVuejsAttrName(attrName) {
    return attrName.startsWith("v-")
        || attrName.startsWith(":")
        || attrName.startsWith("@");
}
function isAngularAttrName(attrName) {
    return attrName.startsWith("*ng")
        || (attrName.startsWith("[") && attrName.endsWith("]"))
        || (attrName.startsWith("(") && attrName.endsWith(")"));
}
function getText(program, languageService, file, node) {
    if (node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
        || node.kind === ts.SyntaxKind.StringLiteral) {
        return node.text;
    }
    else if (node.kind === ts.SyntaxKind.Identifier) {
        const identifier = node;
        const definitions = languageService.getDefinitionAtPosition(file, identifier.end);
        if (definitions && definitions.length > 0) {
            const definition = definitions[0];
            const child = findNodeAtDefinition(program, definition);
            if (child && child.kind === ts.SyntaxKind.VariableStatement) {
                return getVariableValue(child, definition.name, program, languageService, file);
            }
        }
    }
    return undefined;
}
const hookNames = [
    "beforeCreate", "created",
    "beforeMount", "mounted",
    "beforeUpdate", "updated",
    "activated", "deactivated",
    "beforeDestroy", "destroyed",
    "render",
    "componentWillMount", "componentDidMount",
    "componentWillReceiveProps",
    "shouldComponentUpdate",
    "componentWillUpdate", "componentDidUpdate",
    "componentWillUnmount",
    "ngOnInit",
    "ngOnChanges",
    "ngDoCheck",
    "ngOnDestroy",
    "ngAfterContentInit",
    "ngAfterContentChecked",
    "ngAfterViewInit",
    "ngAfterViewChecked",
];
function findNodeAtDefinition(program, definition) {
    const sourceFile = program.getSourceFile(definition.fileName);
    if (sourceFile) {
        return sourceFile.forEachChild(child => {
            if (child.pos < definition.textSpan.start && child.end > definition.textSpan.start + definition.textSpan.length) {
                return child;
            }
            return undefined;
        });
    }
    return undefined;
}
function getVariableValue(child, variableName, program, languageService, file) {
    const declarations = child.declarationList.declarations;
    for (const declaration of declarations) {
        if (declaration.kind === ts.SyntaxKind.VariableDeclaration) {
            const name = declaration.name;
            if (name.kind === ts.SyntaxKind.Identifier
                && name.text === variableName) {
                const initializer = declaration.initializer;
                if (initializer) {
                    return getText(program, languageService, file, initializer);
                }
            }
        }
    }
    return undefined;
}
function getJsDocs(node) {
    const jsDocs = node.jsDoc;
    const result = [];
    if (jsDocs && jsDocs.length > 0) {
        for (const jsDoc of jsDocs) {
            if (jsDoc.tags) {
                for (const tag of jsDoc.tags) {
                    result.push({
                        name: tag.tagName.text,
                        comment: tag.comment,
                    });
                }
            }
        }
    }
    return result;
}
