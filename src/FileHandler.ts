
import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import { glob } from 'glob';
import LogObject from './Log';
import getConfig from './config';
import getLocaleStringBody from './locale';
const { Log, Output } = LogObject.bind("FileHandler");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.FileHandler");

type SearchResults = {
    name: string;
    isFolder: boolean;
};
type ResolveOptions = {
    useGlob: boolean;
    maxLength: number;
};
type ResolveOptionsOptional = {
    [key in keyof ResolveOptions]?: ResolveOptions[key];
};
const defaultOptions: ResolveOptions = {
    useGlob: false,
    maxLength: 100,
};

export default class FileHandler{
    static readonly MagmaExtensions = [".m", ".mag", ".magma", "..magmarc", "..magmarc-dev"];
    static readonly ImagmaExtensions = [".imag", ".icmag", ".imagma", ".icmagma"].map(a => ["", ".htm", ".html"].map(b => a+b)).flat();
    static async readdir(baseUri: vscode.Uri, query: string): Promise<SearchResults[]>{
        query = this.resolveQuery(query);
        if(!this.hasSaveLocation(baseUri) && !this.isAbsolutePath(query)){
            return [];
        }
        try{
            const items = (await fs.readdir(this.join(baseUri, query).fsPath, {
                withFileTypes: true,
                recursive: false
            })).map((dir): SearchResults => {
                return {
                    name: dir.name,
                    isFolder: dir.isDirectory()
                };
            }).filter(res => res.isFolder || this.isMagmaFile(res.name));
            Log(items);
            return items;
        }catch(e){
            Output(`Error at readdir (baseUri: ${baseUri.fsPath}, query: ${query}): ${e}`);
            return [];
        }
    }
    static hasSaveLocation(uri: vscode.Uri): boolean{
        return !uri.fsPath.startsWith("Untitled");
    }
    static isMagmaFile(uri: vscode.Uri | string): boolean{
        const path = (typeof uri === "string") ? uri : uri.fsPath;
        return this.MagmaExtensions.some(ext => path.endsWith(ext));
    }
    static isImagmaFile(uri: vscode.Uri | string): boolean{
        const path = (typeof uri === "string") ? uri : uri.fsPath;
        return this.ImagmaExtensions.some(ext => path.endsWith(ext));
    }
    static async resolve(baseUri: vscode.Uri, query: string, options?: ResolveOptionsOptional): Promise<vscode.Uri[]>{
        if(!options) options = {...defaultOptions};
        options.useGlob ??= defaultOptions.useGlob;
        options.maxLength ??= defaultOptions.maxLength;
        const escapedChars = /[\[\]*{}?]/g;
        query = this.resolveQuery(query);
        if(!options.useGlob){
            query = query.replaceAll(escapedChars, char => {
                return `\\${char}`;
            });
        }
        const fullQuery = this.join(this.base(baseUri), query).fsPath.replaceAll("\\", "/");
        try{
            const res = (await glob(fullQuery, {
                absolute: true,
                nodir: true
            })).map(path => vscode.Uri.file(path))
            .filter(uri => this.isMagmaFile(uri));
            Log("resolve matched", res.map(uri => uri.fsPath));
            return res.slice(0, options.maxLength);
        }catch(e){
            return [];
        }
    }
    static async readFile(uri: vscode.Uri, throwError: boolean = false): Promise<string[]>{
        if(!this.isTrusted(uri)){
            const mes = getLocaleString("untrustedFile", uri.fsPath);
            Output(mes);
            vscode.window.showErrorMessage(mes, getLocaleString("openTrustedFilesSetting")).then(value => {
                if(value !== undefined){
                    vscode.commands.executeCommand("workbench.action.openSettings", "@id:MagmaLanguageSupport.trustedPaths @id:MagmaLanguageSupport.trustAllFiles @id:MagmaLanguageSupport.trustDirectoriesOfOpenFiles");
                }
            });
            if(throwError) throw new Error("");
            return [];
        }
        try{
            return (new TextDecoder()).decode(
                await vscode.workspace.fs.readFile(uri)
            ).replaceAll("\r", "").split("\n");
        }catch(e){
            const mes = e instanceof Error ? e.message : String(e);
            const fullMes = `${getLocaleString("failedToReadFile", uri.fsPath)} (${mes})`;
            Output(fullMes);
            vscode.window.showErrorMessage(fullMes);
            if(throwError) throw new Error("");
            return [];
        }
    }
    static async exists(uri: vscode.Uri): Promise<boolean>{
        try{
            await vscode.workspace.fs.stat(uri);
            return true;
        }catch(e){
            return false;
        }
    }
    static watch(uri: vscode.Uri, onDeleted: () => void){
        if(!this.isTrusted(uri)){
            Output(`Tried watching an untrusted file: ${uri.fsPath}`);
            return;
        }
        (async () => {
            if(!await this.exists(uri)) return;
            try{
                const watcher = fs.watch(uri.fsPath);
                for await(const event of watcher){
                    if(event.eventType === "rename"){
                        Output(`Detected file deletion: ${uri.fsPath}`);
                        onDeleted();
                    }
                }
            }catch{
                Output(`Failed to prepare a file watcher: ${uri.fsPath}`);
                onDeleted();
            }
        })();
    }
    static base(uri: vscode.Uri): vscode.Uri{
        if(!this.hasSaveLocation(uri)){
            return uri;
        }
        return vscode.Uri.joinPath(uri, "..");
    }
    static usingAtMark(query: string): boolean{
        return query.startsWith("@");
    }
    static join(baseDir: vscode.Uri, query: string): vscode.Uri{
        if(query.startsWith("~")){
            const dir = vscode.workspace.getWorkspaceFolder(baseDir);
            if(dir){
                baseDir = dir.uri;
                query = query.replace("~", ".");
            }
        }
        if(this.isAbsolutePath(query)){
            return vscode.Uri.file(query);
        }else if(!this.hasSaveLocation(baseDir)){
            throw new Error(getLocaleString("relativePathFromUnsavedFile", query));
        }
        return vscode.Uri.joinPath(baseDir, query);
    }
    static resolveQuery(query: string): string{
        query = query.replaceAll("\\", "/");
        const paths = getConfig().paths;
        const alias = Object.keys(paths).find(key => query.startsWith(key));
        if(alias){
            query = query.replace(alias, paths[alias]);
        }
        return query;
    }
    static isAbsolutePath(query: string): boolean{
        query = this.resolveQuery(query);
        return (
            query.startsWith("/") ||
            /^[a-zA-Z]:[\/\\]/.test(query)
        );
    }
    static isTrusted(uri: vscode.Uri): boolean{
        return (
            getConfig().trustAllFiles ||
            this.isOnWorkspace(uri) ||
            this.isOnTrustedPath(uri) ||
            this.isOnBasedirOfOpenFile(uri)
        );
    }
    static isOnTrustedPath(uri: vscode.Uri): boolean{
        const path = uri.fsPath.replaceAll("\\", "/").toLowerCase();
        return getConfig().trustedPaths.some(p => {
            p = p.replaceAll("\\", "/").toLowerCase();
            if(this.isMagmaFile(p)){
                return path === p;
            }else{
                if(!p.endsWith("/")){
                    p = `${p}/`;
                }
                return path.startsWith(p);
            }
        });
    }
    static isOnWorkspace(uri: vscode.Uri): boolean{
        const folders = vscode.workspace.workspaceFolders;
        if(folders === undefined) return false;
        const path = uri.fsPath.replaceAll("\\", "/").toLowerCase();
        return folders.some(folder => {
            const basePath = `${folder.uri.fsPath.replaceAll("\\", "/").toLowerCase()}/`;
            return path.startsWith(basePath);
        });
    }
    static isOnBasedirOfOpenFile(uri: vscode.Uri): boolean{
        if(!getConfig().trustDirectoriesOfOpenFiles){
            return false;
        }
        const path = uri.fsPath.replaceAll("\\", "/").toLowerCase();
        const openFiles = [
            ...[
                vscode.window.activeTextEditor?.document.uri,
                vscode.window.activeNotebookEditor?.notebook.uri
            ].filter(uri => uri !== undefined),
            ...vscode.window.visibleTextEditors.map(editor => editor.document.uri),
            ...vscode.window.visibleNotebookEditors.map(editor => editor.notebook.uri),
            ...vscode.workspace.textDocuments.map(doc => doc.uri),
            ...vscode.workspace.notebookDocuments.map(doc => doc.uri),
        ];
        return openFiles
        .filter(uri => this.isMagmaFile(uri) || this.isImagmaFile(uri))
        .some(uri => {
            const basePath = `${this.base(uri).fsPath.replaceAll("\\", "/").toLowerCase()}/`;
            return path.startsWith(basePath);
        });
    }
};
