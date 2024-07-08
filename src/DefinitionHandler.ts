
import * as vscode from 'vscode';
import getConfig from './config';
import DocumentParser from './DocumentParser';
import INTRINSICS from './Intrinsics';
import LogObject from './Log';
import FileHandler from './FileHandler';
const { Log, Output } = LogObject.bind("DefinitionHandler");

type Definition = {
    name: string;
    document: string;
    isForward: boolean;
    range: vscode.Range;
};
type Dependency = {
    uri: vscode.Uri;
    loadsAt: vscode.Position;
};
type Cache = {
    uri: vscode.Uri;
    definitions: Definition[];
    dependencies: Dependency[];
};
const isCache = (obj: MaybeCache): obj is Cache => {
    return (
        obj !== "reserved" && obj !== undefined
    );
};
type MaybeCache = Cache | "reserved" | undefined;
type Caches = {
    [filepath: string]: MaybeCache;
};
type SearchDefinitionOptions = {
    onlyForward?: boolean;
    functionName?: string;
};
type SearchResult = {
    uri: vscode.Uri;
    definition: Definition;
};

class DefProvider implements vscode.DefinitionProvider{
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if(getConfig().enableDefinition){
            return DefinitionHandler.onDefinitionCall(document, position);
        }else{
            return undefined;
        }
    }
};
class HoverProvider implements vscode.HoverProvider{
    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        if(getConfig().enableHover){
            return DefinitionHandler.onHoverCall(document, position);
        }else{
            return undefined;
        }
    }
};

