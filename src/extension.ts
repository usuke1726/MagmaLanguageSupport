
import * as vscode from 'vscode';
import DefinitionHandler from './DefinitionHandler';
import CompletionProvider from './Completion';
import { registerCompletionProviders } from './CompletionProviders';
import setMagmaLoaderCommand from './Loader';
import LogObject from './Log';
const { Log } = LogObject.bind("extension");

export function activate(context: vscode.ExtensionContext) {
    try{
        vscode.workspace.onDidOpenTextDocument(e => {
            if(e.languageId !== "magma") return;
            DefinitionHandler.onDidOpen(e);
        });
        vscode.workspace.onDidChangeTextDocument(e => {
            if(e.document.languageId !== "magma") return;
            CompletionProvider.exec(e);
            if(e.document.isDirty){
                Log("isDirty");
                DefinitionHandler.onDidDirtyChange(e);
            }else{
                DefinitionHandler.onDidChange(e);
            }
        });
        DefinitionHandler.setProviders(context);
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
                DefinitionHandler.onDidOpen(document);
            }
        });
    }catch(e){}
}

export function deactivate() {}
