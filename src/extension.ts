
import * as vscode from 'vscode';
import FileHandler from './FileHandler';
import CompletionProvider from './Completion';
import { registerCompletionProviders } from './CompletionProviders';
import setMagmaLoaderCommand from './Loader';
import LogObject from './Log';
const { Log } = LogObject.bind("extension");

export function activate(context: vscode.ExtensionContext) {
    try{
        vscode.workspace.onDidOpenTextDocument(e => {
            if(e.languageId !== "magma") return;
            FileHandler.onDidOpen(e);
        });
        vscode.workspace.onDidChangeTextDocument(e => {
            if(e.document.languageId !== "magma") return;
            CompletionProvider.exec(e);
            if(e.document.isDirty){
                Log("isDirty");
                FileHandler.onDidDirtyChange(e);
            }else{
                FileHandler.onDidChange(e);
            }
        });
        FileHandler.setProviders(context);
        registerCompletionProviders(context);
        setMagmaLoaderCommand(context);
    }catch(e){
        const mes = `MagmaLanguageSupport couldn't start ${String(e)}`;
        Log(mes);
        vscode.window.showErrorMessage(mes);
    }
    try{
        vscode.workspace.textDocuments.forEach((document: vscode.TextDocument) => {
            if(document.languageId === "magma"){
                FileHandler.onDidOpen(document);
            }
        });
    }catch(e){}
}

export function deactivate() {}
