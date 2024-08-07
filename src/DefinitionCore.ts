
import * as vscode from 'vscode';
import * as Def from './Definition';
import DocumentParser from './DocumentParser';
import INTRINSICS from './Intrinsics';
import getConfig from './config';
import FileHandler from './FileHandler';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { makeRe } from 'minimatch';
import LogObject from './Log';
const { Log, Output } = LogObject.bind("DefinitionCore");
import getLocaleStringBody from './locale';
const getLocaleString = getLocaleStringBody.bind(undefined, "message.DefinitionHandler");

class DefinitionParser{
    protected static FileCache: Def.Caches = {};
    protected static FileExports: Def.ExportData = {};
    protected static diagnosticCollection: vscode.DiagnosticCollection;

    protected static uriToID(uri: vscode.Uri): string{
        return uri.fsPath;
    }
    protected static formatFunctionName(name: string): string{
        const m = /^'([A-Za-z_][A-Za-z0-9_]*)'$/.exec(name);
        if(m){
            return m[1];
        }else{
            return name;
        }
    }
    protected static async createCacheData(uri: vscode.Uri, fullText?: string): Promise<Def.DocumentCache>{
        if(fullText === undefined && uri.scheme === "untitled"){
            Log("untitled skip");
            return {
                uri,
                definitions: [],
                dependencies: []
            };
        }
        const lines = (fullText?.replaceAll("\r", "").split("\n")) ?? (await FileHandler.readFile(uri));
        Output(`Start loading ${uri.path}`);
        let scope: "global" | "inComment";
        scope = "global";
        const parser = new DocumentParser(uri);
        const diagnostics: vscode.Diagnostic[] = [];
        const loadStatementWithAtMark = /^(\s*load\s+")(@.+?)";\s*(\/\/.*)?$/;
        const requireComment = /^(\s*\/\/\s+@requires?\s+")([^"]+)";?.*$/;
        const exportComment = /^(\s*\/\/\s+@exports?\s+")([^"]+)";?.*/;
        const startComment = /^\s*\/\*\*(.*)$/;
        const inComment = /^\s*\*? {0,2}(.*)$/;
        const endComment = /^(.*)\*\/\s*$/;
        const inlineComment = /^\s*\/\*\*(.+?)\*\/\s*$/;
        const startFunction1 = /^((?:function|procedure)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')/;
        const startFunction2 = /^()([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*:=\s*(?:func|proc)\s*</;
        const startFunction3 = /^(forward\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*;\s*$/;
        const startFunction4 = /^(\s*\/\/\s+@define[sd]?\s+(?:function|procedure|intrinsic)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*\(.*\);?\s*$/;
        const endFunction = /^(end\s+(?:function|procedure)\s*;)/;
        const invalidDefinedComment1 = /^(\s*\/\/\s+@define[sd]?)(\s+|\s+.+\s+)(?:[A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*(\(.*\))?;?\s*$/;
        const invalidDefinedComment2 = /^(\s*\/\/\s+@define[sd]?\s+(?:function\s+|procedure\s+|intrinsic\s+|))((?:[A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')(\s*);?)\s*$/;
        const notebookUseStatement = /^(\s*\/\/\s+@uses?\s+)([0-9]+);?.*?$/;
        const isNotebook = !FileHandler.isMagmaFile(uri);
        const definitions: Def.Definition[] = [];
        const dependencies: Def.Dependency[] = [];
        const fileExports: RegExp[] = [];
        Object.entries(this.FileExports).map(([fsPath, patterns]) => {
            const exportedFrom = vscode.Uri.file(fsPath);
            if(patterns.some(pattern => pattern.test(uri.fsPath))){
                Log(`exported from ${fsPath}`);
                dependencies.push({
                    location: exportedFrom,
                    loadsAt: new vscode.Position(0, 0),
                    type: "export"
                });
            }
        });
        for(const idx of lines.keys()){
            const line = lines[idx];
            let m: RegExpExecArray | null;
            Log(`line ${idx}\n    ${line}\n    scope: ${scope}`);
            if(scope === "global"){
                m = inlineComment.exec(line);
                if(m){
                    Log("inlineComment", line);
                    scope = "global";
                    parser.reset();
                    parser.send(m[1]?.trim());
                    continue;
                }
                m = startComment.exec(line);
                if(m){
                    scope = "inComment";
                    parser.reset();
                    parser.send(m[1]?.trimStart());
                    continue;
                }
                if(isNotebook){
                    m = notebookUseStatement.exec(line);
                    if(m){
                        const index = Number(m[2]);
                        if(Number.isFinite(index)){
                            dependencies.push({
                                location: index,
                                loadsAt: new vscode.Position(idx, m[1].length),
                                type: "use"
                            });
                        }
                        continue;
                    }
                }
                if(!FileHandler.hasSaveLocation(uri)){
                    const loadStatementWithAtMark = /^\s*(load)\s+".*$/;
                    const requireComment = /^\s*\/\/\s+(@requires?)\s*.*$/;
                    m = loadStatementWithAtMark.exec(line) ?? requireComment.exec(line);
                    if(m){
                        Log("load statement at untitled file: skip");
                        const range = new vscode.Range(
                            new vscode.Position(idx, 0),
                            new vscode.Position(idx, m[0].length)
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            getLocaleString("loadingAtUntitledFile", m[1]),
                            vscode.DiagnosticSeverity.Warning
                        ));
                        continue;
                    }
                }
                type LoadInfo = {
                    files: vscode.Uri[];
                    type: "load" | "require";
                    prefix: string;
                    query: string;
                };
                const loadInfo: LoadInfo | undefined = await (async () => {
                    m = loadStatementWithAtMark.exec(line);
                    if(m){
                        const prefix = m[1];
                        const query = m[2];
                        return {
                            files: await FileHandler.resolve(uri, query, {
                                useGlob: false,
                                onlyAtMark: true,
                            }),
                            prefix, query,
                            type: "load"
                        };
                    }
                    m = requireComment.exec(line);
                    if(m){
                        const prefix = m[1];
                        const query = m[2];
                        return {
                            files: await FileHandler.resolve(uri, query, {
                                useGlob: true,
                                onlyAtMark: true,
                            }),
                            prefix, query,
                            type: "require"
                        };
                    }
                    return undefined;
                })();
                if(loadInfo){
                    if(loadInfo.files.length){
                        loadInfo.files.forEach(reqUri => {
                            dependencies.push({
                                location: reqUri,
                                loadsAt: new vscode.Position(idx, 0),
                                type: loadInfo.type
                            });
                            // if(!this.isRegistered(reqUri)){
                            //     this.reserveLoad(reqUri);
                            // }
                        });
                        continue;
                    }else{
                        Log("ERROR FOUND");
                        const start = loadInfo.prefix.length;
                        const range = new vscode.Range(
                            new vscode.Position(idx, start),
                            new vscode.Position(idx, start + loadInfo.query.length)
                        );
                        Output(`Not found ${loadInfo.query} at ${uri.path}`);
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            getLocaleString("notFound", loadInfo.query),
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
                m = exportComment.exec(line);
                if(m){
                    if(isNotebook){
                        continue;
                    }
                    const query = m[2];
                    const filePattern = FileHandler.join(FileHandler.base(uri), FileHandler.resolveQuery(query)).fsPath;
                    Log("filePattern", filePattern);
                    try{
                        const pattern: RegExp | false = makeRe(filePattern.replaceAll("\\", "\\\\"));
                        if(pattern){
                            Log("makeRe:", pattern);
                            fileExports.push(pattern);
                        }else{
                            Log("makeRe: false");
                        }
                    }catch{}
                    continue;
                }
                m = startFunction1.exec(line) ??
                    startFunction2.exec(line) ??
                    startFunction3.exec(line) ??
                    startFunction4.exec(line);
                if(m){
                    Log("startFunction", line);
                    const functionName = this.formatFunctionName(m[2]);
                    const start = m[1].length;
                    const nameRange = new vscode.Range(
                        new vscode.Position(idx, start),
                        new vscode.Position(idx, start + functionName.length)
                    );
                    const firstLine = line.trim();
                    parser.setFirstLine(firstLine);
                    definitions.push({
                        name: functionName,
                        document: parser.pop(),
                        isForward: m[1].startsWith("forward"),
                        range: nameRange,
                        endsAt: startFunction1.test(line) ? null : undefined
                    });
                    if(getConfig().warnsWhenRedefiningIntrinsic && !m[1].includes("@define")){
                        if(INTRINSICS.includes(functionName)){
                            diagnostics.push(new vscode.Diagnostic(
                                nameRange,
                                getLocaleString("alreadyDefined", functionName),
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    scope = "global";
                    continue;
                }
                m = endFunction.exec(line);
                if(m){
                    const target = Array.from(definitions.keys()).reverse().find(i => {
                        return definitions[i].endsAt === null;
                    });
                    if(target !== undefined){
                        definitions[target].endsAt = new vscode.Position(idx, m[1].length - 1);
                    }
                    continue;
                }
                m = invalidDefinedComment1.exec(line);
                if(m){
                    const functionType = m[2].trim();
                    const isInvalid = (
                        !["function", "procedure", "intrinsic"].includes(functionType) &&
                        !["function ", "procedure ", "intrinsic "].some(t => functionType.startsWith(t))
                    );
                    if(isInvalid){
                        const start = m[1].length;
                        const range = new vscode.Range(
                            new vscode.Position(idx, start),
                            new vscode.Position(idx, start + m[2].length)
                        );
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            (
                                functionType ?
                                getLocaleString("invalidFunctionType", functionType) :
                                getLocaleString("functionTypeUndefined")
                            ),
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
                m = invalidDefinedComment2.exec(line);
                if(m){
                    const start = m[1].length;
                    const range = new vscode.Range(
                        new vscode.Position(idx, start),
                        new vscode.Position(idx, start + m[2].length)
                    );
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        getLocaleString("missingArguments"),
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
                if(line.trim()){
                    Log("NOT startFunction", line);
                    scope = "global";
                }
            }else if(scope === "inComment"){
                m = endComment.exec(line);
                if(m){
                    scope = "global";
                    parser.send(m[1]?.trim());
                    continue;
                }
                m = inComment.exec(line);
                if(m){
                    parser.send(m[1]);
                    continue;
                }
            }
        }
        this.diagnosticCollection.set(uri, [...diagnostics]);
        this.FileExports[uri.fsPath] = fileExports;
        dependencies.reverse();
        definitions.reverse();
        Log(`Cache(${uri.path})`, definitions, dependencies);
        Output(`Successfully loaded ${uri.path}`);
        return { uri, definitions, dependencies };
    }
};

class DefinitionLoader extends DefinitionParser{
    protected static async requestCache(uri: vscode.Uri, timeout: number = 10): Promise<Def.Cache | undefined>{
        const maxCount = timeout * 2;
        if(!FileHandler.hasSaveLocation(uri)) return undefined;
        const id = this.uriToID(uri);
        for(let i = 0; i < maxCount; i++){
            const cache = this.FileCache[id];
            if(Def.isCache(cache)) return cache;
            await setTimeoutAsync(500);
        }
        return undefined;
    }
    protected static isRegistered(uri: vscode.Uri){
        const id = this.uriToID(uri);
        return this.FileCache.hasOwnProperty(id) && Def.isCache(this.FileCache[id]);
    }
    protected static reserveLoad(uri: vscode.Uri, fullText?: string): void{
        const id = this.uriToID(uri);
        if(this.FileCache[id] !== "reserved"){
            this.FileCache[id] = "reserved";
            this.load(uri, fullText);
        }
    }
    protected static async load(uri: vscode.Uri, fullText?: string): Promise<void>{
        const cache = await this.createCacheData(uri, fullText);
        this.FileCache[this.uriToID(uri)] = cache;
        cache.dependencies.forEach(dep => {
            const uri = dep.location;
            if(typeof uri !== "number" && !this.isRegistered(uri)){
                this.reserveLoad(uri);
            }
        });
    }
    protected static reserveLoadNotebook(notebook: vscode.NotebookDocument): void{
        const id = this.uriToID(notebook.uri);
        if(this.FileCache[id] !== "reserved"){
            this.FileCache[id] = "reserved";
            this.loadNotebook(notebook);
        }
    }
    private static async loadNotebook(notebook: vscode.NotebookDocument): Promise<void>{
        const uri = notebook.uri;
        const cells = notebook.getCells();
        const fullData = await Promise.all(cells
            .filter(cell => cell.kind === vscode.NotebookCellKind.Code)
            .map(async (cell): Promise<[vscode.NotebookCell, Def.DocumentCache]> => {
                const curi = cell.document.uri;
                const data = await this.createCacheData(curi, cell.document.getText());
                const diagnostics = data.dependencies
                .map(dep => {
                    const idx = dep.location;
                    if(typeof idx !== "number") return undefined;
                    const range = new vscode.Range(
                        dep.loadsAt,
                        new vscode.Position(dep.loadsAt.line, dep.loadsAt.character + `${idx}`.length)
                    );
                    if(cells.length <= idx || idx < 0 || cells[idx].kind === vscode.NotebookCellKind.Markup){
                        return new vscode.Diagnostic(
                            range,
                            getLocaleString("cellNotFound", idx),
                            vscode.DiagnosticSeverity.Error
                        );
                    }else if(cell.index === idx){
                        return new vscode.Diagnostic(
                            range,
                            getLocaleString("cellSelfReference"),
                            vscode.DiagnosticSeverity.Error
                        );
                    }else if(cell.index < idx){
                        return new vscode.Diagnostic(
                            range,
                            getLocaleString("cellBackReference"),
                            vscode.DiagnosticSeverity.Error
                        );
                    }
                }).filter(d => d !== undefined);
                if(diagnostics){
                    const prevDiag = this.diagnosticCollection.get(curi);
                    const newDiag = prevDiag ? [...prevDiag, ...diagnostics] : diagnostics;
                    this.diagnosticCollection.set(curi, newDiag);
                }
                return [cell, data];
        }));
        const cache: Def.NotebookCache = {
            uri, notebook,
            cells: fullData.map(([cell, data]) => {
                return {
                    index: cell.index,
                    fragment: cell.document.uri.fragment,
                    cache: {
                        uri: cell.document.uri,
                        definitions: data.definitions,
                        dependencies: data.dependencies,
                    },
                };
            })
        };
        this.FileCache[this.uriToID(uri)] = cache;
        Log("notebook cache:", this.uriToID(uri), cache);
    }
};

export default class DefinitionSearcher extends DefinitionLoader{
    protected static async searchDefinition(document: vscode.TextDocument, position: vscode.Position, options?: Def.SearchDefinitionOptions): Promise<Def.SearchResult | undefined>{
        const functionName = (options?.functionName) ?? this.getFunctionNameOfPosition(document, position);
        if(!functionName) return undefined;
        const stack: Def.DocumentCache[] = [];
        const selfCache = await this.requestCache(document.uri, 2);
        const searchedFiles = new Set<string>();
        const queryBody: ((def: Def.Definition) => boolean) = (options?.onlyForward)
            ? def => def.isForward && def.name === functionName
            : def => def.name === functionName;
        if(!selfCache) return undefined;
        if(Def.isNotebookCache(selfCache)){
            const cell = selfCache.cells.find(cell => cell.fragment === document.uri.fragment);
            if(cell){
                stack.push(cell.cache);
            }
        }else{
            stack.push(selfCache);
        }
        let isSelfCache = true;
        while(stack.length){
            const cache: Def.DocumentCache | undefined = stack.pop();
            if(!cache) continue;
            const uri = cache.uri;
            const query = (isSelfCache)
                ? (dep: Def.Definition) => queryBody(dep) && position.line > dep.range.start.line
                : queryBody;
            searchedFiles.add(this.uriToID(uri));
            const definition = cache.definitions.find(query);
            if(definition){
                Log(`Definition found!`, definition);
                return { uri, definition };
            }
            for(const dep of cache.dependencies){
                if(isSelfCache && position.line < dep.loadsAt.line){
                    continue;
                }
                const { location } = dep;
                if(typeof location === "number"){
                    if(Def.isNotebookCache(selfCache)){
                        const depCell = selfCache.cells.find(cell => cell.index === location);
                        if(depCell){
                            stack.push(depCell.cache);
                        }
                    }
                }else{
                    const id = this.uriToID(location);
                    if(this.FileCache[id] === undefined){
                        this.FileCache[id] = "reserved";
                        await this.load(location);
                    }
                    const depCache = this.FileCache[id];
                    if(Def.isCache(depCache) && !Def.isNotebookCache(depCache) && !searchedFiles.has(id)){
                        stack.push(depCache);
                    }
                }
            };
            isSelfCache = false;
        }
        return undefined;
    }
    public static async searchAllDefinitions(document: vscode.TextDocument, position: vscode.Position, onlyLastDefined: boolean = true): Promise<Def.Definition[]>{
        const stack: Def.DocumentCache[] = [];
        const selfCache = await this.requestCache(document.uri);
        const searchedFiles = new Set<string>();
        const ret: Def.Definition[] = [];
        if(!selfCache) return [];
        if(Def.isNotebookCache(selfCache)){
            const cell = selfCache.cells.find(cell => cell.fragment === document.uri.fragment);
            if(cell){
                stack.push(cell.cache);
            }
        }else{
            stack.push(selfCache);
        }
        let isSelfCache = true;
        while(stack.length){
            const cache: Def.DocumentCache | undefined = stack.pop();
            if(!cache) continue;
            const uri = cache.uri;
            searchedFiles.add(this.uriToID(uri));
            if(onlyLastDefined){
                cache.definitions.forEach(def => {
                    if(ret.every(d => d.name !== def.name)){
                        ret.push(def);
                    }
                });
            }else{
                ret.push(...cache.definitions);
            }
            for(const dep of cache.dependencies){
                if(isSelfCache && position.line < dep.loadsAt.line){
                    continue;
                }
                const { location } = dep;
                if(typeof location === "number"){
                    if(Def.isNotebookCache(selfCache)){
                        const depCell = selfCache.cells.find(cell => cell.index === location);
                        if(depCell){
                            stack.push(depCell.cache);
                        }
                    }
                }else{
                    const id = this.uriToID(location);
                    if(this.FileCache[id] === undefined){
                        this.FileCache[id] = "reserved";
                        await this.load(location);
                    }
                    const depCache = this.FileCache[id];
                    if(Def.isCache(depCache) && !Def.isNotebookCache(depCache) && !searchedFiles.has(id)){
                        stack.push(depCache);
                    }
                }
            };
            isSelfCache = false;
        }
        return ret;
    }
    protected static searchDefinitionAtPosition(document: vscode.TextDocument, position: vscode.Position): Def.Definition | undefined{
        const id = this.uriToID(document.uri);
        const cache = this.FileCache[id];
        if(!Def.isCache(cache)) return undefined;
        const docCache = (Def.isNotebookCache(cache))
            ? (cache.cells.find(cell => cell.fragment === document.uri.fragment)?.cache)
            : cache;
        return docCache?.definitions.find(def => def.range.contains(position));
    }
    protected static async searchDependency(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined>{
        const line = document.lineAt(position.line).text;
        const ch = position.character;
        const pattern = /^(\s*)(load|\/\/\s+@requires?)\s+"[^"]+";?/;
        const m = pattern.exec(line);
        if(!m) return undefined;
        const start = m[1].length;
        const end = m[0].length;
        if(ch < start || end <= ch) return undefined;
        const isLoad = m[2].startsWith("load");

        const cache = await this.requestCache(document.uri);
        if(!cache) return undefined;
        const docCache = Def.isNotebookCache(cache)
            ? cache.cells.find(cell => cell.fragment === document.uri.fragment)?.cache
            : cache;
        if(docCache){
            const getName = (uri: vscode.Uri) => {
                try{
                    return vscode.workspace.asRelativePath(uri);
                }catch{
                    return uri.fsPath;
                }
            };
            if(isLoad){
                const dep = docCache.dependencies.find(dep => {
                    return dep.type === "load" && dep.loadsAt.line === position.line;
                });
                if(dep && typeof dep.location !== "number"){
                    return {
                        contents: [
                            new vscode.MarkdownString(`[${getName(dep.location)}](${dep.location})`)
                        ]
                    };
                }
            }else{
                const deps = docCache.dependencies.filter(dep => {
                    return dep.type === "require" && dep.loadsAt.line === position.line;
                });
                const files = deps.map(dep => {
                    const loc = dep.location;
                    if(typeof loc === "number") return undefined;
                    if(loc.fsPath === document.uri.fsPath) return undefined;
                    return `- [${getName(loc)}](${loc})`;
                }).filter(doc => doc !== undefined);
                return {
                    contents: [new vscode.MarkdownString(`${getLocaleString("matchedFiles")}\n${files.join("\n")}`)]
                };
            }
        }
    }
    private static getFunctionNameOfPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined{
        const symbolPattern = /([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')/;
        const range = document.getWordRangeAtPosition(position, symbolPattern);
        if(range){
            return this.formatFunctionName(document.getText(range));
        }else{
            return undefined;
        }
    }
};
