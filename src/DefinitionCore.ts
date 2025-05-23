
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
                document: new vscode.MarkdownString(""),
                definitions: [],
                dependencies: []
            };
        }
        const config = getConfig();
        const lines = (fullText?.replaceAll("\r", "").split("\n")) ?? (await FileHandler.readFile(uri));
        Output(`Start loading ${uri.path}`);
        const scope = new Def.Scope();
        const parser = new DocumentParser(uri);
        const diagnostics: vscode.Diagnostic[] = [];
        const ignoreComment1 = /^(\s*\/{2,}\s+@ignores?)\s+(this|none|all|(forwards?|variables?|functions?)(\s*,\s*(forwards?|variables?|functions?))*)\b.*?$/;
        const ignoreComment2 = /^(\s*\/{2,}\s+@(?:internal|ignores?))()\b.*?$/;
        const priorityComment = /^(\s*\/{2,}\s+@(priority|priorityInCompletion))\b.*?$/;
        let globalIgnoreType: ("forwards" | "functions" | "variables")[] = [];
        let isToBeIgnored: boolean = false;
        const loadStatementWithAtMark = /^(\s*load\s+")(@[^"]+)";\s*.*$/;
        const requireComment = /^(\s*\/{2,}\s+@requires?\s+")([^"]+)";?.*$/;
        const exportComment = /^(\s*\/{2,}\s+@exports?\s+")([^"]+)";?.*/;
        const startComment = /^\s*\/\*\*(.*)$/;
        const startNonDocumentComment = /^\s*\/\*(.*)$/;
        const inComment = /^\s*\*? {0,2}(.*)$/;
        const endComment = /^(.*)\*\/\s*$/;
        const inlineComment = /^\s*\/\*\*(.+?)\*\/\s*$/;
        const inlineNonDocumentComment = /^\s*\/\*(.*?)\*\/\s*$/;
        const maybeDocumentInlineComment = /^\s*(\/{2,})((?:\s+[^@\s]|[^@\/\s]).*)$/;
        const comp1 = /([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')/.source;
        const comp2 =  `(${comp1}|${comp1}\\s*<\\s*${comp1}\\s*>)`;
        const comp3 = `^(\\s*)(${comp2}(\\s*,\\s*${comp2})*)\\s*:=\\s*`;
        const assignVariable = RegExp(comp3);
        const startFunctionWithArgs = /^(\s*(?:function|procedure)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*\(\s*(([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')(\s*,\s*([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)'))*)/;
        const startFunction1 = /^(\s*(?:function|procedure)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')/;
        const startFunction2 = /^(\s*)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*:=\s*(?:func|proc)\s*</;
        const startFunction3 = /^(\s*forward\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*;\s*$/;
        const startFunction4 = /^(\s*\/{2,}\s+@define[sd]?\s+(?:function|procedure|intrinsic)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*\(.*\);?\s*$/;
        const definedVariable = /^(\s*\/{2,}\s+@define[sd]?\s+variable\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*;?\s*$/;
        const endFunction = /^(\s*end\s+(?:function|procedure)\s*;)/;
        const invalidDefinedComment1 = /^(\s*\/{2,}\s+@define[sd]?)(\s+|\s+.+\s+)(?:[A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*(\(.*\))?;?\s*$/;
        const invalidDefinedComment2 = /^(\s*\/{2,}\s+@define[sd]?\s+(?:function\s+|procedure\s+|intrinsic\s+|))((?:[A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')(\s*);?)\s*$/;
        const invalidDefinedComment3 = /^(\s*\/{2,}\s+@define[sd]?\s+variable\s+(?:[A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*)(\(.*\));?\s*?$/;
        const notebookUseStatement = /^(\s*\/{2,}\s+@uses?\s+)([0-9]+|"[^"\n]+");?.*?$/;
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
            if(!scope.inComment){
                m = ignoreComment1.exec(line) ?? ignoreComment2.exec(line);
                if(m){
                    Log("ignoreComment", line);
                    const targets = m[2]?.trim();
                    if(!targets || targets === "this"){
                        isToBeIgnored = true;
                    }else if(targets === "none"){
                        globalIgnoreType = [];
                    }else if(targets === "all"){
                        globalIgnoreType = ["forwards", "functions", "variables"];
                    }else{
                        globalIgnoreType = Array.from(new Set(targets.split(/\s*,\s*/).map(type => {
                            if(type.startsWith("forward")) return "forwards";
                            if(type.startsWith("function")) return "functions";
                            else return "variables"
                        })));
                    }
                    continue;
                }
                m = priorityComment.exec(line);
                if(m){
                    parser.grantPriority();
                    continue;
                }
                m = inlineComment.exec(line);
                if(m){
                    Log("inlineComment", line);
                    scope.inComment = false;
                    parser.send(m[1]?.trim());
                    parser.endComment();
                    continue;
                }
                m = inlineNonDocumentComment.exec(line);
                if(m){
                    Log("inlineNonDocumentComment", line);
                    scope.inComment = false;
                    continue;
                }
                m = maybeDocumentInlineComment.exec(line);
                if(m){
                    Log("maybeDocumentInlineComment");
                    const slashNum = m[1].length;
                    const { useLastInlineCommentAsDoc } = config;
                    const available = (useLastInlineCommentAsDoc === true) || (
                        useLastInlineCommentAsDoc === "tripleSlash" && slashNum >= 3
                    );
                    if(available){
                        if(!parser.isEmpty) parser.reset();
                        parser.sendMaybeDocument(m[2]?.trim());
                        parser.endComment();
                    }else{
                        parser.reset();
                    }
                    continue;
                }
                m = startComment.exec(line);
                if(m){
                    scope.inComment = true;
                    parser.send(m[1]?.trimStart());
                    continue;
                }
                m = startNonDocumentComment.exec(line);
                if(m){
                    scope.inComment = true;
                    parser.disable();
                    continue;
                }
                if(isNotebook){
                    m = notebookUseStatement.exec(line);
                    if(m){
                        parser.reset(false);
                        const location = (() => {
                            if(m[2].startsWith('"')){
                                const id = m[2].slice(1, -1);
                                return id || undefined;
                            }else{
                                const idx = Number(m[2]);
                                return Number.isFinite(idx) ? idx : undefined;
                            }
                        })();
                        if(location !== undefined){
                            dependencies.push({
                                location,
                                loadsAt: new vscode.Position(idx, m[1].length),
                                type: "use"
                            });
                        }
                        continue;
                    }
                }
                if(!FileHandler.hasSaveLocation(uri)){
                    const loadStatementWithAtMark = /^\s*(load)\s+".*$/;
                    const requireComment = /^\s*\/{2,}\s+(@requires?)\s*.*$/;
                    m = loadStatementWithAtMark.exec(line) ?? requireComment.exec(line);
                    if(m){
                        parser.reset(false);
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
                    parser.reset(false);
                    if(loadInfo.files.length){
                        loadInfo.files.forEach(reqUri => {
                            dependencies.push({
                                location: reqUri,
                                loadsAt: new vscode.Position(idx, 0),
                                type: loadInfo.type
                            });
                        });
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
                    continue;
                }
                m = exportComment.exec(line);
                if(m){
                    parser.reset(false);
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
                const functionParams = [];
                m = startFunctionWithArgs.exec(line);
                if(m){
                    let params = m[3];
                    const pattern = /(\s*,\s*)?([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')/;
                    let m2;
                    while(m2 = pattern.exec(params)){
                        functionParams.push(m2[2]);
                        params = params.substring(m2[0].length);
                    }
                }
                m = definedVariable.exec(line);
                if(m){
                    Log("definedVariable");
                    const isIgnored = (() => {
                        if(isToBeIgnored){
                            return true;
                        }
                        return globalIgnoreType.includes("variables");
                    })();
                    const name = this.formatFunctionName(m[2]);
                    const start = m[1].length;
                    const nameRange = new vscode.Range(
                        new vscode.Position(idx, start),
                        new vscode.Position(idx, start + name.length)
                    );
                    const firstLine = line.trim();
                    parser.setFirstLine(firstLine);
                    const { hasPriority } = parser;
                    const doc = new vscode.MarkdownString(parser.pop());
                    doc.baseUri = uri;
                    scope.next();
                    scope.parent().toDefinitions(definitions)?.push({
                        name,
                        kind: Def.DefinitionKind.variable,
                        enabled: true,
                        ignored: isIgnored,
                        document: doc,
                        range: nameRange,
                        endsAt: undefined,
                        definitions: [],
                        hasPriority,
                    });
                }
                m = startFunction1.exec(line) ??
                    startFunction2.exec(line) ??
                    startFunction3.exec(line) ??
                    startFunction4.exec(line);
                if(m){
                    Log("startFunction", line);
                    const isEnabled = (() => {
                        const isForward = m[1].startsWith("forward");
                        const type = isForward ? "forwards" : "functions";
                        if(config.enableDefinition[type] === false) return false;
                        if(config.enableDefinition[type] === "onlyWithDocumentation" && parser.isEmpty) return false;
                        return true;
                    })();
                    const isIgnored = !isEnabled || (() => {
                        const isForward = m[1].startsWith("forward");
                        const type = isForward ? "forwards" : "functions";
                        if(isToBeIgnored){
                            return true;
                        }else if(globalIgnoreType.includes(type)){
                            return true;
                        }else{
                            return false;
                        }
                    })();
                    isToBeIgnored = false;
                    const functionName = this.formatFunctionName(m[2]);
                    const start = m[1].length;
                    const nameRange = new vscode.Range(
                        new vscode.Position(idx, start),
                        new vscode.Position(idx, start + functionName.length)
                    );
                    const firstLine = line.trim();
                    parser.setFirstLine(firstLine);
                    const startScope = startFunction1.test(line);
                    Log("pushed:", definitions, scope, scope.toDefinitions(definitions));
                    scope.next();
                    const { params, hasPriority } = parser;
                    const doc = new vscode.MarkdownString(parser.pop());
                    doc.baseUri = uri;
                    scope.parent().toDefinitions(definitions)?.push({
                        name: functionName,
                        kind: m[1].startsWith("forward")
                            ? Def.DefinitionKind.forward
                            : Def.DefinitionKind.function,
                        enabled: isEnabled,
                        ignored: isIgnored,
                        document: doc,
                        range: nameRange,
                        endsAt: startScope ? null : undefined,
                        definitions: [],
                        hasPriority,
                    });
                    scope.down();
                    const argsRange = new vscode.Range(
                        nameRange.end,
                        new vscode.Position(nameRange.end.line, line.length)
                    );
                    const paramNames = params.map(p => p.name);
                    [
                        ...params,
                        ...functionParams
                        .filter(param => !paramNames.includes(param))
                        .map(param => {
                            return {
                                name: param,
                                document: ""
                            };
                        })
                    ].forEach(param => {
                        const doc = new vscode.MarkdownString(param.document);
                        doc.baseUri = uri;
                        scope.next();
                        scope.parent().toDefinitions(definitions)?.push({
                            name: param.name,
                            kind: Def.DefinitionKind.variable,
                            enabled: isEnabled,
                            ignored: isIgnored,
                            document: doc,
                            range: argsRange,
                            endsAt: undefined,
                            definitions: [],
                            isArg: true,
                        });
                    });
                    if(!startScope){
                        scope.up();
                    }
                    if(config.warnsWhenRedefiningIntrinsic && !m[1].includes("@define")){
                        if(INTRINSICS.includes(functionName)){
                            diagnostics.push(new vscode.Diagnostic(
                                nameRange,
                                getLocaleString("alreadyDefined", functionName),
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    scope.inComment = false;
                    continue;
                }
                m = assignVariable.exec(line);
                if(m){
                    const isEnabled = (() => {
                        if(config.enableDefinition.variables === false) return false;
                        if(config.enableDefinition.variables === "onlyWithDocumentation" && parser.isEmpty) return false;
                        return true;
                    })();
                    const isIgnored = !isEnabled || (() => {
                        if(isToBeIgnored){
                            return true;
                        }else if(globalIgnoreType.includes("variables")){
                            return true;
                        }else{
                            return false;
                        }
                    })();
                    isToBeIgnored = false;
                    let start = m[1].length;
                    let variables = m[2];
                    const firstLine = line.trim();
                    parser.setFirstLine(firstLine);
                    const { hasPriority } = parser;
                    const doc = new vscode.MarkdownString(parser.pop());
                    doc.baseUri = uri;
                    const pat1 = RegExp(`^\\s*${comp1}`);
                    const pat2 = RegExp(`^\\s*<\\s*(${comp1})\\s*>`);
                    const comma = /^\s*,\s*/;
                    let count = 0;
                    while(variables){
                        count++;
                        if(count > 20000){
                            Output(`Maybe an infinite loop: ${line} (index ${idx})`);
                            break;
                        }
                        m = pat1.exec(variables) ?? pat2.exec(variables);
                        if(m){
                            const name = m[1];
                            if(name !== "_"){
                                const range = new vscode.Range(
                                    new vscode.Position(idx, start),
                                    new vscode.Position(idx, start + name.length)
                                );
                                scope.next();
                                scope.parent().toDefinitions(definitions)?.push({
                                    name: this.formatFunctionName(name),
                                    kind: Def.DefinitionKind.variable,
                                    enabled: isEnabled,
                                    ignored: isIgnored,
                                    document: doc,
                                    range,
                                    endsAt: undefined,
                                    definitions: [],
                                    hasPriority,
                                });
                            }
                            start += m[0].length;
                            variables = variables.substring(m[0].length);
                            m = comma.exec(variables);
                            if(m){
                                start += m[0].length;
                                variables = variables.substring(m[0].length);
                            }
                        }
                    }
                    continue;
                }
                m = endFunction.exec(line);
                if(m){
                    parser.reset();
                    scope.up();
                    const target = scope.toDefinition(definitions);
                    if(target){
                        target.endsAt = new vscode.Position(idx, m[1].length - 1);
                    }
                    continue;
                }
                m = invalidDefinedComment1.exec(line);
                if(m){
                    parser.reset();
                    const functionType = m[2].trim();
                    const isInvalid = (
                        !["function", "procedure", "intrinsic", "variable"].includes(functionType) &&
                        !["function ", "procedure ", "intrinsic ", "variable"].some(t => functionType.startsWith(t))
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
                    parser.reset();
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
                m = invalidDefinedComment3.exec(line);
                if(m){
                    parser.reset();
                    const start = m[1].length;
                    const range = new vscode.Range(
                        new vscode.Position(idx, start),
                        new vscode.Position(idx, start + m[2].length)
                    );
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        getLocaleString("unneededArguments"),
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
                if(line.trim()){
                    Log("NOT startFunction", line);
                    scope.inComment = false;
                    parser.reset();
                }else if(parser.maybeDocument){
                    Log("An empty line after maybeDocumentInlineComment");
                    parser.reset();
                }
            }else{
                m = endComment.exec(line);
                if(m){
                    scope.inComment = false;
                    parser.send(m[1]?.trim());
                    parser.endComment();
                    if(parser.disabled){
                        parser.reset();
                    }
                    continue;
                }
                m = inComment.exec(line);
                if(m){
                    if(/^@internal(\s|$)/.test(m[1].trim())){
                        isToBeIgnored = true;
                    }
                    parser.send(m[1]);
                    continue;
                }
            }
        }
        this.diagnosticCollection.set(uri, [...diagnostics]);
        this.FileExports[uri.fsPath] = fileExports;
        dependencies.reverse();
        Log(`Cache(${uri.path})`, definitions, dependencies);
        Output(`Successfully loaded ${uri.path}`);
        const fileDoc = new vscode.MarkdownString(parser.fileDocument);
        fileDoc.baseUri = uri;
        return { uri, document: fileDoc, definitions, dependencies };
    }
};

class DefinitionLoader extends DefinitionParser{
    protected static async requestCache(uri: vscode.Uri, timeout: number = 10): Promise<Def.Cache | undefined>{
        const maxCount = timeout * 2;
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
    protected static clear(){
        this.FileCache = {};
        this.FileExports = {};
        this.diagnosticCollection.clear();
    }
    protected static refresh(){
        Output("Refreshing caches...");
        this.clear();
        const documents = vscode.workspace.textDocuments.filter(document => document.languageId === "magma");
        documents.forEach(document => {
            this.reserveLoad(document.uri, document.getText());
        });
    }
    protected static reserveLoad(uri: vscode.Uri, fullText?: string): void{
        const id = this.uriToID(uri);
        if(this.FileCache[id] !== "reserved"){
            this.FileCache[id] = "reserved";
            this.load(uri, fullText);
        }
    }
    protected static removeFileCache(uri: vscode.Uri){
        delete this.FileCache[this.uriToID(uri)];
        delete this.FileExports[uri.fsPath];
        this.diagnosticCollection.delete(uri);
        Output(`Removed cache of ${uri.path}`);
    }
    protected static async load(uri: vscode.Uri, fullText?: string): Promise<void>{
        const cache = await this.createCacheData(uri, fullText);
        this.FileCache[this.uriToID(uri)] = cache;
        FileHandler.watch(uri, () => {
            this.removeFileCache(uri);
        });
        cache.dependencies.forEach(dep => {
            const uri = dep.location;
            if(!Def.isCellLocation(uri) && !this.isRegistered(uri)){
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
                data.dependencies.forEach(dep => {
                    const uri = dep.location;
                    if(!Def.isCellLocation(uri) && !this.isRegistered(uri)){
                        this.reserveLoad(uri);
                    }
                });
                const diagnostics = data.dependencies
                .map(dep => {
                    const idx = dep.location;
                    if(typeof idx === "string"){
                        const cell = Def.findCellOfLocation(cells, idx);
                        const id = `"${idx}"`;
                        const range = new vscode.Range(
                            dep.loadsAt,
                            new vscode.Position(dep.loadsAt.line, dep.loadsAt.character + id.length)
                        );
                        if(!cell){
                            return new vscode.Diagnostic(
                                range,
                                getLocaleString("cellNotFound", id),
                                vscode.DiagnosticSeverity.Error
                            );
                        }
                    }
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
                const cellID = Def.IDFromCell(cell);
                return {
                    index: cell.index,
                    id: cellID,
                    fragment: cell.document.uri.fragment,
                    cache: {
                        uri: cell.document.uri,
                        document: data.document,
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
        const searchedCellIndexes = new Set<number>();
        const queryBody: ((def: Def.Definition) => boolean) = (options?.onlyForward)
            ? def => Def.isForward(def) && def.name === functionName
            : def => def.name === functionName;
        if(!selfCache) return undefined;
        if(Def.isNotebookCache(selfCache)){
            const cell = selfCache.cells.find(cell => cell.fragment === document.uri.fragment);
            if(cell){
                searchedCellIndexes.add(cell.index);
                stack.push(cell.cache);
            }
        }else{
            stack.push(selfCache);
        }
        let isSelfCache = true;
        const scope = Def.Scope.positionToScope(position, stack[stack.length-1].definitions);
        while(stack.length){
            const cache: Def.DocumentCache | undefined = stack.pop();
            if(!cache) continue;
            const uri = cache.uri;
            const query = (isSelfCache)
                ? (dep: Def.Definition) => dep.enabled && queryBody(dep) && position.line > dep.range.start.line
                : (dep: Def.Definition) => !dep.ignored && queryBody(dep);
            searchedFiles.add(this.uriToID(uri));
            while(true){
                const defs = scope.toDefinitions(cache.definitions);
                if(defs){
                    const definition = [...defs].reverse().find(query);
                    if(definition){
                        Log(`Definition found!`, definition);
                        return { uri, definition };
                    }
                }
                if(scope.isGlobal()) break;
                scope.up();
            }
            for(const dep of cache.dependencies){
                if(isSelfCache && position.line < dep.loadsAt.line){
                    continue;
                }
                const { location } = dep;
                if(Def.isCellLocation(location)){
                    if(Def.isNotebookCache(selfCache)){
                        const depCell = Def.findCellOfLocation(selfCache.cells, location);
                        if(depCell && !searchedCellIndexes.has(depCell.index)){
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
        const searchedCellIndexes = new Set<number>();
        const ret: Def.Definition[] = [];
        if(!selfCache) return [];
        if(Def.isNotebookCache(selfCache)){
            const cell = selfCache.cells.find(cell => cell.fragment === document.uri.fragment);
            if(cell){
                searchedCellIndexes.add(cell.index);
                stack.push(cell.cache);
            }
        }else{
            stack.push(selfCache);
        }
        let isSelfCache = true;
        const scope = Def.Scope.positionToScope(position, stack[stack.length-1].definitions);
        Log("scope", scope);
        while(stack.length){
            const cache: Def.DocumentCache | undefined = stack.pop();
            if(!cache) continue;
            const uri = cache.uri;
            searchedFiles.add(this.uriToID(uri));
            while(true){
                const defs = scope.toDefinitions(cache.definitions);
                if(defs){
                    const definedDefs = defs.filter(def => {
                        if(isSelfCache){
                            return def.enabled && def.range.end.line < position.line;
                        }else{
                            return !def.ignored;
                        }
                    }).reverse();
                    if(onlyLastDefined){
                        definedDefs.forEach(def => {
                            if(ret.every(d => d.name !== def.name)){
                                ret.push(def);
                            }
                        });
                    }else{
                        ret.push(...definedDefs);
                    }
                }
                if(scope.isGlobal()) break;
                scope.up();
            }
            for(const dep of cache.dependencies){
                if(isSelfCache && position.line < dep.loadsAt.line){
                    continue;
                }
                const { location } = dep;
                if(Def.isCellLocation(location)){
                    if(Def.isNotebookCache(selfCache)){
                        const depCell = Def.findCellOfLocation(selfCache.cells, location);
                        if(depCell && !searchedCellIndexes.has(depCell.index)){
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
        const definitionName = this.getFunctionNameOfPosition(document, position);
        const id = this.uriToID(document.uri);
        const cache = this.FileCache[id];
        if(!Def.isCache(cache)) return undefined;
        const docCache = (Def.isNotebookCache(cache))
            ? (cache.cells.find(cell => cell.fragment === document.uri.fragment)?.cache)
            : cache;
        const flat = (definitions: Def.Definition[]): Def.Definition[] => {
            const ret = [...definitions];
            definitions.forEach(def => {
                ret.push(...flat(def.definitions));
            });
            return ret;
        };
        if(docCache){
            return flat(docCache.definitions).find(def => def.enabled && def.name === definitionName && def.range.contains(position));
        }else{
            return undefined;
        }
    }
    public static async searchAllParams(document: vscode.TextDocument, position: vscode.Position): Promise<Def.Definition[]>{
        const cache = this.FileCache[this.uriToID(document.uri)];
        if(!Def.isCache(cache)) return [];
        const docCache = (Def.isNotebookCache(cache))
            ? (cache.cells.find(cell => cell.fragment === document.uri.fragment)?.cache)
            : cache;
        if(!docCache) return [];
        const scope = Def.Scope.positionToScope(position, docCache.definitions);
        if(scope.isGlobal()) return [];
        const func = scope.toDefinition(docCache.definitions);
        if(!func) return [];
        const forwardFunc = await this.searchDefinition(document, position, {
            onlyForward: true,
            functionName: func.name
        });
        const params = func.definitions.filter(def => def.kind === Def.DefinitionKind.variable && def.range.start.line === func.range.start.line);
        const hasDoc = (def: Def.Definition) => !!def.document.value.trim();
        if(forwardFunc){
            const forwardParams = forwardFunc.definition.definitions
                .filter(def => def.kind === Def.DefinitionKind.variable);
            return [
                ...forwardParams
                    .filter(def => hasDoc(def) && !params.some(d => d.name === def.name && hasDoc(d))),
                ...params
                    .filter(def => hasDoc(def) || !forwardParams.some(d => d.name === def.name && hasDoc(d))),
            ];
        }else{
            return params;
        }
    }
    public static async searchAllForwardParams(document: vscode.TextDocument, position: vscode.Position, onlyNotDefinedAtFunction: boolean = false): Promise<Def.Definition[]>{
        const cache = this.FileCache[this.uriToID(document.uri)];
        if(!Def.isCache(cache)) return [];
        const docCache = (Def.isNotebookCache(cache))
            ? (cache.cells.find(cell => cell.fragment === document.uri.fragment)?.cache)
            : cache;
        if(!docCache) return [];
        const scope = Def.Scope.positionToScope(position, docCache.definitions);
        if(scope.isGlobal()) return [];
        const func = scope.toDefinition(docCache.definitions);
        if(!func) return [];
        const forwardFunc = await this.searchDefinition(document, position, {
            onlyForward: true,
            functionName: func.name
        });
        if(forwardFunc){
            return forwardFunc.definition.definitions
            .filter(def => def.kind === Def.DefinitionKind.variable)
            .filter(def => {
                if(!onlyNotDefinedAtFunction) return true;
                return !func.definitions.some(d => d.name === def.name && d.range.start.line === func.range.start.line);
            }).map((def): Def.Definition => {
                return {
                    ...def,
                    range: func.range
                }
            });
        }else{
            return [];
        }
    }
    protected static async searchForwardParams(document: vscode.TextDocument, position: vscode.Position): Promise<Def.SearchResult | undefined>{
        const definitionName = this.getFunctionNameOfPosition(document, position);
        const res = (await this.searchAllForwardParams(document, position)).filter(def => def.name === definitionName);
        return res.length ? {
            uri: document.uri,
            definition: res[0]
        } : undefined;
    }
    protected static async searchDependency(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined>{
        const line = document.lineAt(position.line).text;
        const ch = position.character;
        const pattern = /^(\s*)(load|\/{2,}\s+@requires?)\s+"[^"]+";?/;
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
            const getDoc = async (uri: vscode.Uri) => {
                const cache = await this.requestCache(uri, 2);
                return cache && !Def.isNotebookCache(cache) ? cache.document : new vscode.MarkdownString("");
            };
            if(isLoad){
                const dep = docCache.dependencies.find(dep => {
                    return dep.type === "load" && dep.loadsAt.line === position.line;
                });
                if(dep && !Def.isCellLocation(dep.location)){
                    const doc = await getDoc(dep.location);
                    return {
                        contents: [
                            new vscode.MarkdownString(`[${getName(dep.location)}](${dep.location})`),
                            doc
                        ]
                    };
                }
            }else{
                const deps = docCache.dependencies.filter(dep => {
                    return dep.type === "require" && dep.loadsAt.line === position.line;
                });
                const files = (await Promise.all(deps.map(async dep => {
                    const loc = dep.location;
                    if(Def.isCellLocation(loc)) return undefined;
                    if(loc.fsPath === document.uri.fsPath) return undefined;
                    const doc = await getDoc(loc);
                    return [
                        new vscode.MarkdownString(`- [${getName(loc)}](${loc})`),
                        doc
                    ];
                }))).filter(doc => doc !== undefined).flat();
                const header = new vscode.MarkdownString(`${getLocaleString("matchedFiles")}`);
                return {
                    contents: [ header, ...files ]
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
