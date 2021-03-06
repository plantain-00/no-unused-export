# no-unused-export

[![Dependency Status](https://david-dm.org/plantain-00/no-unused-export.svg)](https://david-dm.org/plantain-00/no-unused-export)
[![devDependency Status](https://david-dm.org/plantain-00/no-unused-export/dev-status.svg)](https://david-dm.org/plantain-00/no-unused-export#info=devDependencies)
[![Build Status: Windows](https://ci.appveyor.com/api/projects/status/github/plantain-00/no-unused-export?branch=master&svg=true)](https://ci.appveyor.com/project/plantain-00/no-unused-export/branch/master)
![Github CI](https://github.com/plantain-00/no-unused-export/workflows/Github%20CI/badge.svg)
[![npm version](https://badge.fury.io/js/no-unused-export.svg)](https://badge.fury.io/js/no-unused-export)
[![Downloads](https://img.shields.io/npm/dm/no-unused-export.svg)](https://www.npmjs.com/package/no-unused-export)
[![type-coverage](https://img.shields.io/badge/dynamic/json.svg?label=type-coverage&prefix=%E2%89%A5&suffix=%&query=$.typeCoverage.atLeast&uri=https%3A%2F%2Fraw.githubusercontent.com%2Fplantain-00%2Fno-used-export%2Fmaster%2Fpackage.json)](https://github.com/plantain-00/no-used-export)

A CLI tool to check whether exported things in a module is used by other modules.

## install

`yarn global add no-unused-export`

## features

+ check whether exported variable, function, type, class, interface in a module is used by other modules
+ check whether public members of class are used outside of the class
+ check whether less or scss variables are used
+ check whether template use non-public members for angular
+ check whether `key` exist for `v-for` and `trackBy` exists for `*ngFor`
+ check whether module `import`ed in source code is also in `dependencies` or `peerDependencies` of `package.json`(enabled by `--strict`)
+ check whether module in `dependencies` or `peerDependencies` of `package.json` is also `import`ed in source code (enabled by `--strict`)
+ check whether call expression returned `Promise` is `await`ed in `async` function or method (enabled by `--strict`)

## usage

`no-unused-export "src/*.ts" "src/*.tsx"`

## options

key | description
--- | ---
--ignore-module | Ignore checking modules provided by runtime
-e,--exclude | exclude source files, repeatable
--need-module | Ignore checking modules used by other imported module
-h,--help | Print this message.
-v,--version | Print the version
--strict | strict mode

### exclude `export`s

```ts
/**
 * @public
 */
export const foo = 1;
```

### `--ignore-module estree`

Ignore checking modules provided by runtime(eg, `fs` module in nodejs program, `vscode` module in vscode plugin program) or only providing types(eg, `estree`), they shouldn't be in `dependencies` or `peerDependencies`

nodejs builtin modules are ignored by default

### `--need-module tslib`

Ignore checking modules used by other imported module(eg, `tslib` by `typescript` when `--importHelpers` enabled), they should be in `dependencies` or `peerDependencies`
