
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

export const loadRecursively = async (baseUri: vscode.Uri, uri: vscode.Uri, contents?: string): Promise<string> => {
    Output(`Start loading ${uri.path}`);
    if(searchedFiles.has(uri.fsPath)){
        Output(`Circular reference ${uri.path}\n\t(base: ${baseUri.path})`);
        throw new Error(getLocaleString("circularReference", uri.path));
    }
    searchedFiles.add(uri.fsPath);
    // 行またぎのload構文にも対応できるようにするため，行ごとでなく全文から検索をかける
    let body;
    if(contents !== undefined){
        body = removeComments(contents);
    }else{
        body = removeComments((await FileHandler.readFile(uri, true)).join("\n"));
    }
    const patterns = /(?:^|(?<=\n))\s*load\s+"(.+?)"\s*(;|(?=\n)|$)/;
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
            }
        );
        if(loadFiles.length !== 1){
            throwError(base, query, loadFiles);
        }
        const fileUri = loadFiles[0];
        ret += await loadRecursively(baseUri, fileUri) + "\n";
        body = body.substring(m.index + m[0].length);
    }
    Output(`Successfully loaded ${uri.path}`);
    return ret + body;
};

export const clearSearchedFiles = () => searchedFiles.clear();
export const load = async (uri: vscode.Uri, contents?: string): Promise<string> => {
    clearSearchedFiles();
    return await loadRecursively(uri, uri, contents);
};

export const getMagmaDocument = (showStatusBar: boolean = true): vscode.TextDocument | undefined => {
    const editor = vscode.window.activeTextEditor;
    const show = showStatusBar ? (mes: string) => {
        vscode.window.setStatusBarMessage(mes, 2000);
    } : (mes: string) => {
        vscode.window.showErrorMessage(mes);
    };
    if(!editor){
        show(`MAGMA Loader Error: ${getLocaleString("activeTextEditorUndefined")}`);
        return undefined;
    }
    if(editor.document.uri.scheme === "untitled"){
        if(editor.document.languageId === "magma"){
            return editor.document;
        }else{
            show(`MAGMA Loader Error: ${getLocaleString("nonMagmaFile")}`);
            return undefined;
        }
    }
    if(editor.document.uri.scheme !== "file" || editor.document.languageId !== "magma"){
        show(`MAGMA Loader Error: ${getLocaleString("nonMagmaFile")}`);
        return undefined;
    }
    return editor.document;
};

const main = async (callback: (text: string) => void) => {
    Output("=== run ===");
    Log("MagmaLoader");
    const document = getMagmaDocument();
    if(!document) return;

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: getLocaleString("running")
    }, async () => {
        try{
            const text = await load(document.uri, document.getText().replaceAll("\r\n", "\n"));
            Log("=== OUTPUT ===");
            Log(text);
            callback(text);
        }catch(e){
            const mes = (e instanceof Error) ? e.message : String(e);
            vscode.window.showErrorMessage(`${getLocaleString("failed")}\n${mes}`);
        }
    });
};

export const setMagmaLoaderCommand = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaLoader.run", () => {
        main(text => vscode.env.clipboard.writeText(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaLoader.openLoadingResult", () => {
        main(text => vscode.workspace.openTextDocument({
            content: text,
            language: "magma"
        }).then(document => vscode.window.showTextDocument(document)));
    }));
};
