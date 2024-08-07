
import * as vscode from 'vscode';

export const DefinitionKind = {
    function: 0,
    forward: 1,
} as const;
export type DefinitionKind = typeof DefinitionKind[keyof typeof DefinitionKind];
export type Definition = {
    name: string;
    kind: DefinitionKind;
    document: string;
    range: vscode.Range;
    endsAt: vscode.Position | null | undefined;
};
export const isForward = (def: Definition) => {
    return def.kind === DefinitionKind.forward;
};
export type Dependency = {
    location: vscode.Uri | number;
    loadsAt: vscode.Position;
    type: "load" | "require" | "export" | "use";
};
export type NotebookCache = {
    uri: vscode.Uri;
    notebook: vscode.NotebookDocument;
    cells: {
        index: number;
        fragment: string;
        cache: DocumentCache;
    }[];
};
export type DocumentCache = {
    uri: vscode.Uri;
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

