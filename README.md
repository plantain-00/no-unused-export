[![Dependency Status](https://david-dm.org/plantain-00/no-unused-export.svg)](https://david-dm.org/plantain-00/no-unused-export)
[![devDependency Status](https://david-dm.org/plantain-00/no-unused-export/dev-status.svg)](https://david-dm.org/plantain-00/no-unused-export#info=devDependencies)
[![Build Status: Linux](https://travis-ci.org/plantain-00/no-unused-export.svg?branch=master)](https://travis-ci.org/plantain-00/no-unused-export)
[![Build Status: Windows](https://ci.appveyor.com/api/projects/status/github/plantain-00/no-unused-export?branch=master&svg=true)](https://ci.appveyor.com/project/plantain-00/no-unused-export/branch/master)
[![npm version](https://badge.fury.io/js/no-unused-export.svg)](https://badge.fury.io/js/no-unused-export)
[![Downloads](https://img.shields.io/npm/dm/no-unused-export.svg)](https://www.npmjs.com/package/no-unused-export)

# no-used-export
A CLI tool to check whether exported things in a module is used by other modules.

#### install

`npm i no-unused-export -g`

#### features

+ check whether exported variable, function, type, class, interface in a module is used by other modules
+ check whether public members of class are used outside of the class
+ check whether less or scss variables are used

#### usage

`no-unused-export "src/*.ts"`

##### exclude source files

`no-unused-export "src/*.ts" --exclude "src/*.d.ts"`

multiple `exclude`s can be seperated by `,`

##### exclude `export`s

```ts
/**
 * @public
 */
export const foo = 1;
```
