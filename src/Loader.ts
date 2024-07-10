
import * as vscode from 'vscode';
import LogObject from './Log';
import FileHandler from './FileHandler';
import getLocaleStringBody from './locale';
const { Log, Output } = LogObject.bind("Loader");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.Loader");

const searchedFiles: Set<string> = new Set();

export const removeComments = (text: string): string => {
    let inComment: boolean = false;
    const res: string[] = [];
    const lines = text.split("\n");
    let m: RegExpExecArray | null;
    const closnigPattern = /^\s*\*\/(.*)$/;
    const inlineBlockPattern = /^\s*\/\*.*?\*\/(.*)/;
    const openingPattern = /^\s*\/\*/;
    const inlinePattern = /^\s*\/\/.+$/;
    const push = (text?: string) => {
        if(text?.trim()) res.push(text.trim());
    };
    lines.forEach(line => {
        if(inComment){
            m = closnigPattern.exec(line);
            if(m){
                inComment = false;
                line = m[1];
            }else{
                return;
            }
        }
        while(true){
            m = inlineBlockPattern.exec(line);
            if(m){
                line = m[1];
            }else{
                break;
            }
        }
        m = openingPattern.exec(line);
        if(m){
            inComment = true;
            return;
        }
        m = inlinePattern.exec(line);
        if(m){
            return;
        }
        push(line);
    });
    return res.join("\n");
};

export const throwError = (base: vscode.Uri, query: string, files: vscode.Uri[]) => {
    const path = FileHandler.join(FileHandler.base(base), query).fsPath;
    if(files.length === 0){
        throw new Error(getLocaleString("notFound", path));
    }else{
        throw new Error(getLocaleString("tooManyFiles", path, files.length));
    }
};

export const loadRecursively = async (baseUri: vscode.Uri, uri: vscode.Uri): Promise<string> => {
    Output(`Start loading ${uri.path}`);
    if(searchedFiles.has(uri.fsPath)){
        Output(`Circular reference ${uri.path}\n\t(base: ${baseUri.path})`);
        throw new Error(getLocaleString("circularReference", uri.path));
    }
    searchedFiles.add(uri.fsPath);
    // 行またぎのload構文にも対応できるようにするため，行ごとでなく全文から検索をかける
    let body = removeComments((await FileHandler.readFile(uri)).join("\n"));
    const patterns = /(?:^|(?<=\n))\s*load\s+"(.+?)"\s*;/;
    let m: RegExpExecArray | null;
    let ret: string = "";
    while(true){
        m = patterns.exec(body);
        if(!m) break;
        ret += body.substring(0, m.index);
        const query = m[1];
        const base = FileHandler.usingAtMark(query) ? uri : baseUri;
        const loadFiles = await FileHandler.resolve(
            base, query, {
                useGlob: false,
                onlyAtMark: false,
            }
        );
        if(loadFiles.length !== 1){
            throwError(base, query, loadFiles);
        }
        const fileUri = loadFiles[0];
        ret += await loadRecursively(baseUri, fileUri);
        body = body.substring(m.index + m[0].length);
    }
    Output(`Successfully loaded ${uri.path}`);
    return ret + body;
};

export const clearSearchedFiles = () => searchedFiles.clear();
export const load = async (uri: vscode.Uri): Promise<string> => {
    clearSearchedFiles();
    return await loadRecursively(uri, uri);
};

const main = async () => {
    Output("=== run ===");
    Log("MagmaLoader");
    const editor = vscode.window.activeTextEditor;
    if(!editor){
        vscode.window.setStatusBarMessage(`MAGMA Loader Error: ${getLocaleString("activeTextEditorUndefined")}`, 2000);
        return;
    }
    if(editor.document.uri.scheme !== "file"){
        vscode.window.setStatusBarMessage(`MAGMA Loader Error: ${getLocaleString("unsavedFile")}`, 2000);
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: getLocaleString("running")
    }, async () => {
        try{
            const text = await load(editor.document.uri);
            Log("=== OUTPUT ===");
            Log(text);
            await vscode.env.clipboard.writeText(text);
        }catch(e){
            const mes = (e instanceof Error) ? e.message : String(e);
            vscode.window.showErrorMessage(`${getLocaleString("failed")}\n${mes}`);
        }
    });
};

export const setMagmaLoaderCommand = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaLoader.run", () => {
        main();
    }));
};
