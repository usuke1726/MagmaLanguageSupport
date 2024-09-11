
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
    onlyAtMark: boolean;
};
type ResolveOptionsOptional = {
    [key in keyof ResolveOptions]?: ResolveOptions[key];
};
const defaultOptions: ResolveOptions = {
    useGlob: false,
    maxLength: 100,
    onlyAtMark: true,
};

export default class FileHandler{
    static readonly MagmaExtensions = [".m", ".mag", ".magma", "..magmarc", "..magmarc-dev"];
    static async readdir(baseUri: vscode.Uri, query: string): Promise<SearchResults[]>{
        query = this.resolveQuery(query);
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
    static async resolve(baseUri: vscode.Uri, query: string, options?: ResolveOptionsOptional): Promise<vscode.Uri[]>{
        if(!this.hasSaveLocation(baseUri)){
            return [];
        }
        if(!options) options = {...defaultOptions};
        options.useGlob ??= defaultOptions.useGlob;
        options.maxLength ??= defaultOptions.maxLength;
        options.onlyAtMark ??= defaultOptions.onlyAtMark;
        if(options.onlyAtMark && !this.usingAtMark(query)){
            return [];
        }
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
    static async readFile(uri: vscode.Uri): Promise<string[]>{
        try{
            return (new TextDecoder()).decode(
                await vscode.workspace.fs.readFile(uri)
            ).replaceAll("\r", "").split("\n");
        }catch(e){
            const mes = e instanceof Error ? e.message : String(e);
            const fullMes = `${getLocaleString("failedToReadFile", uri.fsPath)} (${mes})`;
            Output(fullMes);
            vscode.window.showErrorMessage(fullMes);
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
};
