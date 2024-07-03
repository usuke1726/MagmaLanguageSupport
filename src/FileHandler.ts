
import * as vscode from 'vscode';
import path from 'path';
import Log from './Log';
import getConfig from './config';
import DocumentParser from './DocumentParser';

type Definition = {
    name: string;
    document: string;
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

export default class FileHandler{
    static FileCache: Caches = {};
    static dirtyChangeTimeout: NodeJS.Timeout | undefined = undefined;
    private static isEnabled(){
        const config = getConfig();
        return config.enableDefinition || config.enableHover;
    }
    static onDidChange(e: vscode.TextDocumentChangeEvent){
        this.dirtyChangeTimeout = undefined;
        if(!this.isEnabled()) return;
        const uri = e.document.uri;
        this.reserveLoad(uri, e.document.getText());
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
        const result = await this.searchDefinition(document, position);
        if(result){
            const documentBody = new vscode.MarkdownString(result.definition.document);
            const contents = [documentBody];
            return { contents };
        }else{
            return undefined;
        }
    }
    static async searchDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<{uri: vscode.Uri, definition: Definition} | undefined>{
        const id = this.uriToID(document.uri);
        const functionName = this.getFunctionNameOfPosition(document, position);
        const stack: Cache[] = [];
        const selfCache: MaybeCache = this.FileCache[id];
        const searchedFiles = new Set<string>();
        if(isCache(selfCache)){
            stack.push(selfCache);
        }
        while(stack.length){
            const cache: Cache | undefined = stack.pop();
            if(!cache) continue;
            searchedFiles.add(this.uriToID(cache.uri));
            const def =  cache.definitions.find(def => def.name === functionName);
            if(def){
                Log(`Definition found!`, def);
                return {
                    uri: cache.uri,
                    definition: def
                };
            }
            for(const dep of cache.dependencies){
                if(position.line < dep.loadsAt.line){
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
        const lines = (fullText ?? (
            (new TextDecoder()).decode(await vscode.workspace.fs.readFile(uri))
        )).replaceAll("\r", "").split("\n");
        let scope: "global" | "inComment";
        scope = "global";
        const parser = new DocumentParser(uri);
        const loadStatementWithAtMark = /^\s*load\s+"(@.+?)";\s*$/;
        const requireComment = /^\s*\/\/\s+@requires?\s+"(.+?)";?\s*$/;
        const startComment = /^\s*\/\*\*(.*)$/;
        const inComment = /^\s*\*? {0,2}(.*)$/;
        const endComment = /^(.*)\*\/\s*$/;
        const inlineComment = /^\s*\/\*\*(.+?)\*\/\s*$/;
        const startFunction1 = /^((?:function|procedure)\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')/;
        const startFunction2 = /^()([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*:=\s*(?:func|proc)\s*</;
        const startFunction3 = /^(forward\s+)([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')\s*;\s*$/;
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
                m = loadStatementWithAtMark.exec(line);
                if(m){
                    const loadFileUri = await this.resolveLoadFile(m[1], uri);
                    if(loadFileUri){
                        cache.dependencies = cache.dependencies.filter(dep => {
                            return loadFileUri.fsPath !== dep.uri.fsPath;
                        });
                        cache.dependencies.push({
                            uri: loadFileUri,
                            loadsAt: new vscode.Position(idx, 0)
                        });
                        if(!this.isRegistered(loadFileUri)){
                            this.reserveLoad(loadFileUri);
                        }
                    }
                    continue;
                }
                m = requireComment.exec(line);
                if(m){
                    const requiredFiles = await this.resolveRequiredFile(m[1], uri);
                    if(requiredFiles.length){
                        cache.dependencies = cache.dependencies.filter(dep => {
                            return !requiredFiles.some(uri => uri.fsPath === dep.uri.fsPath);
                        });
                        requiredFiles.forEach(reqUri => {
                            cache.dependencies.push({
                                uri: reqUri,
                                loadsAt: new vscode.Position(idx, 0)
                            });
                            if(!this.isRegistered(reqUri)){
                                this.reserveLoad(reqUri);
                            }
                        });
                    }
                    continue;
                }
                m = startFunction1.exec(line) ??
                    startFunction2.exec(line) ??
                    startFunction3.exec(line);
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
                        document: parser.toString(),
                        range: nameRange
                    });
                    scope = "global";
                    continue;
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
        cache.dependencies.reverse();
        cache.definitions.reverse();
        Log(`Cache(${uri.fsPath})`, cache);
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
    private static uriToBaseDir(uri: vscode.Uri): string{
        const relPath = vscode.workspace.asRelativePath(uri).replaceAll("\\", "/");
        const idx = relPath.lastIndexOf("/");
        if(idx >= 0){
            return relPath.substring(0, idx) || ".";
        }else{
            return ".";
        }
    }
    private static async resolveLoadFile(name: string, uri: vscode.Uri): Promise<vscode.Uri | undefined>{
        const baseDir = this.uriToBaseDir(uri);
        const escapedChars = /[\[\]*{}?]/g;
        name = name
            .replaceAll("\\", "/")
            .replace(/@\//, "./")
            .replaceAll(escapedChars, char => {
                return `\\${char}`;
            });
        const filePath = path.join(baseDir, name);
        const files = await vscode.workspace.findFiles(filePath);
        if(files.length === 1){
            Log(`found ${files[0]}`);
            return files[0];
        }else{
            return undefined;
        }
    }
    private static async resolveRequiredFile(name: string, uri: vscode.Uri): Promise<vscode.Uri[]>{
        const baseDir = this.uriToBaseDir(uri);
        // ここに限りGlobパターンを許容する
        name = name
            .replaceAll("\\", "/")
            .replace(/@\//, "./");
        const filePath = path.join(baseDir, name);
        try{
            return await vscode.workspace.findFiles(filePath);
        }catch(e){
            return [];
        }
    }
};