export default class DefinitionHandler{
    private static FileCache: Caches = {};
    private static dirtyChangeTimeout: NodeJS.Timeout | undefined = undefined;
    private static diagnosticCollection: vscode.DiagnosticCollection;
    private static isEnabled(){
        const config = getConfig();
        return config.enableDefinition || config.enableHover;
    }
    static setProviders(context: vscode.ExtensionContext){
        context.subscriptions.push(vscode.languages.registerDefinitionProvider({
            scheme: "file",
            language: "magma"
        }, new DefProvider()));
        context.subscriptions.push(vscode.languages.registerHoverProvider({
            scheme: "file",
            language: "magma"
        }, new HoverProvider()));
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection("magma");
        context.subscriptions.push(this.diagnosticCollection);
    }
    static onDidChange(e: vscode.TextDocumentChangeEvent){
        if(e.document.isUntitled){
            Log("isUntitled");
            return;
        }
        this.dirtyChangeTimeout = undefined;
        if(!this.isEnabled()) return;
        const uri = e.document.uri;
        const fullText = e.document.getText();
        if(e.reason === vscode.TextDocumentChangeReason.Redo || e.reason === vscode.TextDocumentChangeReason.Undo){
            setTimeout(() => {
                this.load(uri, fullText);
            }, 500);
        }else{
            this.reserveLoad(uri, fullText);
        }
    }
    static onDidDirtyChange(e: vscode.TextDocumentChangeEvent){
        clearTimeout(this.dirtyChangeTimeout);
        this.dirtyChangeTimeout = setTimeout(() => {
            if(this.dirtyChangeTimeout){
                this.onDidChange(e);
            }
        }, getConfig().onChangeDelay);
    }
    static onDidOpen(e: vscode.TextDocument){
        if(!this.isEnabled()) return;
        if(e.isUntitled){
            Log("isUntitled");
            return;
        }
        const uri = e.uri;
        if(!this.isRegistered(uri)){
            Log("open registering!");
            this.reserveLoad(uri);
        }else{
            Log("Already registered");
        }
    }
    static async onDefinitionCall(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined>{
        const result = await this.searchDefinition(document, position);
        if(result){
            return {
                uri: result.uri,
                range: result.definition.range
            };
        }else{
            return undefined;
        }
    }
    static async onHoverCall(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined>{
        const selfDef = this.searchDefinitionAtPosition(document, position);
        if(selfDef){
            if(selfDef.isForward){
                return {
                    contents: [new vscode.MarkdownString(selfDef.document)]
                };
            }
            const forward = await this.searchDefinition(document, position, {
                onlyForward: true,
                functionName: selfDef.name
            });
            if(forward){
                return {
                    contents: [
                        new vscode.MarkdownString(forward.definition.document),
                        new vscode.MarkdownString(`[ファイルの場所を開く](${forward.uri})`),
                        new vscode.MarkdownString("---"),
                        new vscode.MarkdownString(selfDef.document)
                    ]
                };
            }else{
                return {
                    contents: [new vscode.MarkdownString(selfDef.document)]
                };
            }
        }else{
            const result = await this.searchDefinition(document, position);
            if(result){
                const documentBody = new vscode.MarkdownString(result.definition.document);
                const contents = [documentBody];
                return { contents };
            }else{
                return undefined;
            }
        }
    }
    private static async searchDefinition(document: vscode.TextDocument, position: vscode.Position, options?: SearchDefinitionOptions): Promise<SearchResult | undefined>{
        const baseUri = document.uri;
        const id = this.uriToID(baseUri);
        const functionName = (options?.functionName) ?? this.getFunctionNameOfPosition(document, position);
        if(!functionName) return undefined;
        const stack: Cache[] = [];
        const selfCache: MaybeCache = this.FileCache[id];
        const searchedFiles = new Set<string>();
        const queryBody: ((def: Definition) => boolean) = (options?.onlyForward)
            ? def => def.isForward && def.name === functionName
            : def => def.name === functionName;
        if(isCache(selfCache)){
            stack.push(selfCache);
        }
        while(stack.length){
            const cache: Cache | undefined = stack.pop();
            if(!cache) continue;
            const uri = cache.uri;
            const query = (uri.fsPath === baseUri.fsPath)
                ? (dep: Definition) => queryBody(dep) && position.line > dep.range.start.line
                : queryBody;
            searchedFiles.add(this.uriToID(uri));
            const definition = cache.definitions.find(query);
            if(definition){
                Log(`Definition found!`, definition);
                return { uri, definition };
            }
            for(const dep of cache.dependencies){
                if(uri.fsPath === baseUri.fsPath && position.line < dep.loadsAt.line){
                    continue;
                }
                const id = this.uriToID(dep.uri);
                if(this.FileCache[id] === undefined){
                    this.FileCache[id] = "reserved";
                    await this.load(dep.uri);
                }
                const depCache = this.FileCache[id];
                if(isCache(depCache) && !searchedFiles.has(id)){
                    stack.push(depCache);
                }
            };
        }
        return undefined;
    }
    static async searchAllDefinitions(document: vscode.TextDocument, position: vscode.Position): Promise<Definition[]>{
        const baseUri = document.uri;
        const id = this.uriToID(baseUri);
        const stack: Cache[] = [];
        const selfCache: MaybeCache = this.FileCache[id];
        const searchedFiles = new Set<string>();
        const ret: Definition[] = [];
        if(isCache(selfCache)){
            stack.push(selfCache);
        }
        while(stack.length){
            const cache: Cache | undefined = stack.pop();
            if(!cache) continue;
            const uri = cache.uri;
            searchedFiles.add(this.uriToID(uri));
            ret.push(...cache.definitions);
            for(const dep of cache.dependencies){
                if(uri.fsPath === baseUri.fsPath && position.line < dep.loadsAt.line){
                    continue;
                }
                const id = this.uriToID(dep.uri);
                if(this.FileCache[id] === undefined){
                    this.FileCache[id] = "reserved";
                    await this.load(dep.uri);
                }
                const depCache = this.FileCache[id];
                if(isCache(depCache) && !searchedFiles.has(id)){
                    stack.push(depCache);
                }
            };
        }
        return ret;
    }
    private static searchDefinitionAtPosition(document: vscode.TextDocument, position: vscode.Position): Definition | undefined{
        const id = this.uriToID(document.uri);
        const cache = this.FileCache[id];
        if(!cache || cache === "reserved") return undefined;
        return cache.definitions.find(def => def.range.contains(position));
    }
    private static getFunctionNameOfPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined{
        const def = this.searchDefinitionAtPosition(document, position);
        if(def){
            const name = def.name;
            Log(`found as definition: ${name}`);
            return name;
        }
        const line = document.lineAt(position.line).text.replace("\r", "");
        const beforeText = line.substring(0, position.character);
        const afterText = line.substring(position.character);
        const beforePat = /(|[A-Za-z_][A-Za-z0-9_]*|'([^'\n]|\\')*)$/;
        const afterPat = (useSingleQuotation: boolean, isEmpty: boolean): RegExp => {
            if(useSingleQuotation){
                return /^(([^'\n]|\\')*')\s*\(/;
            }else if(isEmpty){
                return /^([A-Za-z_][A-Za-z0-9_]*|'([^'\n]|\\')*')\s*\(/;
            }else{
                return /^([A-Za-z0-9_]*)\s*\(/;
            }
        };
        const beforeMatch = beforePat.exec(beforeText);
        if(!beforeMatch){
            Log(`before not matched`);
            return undefined;
        }
        const before = beforeMatch[1];
        const afterMatch = afterPat(before.startsWith("'"), !before).exec(afterText);
        if(!afterMatch){
            Log(`after not matched`);
            return undefined;
        }
        const after = afterMatch[1];
        const name = before + after;
        const validatePat = /^([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')$/;
        if(!validatePat.test(name)){
            Log(`not validate: ${name}`);
            return undefined;
        }
        Log(`name found: ${name}`);
        return this.formatFunctionName(name);
    }

    private static uriToID(uri: vscode.Uri): string{
        return uri.toString();
    }
    private static isRegistered(uri: vscode.Uri){
        const id = this.uriToID(uri);
        return this.FileCache.hasOwnProperty(id) && isCache(this.FileCache[id]);
    }
    private static reserveLoad(uri: vscode.Uri, fullText?: string): void{
        const id = this.uriToID(uri);
        if(this.FileCache[id] !== "reserved"){
            this.FileCache[id] = "reserved";
            this.load(uri, fullText);
        }
    }
    private static async load(uri: vscode.Uri, fullText?: string): Promise<void>{
        const lines = (fullText?.replaceAll("\r", "").split("\n")) ?? (await FileHandler.readFile(uri));
        Output(`Start loading ${uri.path}`);
        let scope: "global" | "inComment";
        scope = "global";
        const parser = new DocumentParser(uri);
        const diagnostics: vscode.Diagnostic[] = [];
        const loadStatementWithAtMark = /^(\s*load\s+")(@.+?)";\s*(\/\/.*)?$/;
        const requireComment = /^(\s*\/\/\s+@requires?\s+")([^"]+)";?.*$/;
        const startComment = /^\s*\/\*\*(.*)$/;
        const inComment = /^\s*\*? {0,2}(.*)$/;
        const endComment = /^(.*)\*\/\s*$/;
        const inlineComment = /^\s*\/\*\*(.+?)\*\/\s*$/;
        const startFunction1 = /^((?:function|procedure)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')/;
        const startFunction2 = /^()([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*:=\s*(?:func|proc)\s*</;
        const startFunction3 = /^(forward\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*;\s*$/;
        const startFunction4 = /^(\s*\/\/\s+@define[sd]?\s+(?:function|procedure|intrinsic)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*\(.*\);?\s*$/;
        const invalidDefinedComment1 = /^(\s*\/\/\s+@define[sd]?)(\s+|\s+.+\s+)(?:[A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*(\(.*\))?;?\s*$/;
        const invalidDefinedComment2 = /^(\s*\/\/\s+@define[sd]?\s+(?:function\s+|procedure\s+|intrinsic\s+|))((?:[A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')(\s*);?)\s*$/;
        const cache: Cache = {
            uri,
            definitions: [],
            dependencies: []
        };
        for(const idx of lines.keys()){
            const line = lines[idx];
            let m: RegExpExecArray | null;
            Log(`line ${idx}\n    ${line}\n    scope: ${scope}`);
            if(scope === "global"){
                m = inlineComment.exec(line);
                if(m){
                    Log("inlineComment", line);
                    scope = "global";
                    parser.send(m[1]?.trim());
                    continue;
                }
                m = startComment.exec(line);
                if(m){
                    scope = "inComment";
                    parser.send(m[1]?.trimStart());
                    continue;
                }
                let loadPrefix: string = "";
                let loadFilePattern: string = "";
                const loadFiles = await (async () => {
                    m = loadStatementWithAtMark.exec(line);
                    if(m){
                        loadPrefix = m[1];
                        loadFilePattern = m[2];
                        return FileHandler.resolve(uri, loadFilePattern, {
                            useGlob: false,
                            onlyAtMark: true,
                        });
                    }
                    m = requireComment.exec(line);
                    if(m){
                        loadPrefix = m[1];
                        loadFilePattern = m[2];
                        return FileHandler.resolve(uri, loadFilePattern, {
                            useGlob: true,
                            onlyAtMark: true,
                        });
                    }
                    return undefined;
                })();
                if(loadFiles !== undefined){
                    if(loadFiles.length){
                        loadFiles.forEach(reqUri => {
                            cache.dependencies.push({
                                uri: reqUri,
                                loadsAt: new vscode.Position(idx, 0)
                            });
                            if(!this.isRegistered(reqUri)){
                                this.reserveLoad(reqUri);
                            }
                        });
                        continue;
                    }else{
                        Log("ERROR FOUND");
                        const start = loadPrefix.length;
                        const range = new vscode.Range(
                            new vscode.Position(idx, start),
                            new vscode.Position(idx, start + loadFilePattern.length)
                        );
                        Output(`Not found ${loadFilePattern} at ${uri.path}`);
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `ファイルが見つかりません． パターン: ${loadFilePattern}`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
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
                    cache.definitions.push({
                        name: functionName,
                        document: parser.pop(),
                        isForward: m[1].startsWith("forward"),
                        range: nameRange
                    });
                    if(getConfig().warnsWhenRedefiningIntrinsic && !m[1].includes("@define")){
                        if(INTRINSICS.includes(functionName)){
                            diagnostics.push(new vscode.Diagnostic(
                                nameRange,
                                `関数 ${functionName} はMagmaの組み込み関数として定義されています．他の関数名への変更をお勧めします．`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    scope = "global";
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
                                `${functionType} は無効な識別子です．\nfunction, procedure, intrinsic のいずれかを指定してください．` :
                                `function, procedure, intrinsic のいずれかを指定する必要があります．`
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
                        `括弧と引数も含めて定義してください．`,
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
        cache.dependencies.reverse();
        cache.definitions.reverse();
        Log(`Cache(${uri.path})`, cache);
        Output(`Successfully loaded ${uri.path}`);
        this.FileCache[this.uriToID(uri)] = cache;
    }
    private static formatFunctionName(name: string): string{
        const m = /^'([A-Za-z_][A-Za-z0-9_]*)'$/.exec(name);
        if(m){
            return m[1];
        }else{
            return name;
        }
    }
};
