
import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'path';
import { glob } from 'glob';
import LogObject from './Log';
const { Log } = LogObject.bind("FileHandler");

type SearchResults = {
    name: string;
    isFolder: boolean;
};
type ResolveOptions = {
    useGlob?: boolean;
    maxLength?: number;
    onlyAtMark?: boolean;
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
            const items = (await fs.readdir(path.join(baseUri.fsPath, query), {
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
            Log(`Errored: ${e}`);
            return [];
        }
    }
    static isMagmaFile(uri: vscode.Uri | string): boolean{
        const path = (typeof uri === "string") ? uri : uri.fsPath;
        return this.MagmaExtensions.some(ext => path.endsWith(ext));
    }
    static async resolve(baseUri: vscode.Uri, query: string, options?: ResolveOptions): Promise<vscode.Uri[]>{
        if(!options) options = {...defaultOptions};
        options.useGlob = options.useGlob ?? defaultOptions.useGlob;
        options.maxLength = options.maxLength ?? defaultOptions.maxLength;
        options.onlyAtMark = options.onlyAtMark ?? defaultOptions.onlyAtMark;
        if(options.onlyAtMark && !this.usingAtMark(query)){
            return [];
        }
        const baseDir = this.base(baseUri).fsPath;
        const escapedChars = /[\[\]*{}?]/g;
        query = this.resolveQuery(query);
        if(!options.useGlob){
            query = query.replaceAll(escapedChars, char => {
                return `\\${char}`;
            });
        }
        const fullQuery = path.join(baseDir, query).replaceAll("\\", "/");
        try{
            const res = (await glob(fullQuery, {
                absolute: true,
                nodir: true
            })).map(path => vscode.Uri.file(path))
            .filter(uri => this.isMagmaFile(uri));
            Log("resolve matched", res.map(uri => uri.fsPath));
            return res;
        }catch(e){
            return [];
        }
    }
    static async readFile(uri: vscode.Uri): Promise<string[]>{
        return (new TextDecoder()).decode(
            await vscode.workspace.fs.readFile(uri)
        ).replaceAll("\r", "").split("\n");
    }
    static async exists(uri: vscode.Uri): Promise<boolean>{
        try{
            await vscode.workspace.fs.stat(uri);
            return true;
        }catch(e){
            return false;
        }
    }
    static base(uri: vscode.Uri): vscode.Uri{
        return vscode.Uri.joinPath(uri, "..");
    }
    static usingAtMark(query: string): boolean{
        return query.startsWith("@");
    }
    private static resolveQuery(query: string): string{
        query = query.replaceAll("\\", "/");
        query = query.replace(/^@/, ".");
        return query;
    }
};
