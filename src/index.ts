import * as minimist from "minimist";
import * as ts from "typescript";
import * as fs from "fs";
import * as glob from "glob";
import * as flatten from "lodash.flatten";
import * as uniq from "lodash.uniq";
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
        getCurrentDirectory() {
            return ".";
        },
        getDefaultLibFileName(options: ts.CompilerOptions) {
            return "";
        },
    });
    const program = ts.createProgram(uniqFiles, { target: ts.ScriptTarget.ESNext });
    const errors: { file: string; name: string; line: number; character: number; type: string }[] = [];
    function collectErrors(file: string, identifier: ts.Identifier | undefined, sourceFile: ts.SourceFile, type: string) {
        if (identifier) {
            const references = languageService.getReferencesAtPosition(file, identifier.pos + 1);
            if (references && references.every(r => r.fileName === file)) {
                const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, identifier.pos);
                errors.push({ file, name: identifier.text, line, character, type });
            }
        }
    }
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
        });
    }
    if (errors.length > 0) {
        printInConsole(`unused exported things found, please remove "export" or add "@public":`);
        for (const error of errors) {
            printInConsole(`${error.file}:${error.line + 1}:${error.character + 2} unused exported ${error.type}: ${error.name}`);
        }
        throw new Error("fail");
    }
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

try {
    executeCommandLine().then(() => {
        printInConsole("success.");
    }, error => {
        if (error.stdout) {
            printInConsole(error.stdout);
            process.exit(error.status);
        } else {
            printInConsole(error);
            process.exit(1);
        }
    });
} catch (error) {
    if (error.stdout) {
        printInConsole(error.stdout);
        process.exit(error.status);
    } else {
        printInConsole(error);
        process.exit(1);
    }
}
