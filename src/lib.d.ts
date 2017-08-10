declare module "*.json" {
    export const version: string;
}

declare module "lodash.flatten" {
    function flatten<T>(array: T[][]): T[];
    export = flatten;
    namespace flatten { }
}
declare module "lodash.uniq" {
    function uniq<T>(array: T[]): T[];
    export = uniq;
    namespace uniq { }
}
