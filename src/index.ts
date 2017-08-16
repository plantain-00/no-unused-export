import * as minimist from "minimist";
import * as ts from "typescript";
import * as fs from "fs";
import * as glob from "glob";
import * as path from "path";
import flatten = require("lodash.flatten");
import uniq = require("lodash.uniq");
import * as minimatch from "minimatch";
import * as packageJson from "../package.json";

function printInConsole(message: any) {
    // tslint:disable-next-line:no-console
    console.log(message);
}

function showToolVersion() {
    printInConsole(`Version: ${packageJson.version}`);
}

function globAsync(pattern: string) {
    return new Promise<string[]>((resolve, reject) => {
        glob(pattern, (error, matches) => {
            if (error) {
                reject(error);
            } else {
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

    const inputFiles = argv._;
    if (inputFiles.length === 0) {
        throw new Error("expect the path of source files");
    }

    const excludeFilesString: string | undefined = argv.e || argv.exclude;
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
        getScriptVersion(fileName: string) {
            return "";
        },
        getScriptSnapshot(fileName: string) {
            if (fileName === ".ts") {
                return ts.ScriptSnapshot.fromString("");
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, { encoding: "utf8" }));
        },
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getDefaultLibFileName(options: ts.CompilerOptions) {
            return ts.getDefaultLibFilePath(options);
        },
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    });
    const program = ts.createProgram(uniqFiles, { target: ts.ScriptTarget.ESNext });
    const unusedExportsErrors: { file: string; name: string; line: number; character: number; type: string }[] = [];
    function collectErrors(file: string, identifier: ts.Identifier | undefined, sourceFile: ts.SourceFile, type: string) {
        if (identifier) {
            const references = languageService.getReferencesAtPosition(file, identifier.end);
            if (references && references.every(r => r.fileName === file)) {
                const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.end - identifier.text.length - 1);
                unusedExportsErrors.push({ file, name: identifier.text, line, character, type });
            }
        }
    }
    const unreferencedMembersErrors: { file: string; name: string; line: number; character: number; type: string }[] = [];
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
                                        break;
                                    }
                                }
                            }
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
                                                    if (property.initializer.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                                                        || property.initializer.kind === ts.SyntaxKind.StringLiteral) {
                                                        const text = (property.initializer as ts.NoSubstitutionTemplateLiteral | ts.StringLiteral).text;
                                                        for (const member of members) {
                                                            if (!referencedMembers.has(member)
                                                                && text.includes((member.name as ts.Identifier).text)) {
                                                                referencedMembers.add(member);
                                                            }
                                                        }
                                                    } else if (property.initializer.kind === ts.SyntaxKind.Identifier) {
                                                        const identifier = property.initializer as ts.Identifier;
                                                        const definitions = languageService.getDefinitionAtPosition(file, identifier.end);
                                                        if (definitions && definitions.length > 0) {
                                                            const definition = definitions[0];
                                                            const child = findNodeAtDefinition(program, definition);
                                                            if (child && child.kind === ts.SyntaxKind.VariableStatement) {
                                                                const text = getVariableValue(child, definition.name);
                                                                if (text) {
                                                                    for (const member of members) {
                                                                        if (!referencedMembers.has(member)
                                                                            && text.includes((member.name as ts.Identifier).text)) {
                                                                            referencedMembers.add(member);
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                } else if (propertyName === "props") {
                                                    if (property.initializer.kind === ts.SyntaxKind.ArrayLiteralExpression) {
                                                        const elements = (property.initializer as ts.ArrayLiteralExpression).elements;
                                                        for (const member of members) {
                                                            if (!referencedMembers.has(member)
                                                                && elements.some(e => e.kind === ts.SyntaxKind.StringLiteral
                                                                    && (e as ts.StringLiteral).text === (member.name as ts.Identifier).text)) {
                                                                referencedMembers.add(member);
                                                            }
                                                        }
                                                    }
                                                } else if (propertyName === "templateUrl") {
                                                    if (property.initializer.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                                                        || property.initializer.kind === ts.SyntaxKind.StringLiteral) {
                                                        const url = (property.initializer as ts.NoSubstitutionTemplateLiteral | ts.StringLiteral).text;
                                                        let text: string | undefined;
                                                        try {
                                                            text = fs.readFileSync(path.resolve(path.dirname(file), url), { encoding: "utf8" });
                                                        } catch (error) {
                                                            // no action
                                                        }
                                                        if (text) {
                                                            for (const member of members) {
                                                                if (!referencedMembers.has(member)
                                                                    && text.includes((member.name as ts.Identifier).text)) {
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

                for (const member of members) {
                    if (!referencedMembers.has(member)) {
                        const identifier = member.name as ts.Identifier;
                        const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.end - identifier.text.length - 1);
                        unreferencedMembersErrors.push({ file, name: identifier.text, line, character, type: `class ${classDeclaration.name!.text} member` });
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
    let result: ts.Node | undefined;
    program.getSourceFile(definition.fileName).forEachChild(child => {
        if (child.pos < definition.textSpan.start && child.end > definition.textSpan.start + definition.textSpan.length) {
            result = child;
        }
    });
    return result;
}

function getVariableValue(child: ts.Node, variableName: string) {
    const declarations = (child as ts.VariableStatement).declarationList.declarations;
    for (const declaration of declarations) {
        if (declaration.kind === ts.SyntaxKind.VariableDeclaration) {
            const name = (declaration as ts.VariableDeclaration).name;
            if (name.kind === ts.SyntaxKind.Identifier
                && (name as ts.Identifier).text === variableName) {
                const initializer = (declaration as ts.VariableDeclaration).initializer;
                if (initializer
                    && (initializer.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                        || initializer.kind === ts.SyntaxKind.StringLiteral)) {
                    return (initializer as ts.NoSubstitutionTemplateLiteral | ts.StringLiteral).text;
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

executeCommandLine().then(() => {
    printInConsole("check no unused export success.");
}, error => {
    printInConsole(error);
    process.exit(1);
});
