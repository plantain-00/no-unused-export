export function aa() {
    return 0;
}

export const bb = 1;

export type Cc = number | string;

declare const Component: any;

@Component({
    template: `<div v-if="d2" :class="'d6'">foo{{"d7"}}bar{{d8}}</div>`,
    props: ["d1"],
})
export class Dd {
    d1: number;
    d2: number;
    d3: number;
    d4: number;
    private d5: number;
    constructor() { }
    mounted() { }
    d6: number;
    d7: number;
    private d8: number;
}

const angularTemplateHtml = `<div *ngIf="d2"></div>`;

declare const Input: any;
declare const Output: any;
declare class EventEmitter<T>{ }

@Component({
    selector: "df",
    template: angularTemplateHtml,
    host: {
        "[id]": "d5",
    },
})
class Df {
    d1: number;
    d2: number;
    @Input()
    d3: number;
    @Output()
    d4 = new EventEmitter<any>();
    d5: string;
    @Input()
    get d6() { return 1; }
    set d6(value: number) { /* do nothing*/ }
}

@Component({
    selector: "dg",
    templateUrl: "./dg.html",
})
class Dg {
    d1: number;
    d2: number;
    d3: number;
}

const a = new Dd().d4;

export interface Ee {
    e: number;
}

/**
 * @public
 */
export const ff = 3;

export const gg = 4;

console.log(gg);

export const hh = 5;

@Component({
    template: `<div v-for="(child, i) in i1"></div>`,
})
class Ii {
    i1: number[];
}

@Component({
    template: `<div v-for="(child, i) in i1" key="i"></div>`,
})
class Jj {
    j1: number[];
}

@Component({
    template: `<div *ngFor="let item of k1"></div>`,
})
class Kk {
    k1: number[];
}

@Component({
    template: `<div *ngFor="let item of k1; trackBy:trackByFunction"></div>`,
})
class Ll {
    l1: number[];
}

@Component({
    template: `<template v-for="(child, i) in i1"></template>`,
})
class Mm {
}

async function foo() {
  bar()
  return 1
}

function bar() {
  return Promise.resolve(1)
}
