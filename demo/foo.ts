export function a() {
    return 0;
}

export const b = 1;

export type C = number | string;

export class D { }

// tslint:disable-next-line:interface-name
export interface E {
    e: number;
}

/**
 * @public
 */
export const f = 3;

export const g = 4;

// tslint:disable-next-line:no-console
console.log(g);
