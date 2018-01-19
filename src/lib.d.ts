declare module '*.json' {
    export const version: string
}

declare module 'postcss-less' {
    export function parse (less: string): Root
    export interface Root {
      nodes: Node[]
    }
    export interface Declaration {
      type: 'decl'
      prop: string
      value: string
      source: Source
    }
    export interface Rule {
      type: 'rule'
      nodes?: Node[]
      selector: string
      source: Source
    }
    export interface Comment {
      type: 'comment'
      inline: boolean
      block: boolean
      text: string
      source: Source
    }
    export interface Source {
      start: {
        line: number;
        column: number;
      }
    }
    export type Node = Declaration | Rule | Comment
}

declare module 'postcss-scss' {
    export function parse (less: string): Root
    export interface Root {
      nodes: Node[]
    }
    export interface Declaration {
      type: 'decl'
      prop: string
      value: string
      source: Source
    }
    export interface Rule {
      type: 'rule'
      nodes?: Node[]
      selector: string
      source: Source
    }
    export interface Comment {
      type: 'comment'
      inline: boolean
      block: boolean
      text: string
      source: Source
    }
    export interface Source {
      start: {
        line: number;
        column: number;
      }
    }
    export type Node = Declaration | Rule | Comment
}

type CheckError = {
  file: string;
  name: string;
  line: number;
  character: number;
  type: string;
}
