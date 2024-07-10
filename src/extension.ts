
import * as vscode from 'vscode';
import DefinitionHandler from './DefinitionHandler';
import CompletionProvider from './Completion';
import { registerCompletionProviders } from './CompletionProviders';
import { setMagmaLoaderCommand } from './Loader';
import LogObject from './Log';
import setNotebookProviders from './Notebook';
import setDisableVimProviders from './DisableVim';
const { Log } = LogObject.bind("extension");

export function activate(context: vscode.ExtensionContext) {
    try{
        vscode.workspace.onDidOpenTextDocument(e => {
            if(e.languageId !== "magma") return;
            if(!["file", "untitled"].includes(e.uri.scheme)) return;
            DefinitionHandler.onDidOpen(e);
        });
        vscode.workspace.onDidChangeTextDocument(e => {
            if(e.document.languageId !== "magma") return;
            CompletionProvider.exec(e);
            if(!["file", "untitled"].includes(e.document.uri.scheme)) return;
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
        setNotebookProviders(context);
        setDisableVimProviders(context);
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
