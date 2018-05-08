"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const postcss_scss_1 = require("postcss-scss");
const fs = tslib_1.__importStar(require("fs"));
function check(uniqFiles) {
    const variables = new Map();
    function collectVariablesFromNode(file, node, markedPublic) {
        if (node.type === 'decl') {
            if (!markedPublic && node.prop.startsWith('$') && !variables.has(node.prop)) {
                const variableName = node.prop.substring(1);
                variables.set(variableName, {
                    file,
                    name: variableName,
                    line: node.source.start.line,
                    character: node.source.start.column,
                    type: 'variable'
                });
            }
        }
        else if (node.type === 'rule') {
            if (node.nodes) {
                for (const childNode of node.nodes) {
                    markedPublic = collectVariablesFromNode(file, childNode, markedPublic);
                }
            }
        }
        else if (node.type === 'comment') {
            if (node.text === '@public') {
                return true;
            }
        }
        return false;
    }
    const roots = [];
    for (const fileName of uniqFiles) {
        const root = postcss_scss_1.parse(fs.readFileSync(fileName, { encoding: 'utf8' }));
        roots.push({ fileName, nodes: root.nodes });
        let markedPublic = false;
        for (const node of root.nodes) {
            markedPublic = collectVariablesFromNode(fileName, node, markedPublic);
        }
    }
    // tslint:disable-next-line:cognitive-complexity
    function checkVariablesIsUsedForNode(node) {
        if (variables.size > 0) {
            if (node.type === 'decl') {
                const referencedVariableNames = new Set();
                for (const [variableName] of variables) {
                    if (!referencedVariableNames.has(variableName)
                        && node.value.includes(`$${variableName}`)) {
                        referencedVariableNames.add(variableName);
                    }
                }
                for (const variableName of referencedVariableNames) {
                    variables.delete(variableName);
                }
            }
            else if (node.type === 'rule') {
                if (node.nodes) {
                    for (const childNode of node.nodes) {
                        checkVariablesIsUsedForNode(childNode);
                    }
                }
            }
        }
    }
    for (const root of roots) {
        for (const node of root.nodes) {
            checkVariablesIsUsedForNode(node);
        }
    }
    const unusedVariables = [];
    for (const [_, checkError] of variables) {
        unusedVariables.push(checkError);
    }
    return { unusedVariables };
}
exports.check = check;
