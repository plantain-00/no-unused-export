"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const minimist = require("minimist");
const glob = require("glob");
const flatten = require("lodash.flatten");
const uniq = require("lodash.uniq");
const minimatch = require("minimatch");
const packageJson = require("../package.json");
const ts = require("./ts");
const less = require("./less");
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
    let errorCount = 0;
    const tsFiles = uniqFiles.filter(file => file.toLowerCase().endsWith(".ts") || file.toLowerCase().endsWith(".tsx"));
    if (tsFiles.length > 0) {
        const { unusedExportsErrors, unreferencedMembersErrors } = ts.check(tsFiles);
        if (unusedExportsErrors.length > 0) {
            printInConsole(`unused exported things found, please remove "export" or add "@public":`);
            for (const error of unusedExportsErrors) {
                printInConsole(`${error.file}:${error.line + 1}:${error.character + 2} unused exported ${error.type}: ${error.name}`);
            }
            errorCount += unusedExportsErrors.length;
        }
        if (unreferencedMembersErrors.length > 0) {
            printInConsole(`unreferenced members found, please add "private" or "public":`);
            for (const error of unreferencedMembersErrors) {
                printInConsole(`${error.file}:${error.line + 1}:${error.character + 2} unreferenced ${error.type}: ${error.name}`);
            }
            errorCount += unreferencedMembersErrors.length;
        }
    }
    const lessFiles = uniqFiles.filter(file => file.toLowerCase().endsWith(".less"));
    if (lessFiles.length > 0) {
        const { unusedVariables } = less.check(lessFiles);
        if (unusedVariables.length > 0) {
            printInConsole(`unreferenced less variables found, please remove it or add "@public":`);
            for (const error of unusedVariables) {
                printInConsole(`${error.file}:${error.line}:${error.character} unreferenced less ${error.type}: ${error.name}`);
            }
            errorCount += unusedVariables.length;
        }
    }
    if (errorCount > 0) {
        throw new Error("check no unused export fail.");
    }
}
executeCommandLine().then(() => {
    printInConsole("check no unused export success.");
}, error => {
    printInConsole(error);
    if (!suppressError) {
        process.exit(1);
    }
});
