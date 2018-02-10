"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
}
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
}
Object.defineProperty(exports, "__esModule", { value: true });
const minimist_1 = __importDefault(require("minimist"));
const glob_1 = __importDefault(require("glob"));
const packageJson = __importStar(require("../package.json"));
const ts = __importStar(require("./ts"));
const less = __importStar(require("./less"));
const scss = __importStar(require("./scss"));
let suppressError = false;
function showToolVersion() {
    console.log(`Version: ${packageJson.version}`);
}
function globAsync(pattern, ignore) {
    return new Promise((resolve, reject) => {
        glob_1.default(pattern, { ignore }, (error, matches) => {
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
    const argv = minimist_1.default(process.argv.slice(2), { '--': true });
    const showVersion = argv.v || argv.version;
    if (showVersion) {
        showToolVersion();
        return;
    }
    suppressError = argv.suppressError;
    const inputFiles = argv._;
    if (inputFiles.length === 0) {
        throw new Error('expect the path of source files');
    }
    const exclude = argv.e || argv.exclude;
    let excludeFiles = [];
    if (Array.isArray(exclude)) {
        for (const e of exclude) {
            excludeFiles = excludeFiles.concat(e.split(','));
        }
    }
    else if (exclude) {
        excludeFiles = excludeFiles.concat(exclude.split(','));
    }
    const uniqFiles = await globAsync(inputFiles.length === 1 ? inputFiles[0] : `{${inputFiles.join(',')}}`, excludeFiles);
    let errorCount = 0;
    const tsFiles = uniqFiles.filter(file => file.toLowerCase().endsWith('.ts') || file.toLowerCase().endsWith('.tsx'));
    if (tsFiles.length > 0) {
        const { unusedExportsErrors, unreferencedMembersErrors, canOnlyBePublicErrors, missingKeyErrors } = ts.check(tsFiles);
        if (unusedExportsErrors.length > 0) {
            console.log(`unused exported things found, please remove "export" or add "@public":`);
            for (const error of unusedExportsErrors) {
                console.log(`${error.file}:${error.line + 1}:${error.character + 1} unused exported ${error.type}: ${error.name}`);
            }
            errorCount += unusedExportsErrors.length;
        }
        if (unreferencedMembersErrors.length > 0) {
            console.log(`unreferenced members found, please add "private" or "public":`);
            for (const error of unreferencedMembersErrors) {
                console.log(`${error.file}:${error.line + 1}:${error.character + 1} unreferenced ${error.type}: ${error.name}`);
            }
            errorCount += unreferencedMembersErrors.length;
        }
        if (canOnlyBePublicErrors.length > 0) {
            console.log(`non-public members that used in template found, will be error when it works with angular AOT, please remove the modifier:`);
            for (const error of canOnlyBePublicErrors) {
                console.log(`${error.file}:${error.line + 1}:${error.character + 1} non-public ${error.type}: ${error.name}`);
            }
            errorCount += canOnlyBePublicErrors.length;
        }
        if (missingKeyErrors.length > 0) {
            console.log(`key is missing in the template, please add it:`);
            for (const error of missingKeyErrors) {
                console.log(`${error.file}:${error.line + 1}:${error.character + 1} missing 'key' or 'trackBy' for ${error.type}: ${error.name}`);
            }
            errorCount += missingKeyErrors.length;
        }
    }
    const lessFiles = uniqFiles.filter(file => file.toLowerCase().endsWith('.less'));
    if (lessFiles.length > 0) {
        const { unusedVariables } = less.check(lessFiles);
        if (unusedVariables.length > 0) {
            console.log(`unreferenced less variables found, please remove it or add "@public":`);
            for (const error of unusedVariables) {
                console.log(`${error.file}:${error.line}:${error.character} unreferenced less ${error.type}: ${error.name}`);
            }
            errorCount += unusedVariables.length;
        }
    }
    const scssFiles = uniqFiles.filter(file => file.toLowerCase().endsWith('.scss'));
    if (scssFiles.length > 0) {
        const { unusedVariables } = scss.check(scssFiles);
        if (unusedVariables.length > 0) {
            console.log(`unreferenced scss variables found, please remove it or add "@public":`);
            for (const error of unusedVariables) {
                console.log(`${error.file}:${error.line}:${error.character} unreferenced scss ${error.type}: ${error.name}`);
            }
            errorCount += unusedVariables.length;
        }
    }
    if (errorCount > 0) {
        throw new Error('check no unused export fail.');
    }
}
executeCommandLine().then(() => {
    console.log('check no unused export success.');
}, error => {
    if (error instanceof Error) {
        console.log(error.message);
    }
    else {
        console.log(error);
    }
    if (!suppressError) {
        process.exit(1);
    }
});
