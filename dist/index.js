"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const minimist = require("minimist");
const ts = require("typescript");
const fs = require("fs");
const glob = require("glob");
const path = require("path");
const flatten = require("lodash.flatten");
const uniq = require("lodash.uniq");
const minimatch = require("minimatch");
const packageJson = require("../package.json");
let suppressError = false;
function printInConsole(message) {
    if (message instanceof Error) {
        message = message.message;
    }
    // tslint:disable-next-line:no-console
    console.log(message);
}
function showToolVersion() {
    printInConsole(`Version: ${packageJson.version}`);
}
function globAsync(pattern) {
    return new Promise((resolve, reject) => {
        glob(pattern, (error, matches) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(matches);
            }
        });
    });
}
async function executeCommandLine() {
    const argv = minimist(process.argv.slice(2), { "--": true });
    const showVersion = argv.v || argv.version;
    if (showVersion) {
        showToolVersion();
        return;
    }
    suppressError = argv.suppressError;
    const inputFiles = argv._;
    if (inputFiles.length === 0) {
        throw new Error("expect the path of source files");
    }
    const excludeFilesString = argv.e || argv.exclude;
    const excludeFiles = excludeFilesString ? excludeFilesString.split(",") : [];
    const files = await Promise.all(inputFiles.map(file => globAsync(file)));
    let uniqFiles = uniq(flatten(files));
    if (excludeFiles && excludeFiles.length > 0) {
        uniqFiles = uniqFiles.filter(file => excludeFiles.every(excludeFile => !minimatch(file, excludeFile)));
    }
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
                const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.end - identifier.text.length - 1);
                unusedExportsErrors.push({ file, name: identifier.text, line, character, type });
            }
        }
    }
    const unreferencedMembersErrors = [];
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
                                                    if (text) {
                                                        for (const member of members) {
                                                            if (!referencedMembers.has(member)
                                                                && text.includes(member.name.text)) {
                                                                referencedMembers.add(member);
                                                            }
                                                        }
                                                    }
                                                }
                                                else if (propertyName === "props") {
                                                    if (property.initializer.kind === ts.SyntaxKind.ArrayLiteralExpression) {
                                                        const elements = property.initializer.elements;
                                                        for (const member of members) {
                                                            if (!referencedMembers.has(member)
                                                                && elements.some(e => e.kind === ts.SyntaxKind.StringLiteral
                                                                    && e.text === member.name.text)) {
                                                                referencedMembers.add(member);
                                                            }
                                                        }
                                                    }
                                                }
                                                else if (propertyName === "templateUrl") {
                                                    if (property.initializer.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                                                        || property.initializer.kind === ts.SyntaxKind.StringLiteral) {
                                                        const url = property.initializer.text;
                                                        let text;
                                                        try {
                                                            text = fs.readFileSync(path.resolve(path.dirname(file), url), { encoding: "utf8" });
                                                        }
                                                        catch (error) {
                                                            // no action
                                                        }
                                                        if (text) {
                                                            for (const member of members) {
                                                                if (!referencedMembers.has(member)
                                                                    && text.includes(member.name.text)) {
                                                                    referencedMembers.add(member);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                else if (propertyName === "host") {
                                                    if (property.initializer.kind === ts.SyntaxKind.ObjectLiteralExpression) {
                                                        const hostProperties = property.initializer.properties;
                                                        for (const hostProperty of hostProperties) {
                                                            if (hostProperty.kind === ts.SyntaxKind.PropertyAssignment) {
                                                                const text = getText(program, languageService, file, hostProperty.initializer);
                                                                if (text) {
                                                                    for (const member of members) {
                                                                        if (!referencedMembers.has(member)
                                                                            && text.includes(member.name.text)) {
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
                for (const member of members) {
                    if (!referencedMembers.has(member)) {
                        const identifier = member.name;
                        const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.end - identifier.text.length - 1);
                        unreferencedMembersErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name.text} member` });
                    }
                }
            }
        });
    }
    if (unusedExportsErrors.length > 0) {
        printInConsole(`unused exported things found, please remove "export" or add "@public":`);
        for (const error of unusedExportsErrors) {
            printInConsole(`${error.file}:${error.line + 1}:${error.character + 2} unused exported ${error.type}: ${error.name}`);
        }
    }
    if (unreferencedMembersErrors.length > 0) {
        printInConsole(`unreferenced members found, please add "private" or "public":`);
        for (const error of unreferencedMembersErrors) {
            printInConsole(`${error.file}:${error.line + 1}:${error.character + 2} unreferenced ${error.type}: ${error.name}`);
        }
    }
    if (unusedExportsErrors.length > 0 || unreferencedMembersErrors.length > 0) {
        throw new Error("check no unused export fail.");
    }
}
function getText(program, languageService, file, initializer) {
    if (initializer.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
        || initializer.kind === ts.SyntaxKind.StringLiteral) {
        return initializer.text;
    }
    else if (initializer.kind === ts.SyntaxKind.Identifier) {
        const identifier = initializer;
        const definitions = languageService.getDefinitionAtPosition(file, identifier.end);
        if (definitions && definitions.length > 0) {
            const definition = definitions[0];
            const child = findNodeAtDefinition(program, definition);
            if (child && child.kind === ts.SyntaxKind.VariableStatement) {
                return getVariableValue(child, definition.name);
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
    let result;
    program.getSourceFile(definition.fileName).forEachChild(child => {
        if (child.pos < definition.textSpan.start && child.end > definition.textSpan.start + definition.textSpan.length) {
            result = child;
        }
    });
    return result;
}
function getVariableValue(child, variableName) {
    const declarations = child.declarationList.declarations;
    for (const declaration of declarations) {
        if (declaration.kind === ts.SyntaxKind.VariableDeclaration) {
            const name = declaration.name;
            if (name.kind === ts.SyntaxKind.Identifier
                && name.text === variableName) {
                const initializer = declaration.initializer;
                if (initializer
                    && (initializer.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                        || initializer.kind === ts.SyntaxKind.StringLiteral)) {
                    return initializer.text;
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
executeCommandLine().then(() => {
    printInConsole("check no unused export success.");
}, error => {
    printInConsole(error);
    if (!suppressError) {
        process.exit(1);
    }
});
