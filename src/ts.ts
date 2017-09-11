import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as parse5 from "parse5";

export function check(uniqFiles: string[]) {
    const languageService = ts.createLanguageService({
        getCompilationSettings() {
            return {};
        },
        getScriptFileNames() {
            return uniqFiles;
        },
        getScriptVersion(fileName: string) {
            return "";
        },
        getScriptSnapshot(fileName: string) {
            if (fileName === ".ts") {
                return ts.ScriptSnapshot.fromString("");
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, { encoding: "utf8" }));
        },
        getCurrentDirectory: () => ".",
        getDefaultLibFileName(options: ts.CompilerOptions) {
            return ts.getDefaultLibFilePath(options);
        },
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    });
    const program = ts.createProgram(uniqFiles, { target: ts.ScriptTarget.ESNext });
    const unusedExportsErrors: CheckError[] = [];
    function collectErrors(file: string, identifier: ts.Identifier | undefined, sourceFile: ts.SourceFile, type: string) {
        if (identifier) {
            const references = languageService.getReferencesAtPosition(file, identifier.end);
            if (references && references.every(r => r.fileName === file)) {
                const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile));
                unusedExportsErrors.push({ file, name: identifier.text, line, character, type });
            }
        }
    }
    const unreferencedMembersErrors: CheckError[] = [];
    for (const file of uniqFiles) {
        const sourceFile = program.getSourceFile(file);
        sourceFile.forEachChild(node => {
            if (node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                const jsDocs = getJsDocs(node);
                const isPublic = jsDocs.find(jsDoc => jsDoc.name === "public");
                if (!isPublic) {
                    if (node.kind === ts.SyntaxKind.TypeAliasDeclaration) {
                        collectErrors(file, (node as ts.TypeAliasDeclaration).name, sourceFile, "type");
                    } else if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
                        collectErrors(file, (node as ts.FunctionDeclaration).name, sourceFile, "function");
                    } else if (node.kind === ts.SyntaxKind.ClassDeclaration) {
                        collectErrors(file, (node as ts.ClassDeclaration).name, sourceFile, "class");
                    } else if (node.kind === ts.SyntaxKind.InterfaceDeclaration) {
                        collectErrors(file, (node as ts.InterfaceDeclaration).name, sourceFile, "interface");
                    } else if (node.kind === ts.SyntaxKind.VariableStatement) {
                        const declarationList = (node as ts.VariableStatement).declarationList;
                        for (const declaration of declarationList.declarations) {
                            collectErrors(file, declaration.name as ts.Identifier, sourceFile, "variable");
                        }
                    }
                }
            }

            if (node.kind === ts.SyntaxKind.ClassDeclaration) {
                const referencedMembers = new Set<ts.ClassElement>();
                const decoratedMembers = new Set<string>();
                const classDeclaration = node as ts.ClassDeclaration;
                const members = classDeclaration.members;
                for (const member of members) {
                    if (member.kind === ts.SyntaxKind.Constructor) {
                        referencedMembers.add(member);
                    } else if (member.modifiers
                        && member.modifiers.some(m => m.kind === ts.SyntaxKind.PublicKeyword
                            || m.kind === ts.SyntaxKind.PrivateKeyword
                            || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
                        referencedMembers.add(member);
                    } else {
                        const identifier = member.name as ts.Identifier;
                        if (hookNames.includes(identifier.text)) {
                            referencedMembers.add(member);
                        } else if (member.decorators) {
                            for (const decorator of member.decorators) {
                                if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
                                    const { expression } = decorator.expression as ts.CallExpression;
                                    const text = (expression as ts.Identifier).text;
                                    if (text === "Input" || text === "Output") {
                                        referencedMembers.add(member);
                                        decoratedMembers.add(identifier.text);
                                        break;
                                    }
                                }
                            }
                        } else if (decoratedMembers.has(identifier.text)) {
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
                            const { expression, arguments: expressionArguments } = decorator.expression as ts.CallExpression;
                            if ((expression as ts.Identifier).text === "Component") {
                                if (expressionArguments.length > 0) {
                                    const argument = expressionArguments[0];
                                    if (argument.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                                        const properties = (argument as ts.ObjectLiteralExpression).properties;
                                        for (const property of properties) {
                                            if (property.kind === ts.SyntaxKind.PropertyAssignment) {
                                                const propertyName = (property.name as ts.Identifier).text;
                                                if (propertyName === "template") {
                                                    const text = getText(program, languageService, file, property.initializer);
                                                    if (text) {
                                                        for (const member of members) {
                                                            if (!referencedMembers.has(member)
                                                                && isUsedInTemplate((member.name as ts.Identifier).text, text)) {
                                                                referencedMembers.add(member);
                                                            }
                                                        }
                                                    }
                                                } else if (propertyName === "props") {
                                                    if (property.initializer.kind === ts.SyntaxKind.ArrayLiteralExpression) {
                                                        const elements = (property.initializer as ts.ArrayLiteralExpression).elements;
                                                        for (const member of members) {
                                                            if (!referencedMembers.has(member)
                                                                && elements.some(e => getText(program, languageService, file, e) === (member.name as ts.Identifier).text)) {
                                                                referencedMembers.add(member);
                                                            }
                                                        }
                                                    }
                                                } else if (propertyName === "templateUrl") {
                                                    const url = getText(program, languageService, file, property.initializer);
                                                    if (url) {
                                                        let text: string | undefined;
                                                        try {
                                                            text = fs.readFileSync(path.resolve(path.dirname(file), url), { encoding: "utf8" });
                                                        } catch (error) {
                                                            // no action
                                                        }
                                                        if (text) {
                                                            for (const member of members) {
                                                                if (!referencedMembers.has(member)
                                                                    && isUsedInTemplate((member.name as ts.Identifier).text, text)) {
                                                                    referencedMembers.add(member);
                                                                }
                                                            }
                                                        }
                                                    }
                                                } else if (propertyName === "host") {
                                                    if (property.initializer.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                                                        const hostProperties = (property.initializer as ts.ObjectLiteralExpression).properties;
                                                        for (const hostProperty of hostProperties) {
                                                            if (hostProperty.kind === ts.SyntaxKind.PropertyAssignment) {
                                                                const key = getText(program, languageService, file, hostProperty.name);
                                                                if (key && isAngularAttrName(key)) {
                                                                    const text = getText(program, languageService, file, hostProperty.initializer);
                                                                    if (text) {
                                                                        for (const member of members) {
                                                                            if (!referencedMembers.has(member)
                                                                                && isUsedInTemplate((member.name as ts.Identifier).text, text)) {
                                                                                referencedMembers.add(member);
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
                        }
                    }
                }

                for (const member of members) {
                    if (!referencedMembers.has(member)) {
                        const identifier = member.name as ts.Identifier;
                        const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.getStart(sourceFile));
                        unreferencedMembersErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name!.text} member` });
                    }
                }
            }
        });
    }
    return { unusedExportsErrors, unreferencedMembersErrors };
}

function isUsedInTemplate(memberName: string, html: string) {
    const fragment = parse5.parseFragment(html) as parse5.AST.Default.DocumentFragment;
    return isUsedInNode(memberName, fragment);
}

function isUsedInNode(memberName: string, node: parse5.AST.Default.Node): boolean {
    if (node.nodeName.startsWith("#")) {
        if (node.nodeName === "#text") {
            const textNode = node as parse5.AST.Default.TextNode;
            return !!textNode.value
                && textNode.value.includes(memberName)
                && !new RegExp(`{{.*'.*${memberName}.*'.*}}`).test(textNode.value)
                && !new RegExp(`{{.*".*${memberName}.*".*}}`).test(textNode.value);
        } else if (node.nodeName === "#document-fragment") {
            for (const childNode of (node as parse5.AST.Default.DocumentFragment).childNodes) {
                const isUsed = isUsedInNode(memberName, childNode as parse5.AST.Default.Element);
                if (isUsed) {
                    return true;
                }
            }
            return false;
        }
    } else {
        const elementNode = node as parse5.AST.Default.Element;
        if (elementNode.attrs) {
            for (const attr of elementNode.attrs) {
                const isUsed = (isVuejsAttrName(attr.name) || isAngularAttrName(attr.name))
                    && attr.value
                    && attr.value.includes(memberName)
                    && !new RegExp(`'.*${memberName}.*'`).test(attr.value)
                    && !new RegExp(`".*${memberName}.*"`).test(attr.value);
                if (isUsed) {
                    return true;
                }
            }
        }
        if (elementNode.childNodes) {
            for (const childNode of elementNode.childNodes) {
                const isUsed = isUsedInNode(memberName, childNode as parse5.AST.Default.Element);
                if (isUsed) {
                    return true;
                }
            }
        }
        const content: parse5.AST.Default.DocumentFragment = (elementNode as any).content;
        if (content) {
            return isUsedInNode(memberName, content);
        }
    }
    return false;
}

function isVuejsAttrName(attrName: string) {
    return attrName.startsWith("v-")
        || attrName.startsWith(":")
        || attrName.startsWith("@");
}

function isAngularAttrName(attrName: string) {
    return attrName.startsWith("*ng")
        || (attrName.startsWith("[") && attrName.endsWith("]"))
        || (attrName.startsWith("(") && attrName.endsWith(")"));
}

function getText(program: ts.Program, languageService: ts.LanguageService, file: string, node: ts.Node): string | undefined {
    if (node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
        || node.kind === ts.SyntaxKind.StringLiteral) {
        return (node as ts.NoSubstitutionTemplateLiteral | ts.StringLiteral).text;
    } else if (node.kind === ts.SyntaxKind.Identifier) {
        const identifier = node as ts.Identifier;
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

function findNodeAtDefinition(program: ts.Program, definition: ts.DefinitionInfo) {
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

function getVariableValue(child: ts.Node, variableName: string, program: ts.Program, languageService: ts.LanguageService, file: string) {
    const declarations = (child as ts.VariableStatement).declarationList.declarations;
    for (const declaration of declarations) {
        if (declaration.kind === ts.SyntaxKind.VariableDeclaration) {
            const name = (declaration as ts.VariableDeclaration).name;
            if (name.kind === ts.SyntaxKind.Identifier
                && (name as ts.Identifier).text === variableName) {
                const initializer = (declaration as ts.VariableDeclaration).initializer;
                if (initializer) {
                    return getText(program, languageService, file, initializer);
                }
            }
        }
    }
    return undefined;
}

function getJsDocs(node: ts.Node) {
    const jsDocs: ts.JSDoc[] | undefined = (node as any).jsDoc;
    const result: JsDoc[] = [];
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

type JsDoc = {
    name: string;
    comment: string | undefined;
};
