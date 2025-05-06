
import * as vscode from 'vscode';

export const DefinitionKind = {
    function: 0,
    forward: 1,
    variable: 2,
} as const;
export type DefinitionKind = typeof DefinitionKind[keyof typeof DefinitionKind];
export type Definition = {
    name: string;
    kind: DefinitionKind;
    enabled: boolean;
    ignored: boolean;
    document: Readonly<vscode.MarkdownString>;
    range: vscode.Range;
    endsAt: vscode.Position | null | undefined;
    definitions: Definition[];
    isArg?: boolean;
    hasPriority?: boolean;
};
export const isForward = (def: Definition) => {
    return def.kind === DefinitionKind.forward;
};

export type CellLocation = number | string;
export const isCellLocation = (obj: any): obj is CellLocation => {
    return typeof obj === "number" || typeof obj === "string";
};
export const IDFromCell = (cell: vscode.NotebookCell): string | undefined => {
    const pattern = /^(?:\s*\/{2,}[^\n]*\n)*?\s*\/{2,}\s+@cell\s+"([^"\n]+)"/;
    const m = pattern.exec(cell.document.getText());
    return m ? m[1] : undefined
};
export const matchCellLocation = (cell: vscode.NotebookCell | {index: number, id?: string}, location: CellLocation) => {
    const isNotebookCell = (obj: any): obj is vscode.NotebookCell => obj.hasOwnProperty("document");
    if(isNotebookCell(cell)){
        if(cell.kind === vscode.NotebookCellKind.Markup) return false;
        const id = IDFromCell(cell);
        return (typeof location === "number" ? cell.index : id) === location;
    }else{
        return (typeof location === "number" ? cell.index : cell.id) === location;
    }
};
export const findCellOfLocation = <T extends {index: number, id?: string}>(cells: T[], location: CellLocation) => {
    if(typeof location === "number" && cells[location]?.index === location) return cells[location];
    return cells.find(cell => matchCellLocation(cell, location));
};

export type Dependency = {
    location: vscode.Uri | CellLocation;
    loadsAt: vscode.Position;
    type: "load" | "require" | "export" | "use";
};
export type NotebookCache = {
    uri: vscode.Uri;
    notebook: vscode.NotebookDocument;
    cells: {
        index: number;
        id?: string;
        fragment: string;
        cache: DocumentCache;
    }[];
};
export type DocumentCache = {
    uri: vscode.Uri;
    document: Readonly<vscode.MarkdownString>;
    definitions: Definition[];
    dependencies: Dependency[];
};
export type Cache = DocumentCache | NotebookCache;
export const isCache = (obj: MaybeCache): obj is Cache => {
    return (
        obj !== "reserved" && obj !== undefined
    );
};
export const isNotebookCache = (cache: Cache): cache is NotebookCache => {
    return cache.hasOwnProperty("cells");
};
export type MaybeCache = Cache | "reserved" | undefined;
export type Caches = {
    [filepath: string]: MaybeCache;
};
export type SearchDefinitionOptions = {
    onlyForward?: boolean;
    functionName?: string;
};
export type SearchResult = {
    uri: vscode.Uri;
    definition: Definition;
};
export type ExportData = {
    [fsPath: string]: RegExp[];
};

export class Scope{
    inComment: boolean = false;
    private scope: number[];
    toString(){ return `[${this.scope}]`; }
    constructor(scope: number[] = [-1]){
        this.scope = [...scope];
    }
    static positionToScope(position: vscode.Position, definitions: Definition[]): Scope{
        const scope: number[] = [];
        let defs = definitions;
        while(true){
            const idx = [...defs.keys()].find(idx => {
                const def = defs[idx];
                return def.kind === DefinitionKind.function &&
                    !!def.endsAt &&
                    def.range.end.compareTo(position) < 0 &&
                    def.endsAt.compareTo(position) > 0;
            });
            if(idx === undefined){
                return new Scope(scope);
            }
            scope.push(idx);
            defs = defs[idx].definitions;
        }
    }
    toDefinition(base: Definition | Definition[]): Definition | undefined{
        const isArr = Array.isArray(base);
        if(!this.scope.length){
            return isArr ? undefined : base;
        }
        let defs = isArr ? base : base.definitions;
        let ret = isArr ? undefined : base;
        for(const idx of this.scope){
            if(idx < 0 || idx >= defs.length){
                return undefined;
            }
            ret = defs[idx];
            defs = ret.definitions;
        }
        return ret;
    }
    toDefinitions(base: Definition[]): Definition[] | undefined{
        if(!this.scope.length) return base;
        let ret: Definition[] = base;
        for(const idx of this.scope){
            if(idx < 0 || idx >= ret.length){
                return undefined;
            }
            ret = ret[idx].definitions;
        }
        return ret;
    }
    isGlobal(){ return !this.scope.length; }
    down(){ this.scope.push(-1); }
    up(){ this.scope.pop(); }
    next(){ this.scope[this.scope.length-1]++; }
    parent(){
        const ret = new Scope(this.scope);
        ret.up();
        return ret;
    }
};

