
import * as vscode from 'vscode';
import FileHandler from './FileHandler';
import CompletionProvider from './Completion';
import Log from './Log';
import getConfig from './config';

class DefProvider implements vscode.DefinitionProvider{
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if(getConfig().enableDifinition){
            return FileHandler.onDefinitionCall(document, position);
        }else{
            return undefined;
        }
    }
};
class HoverProvider implements vscode.HoverProvider{
    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        if(getConfig().enableHover){
            return FileHandler.onHoverCall(document, position);
        }else{
            return undefined;
        }
    }
};

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
                Log("Dirty skip");
                return;
            }
            FileHandler.onDidChange(e);
        });
        context.subscriptions.push(vscode.languages.registerDefinitionProvider({
            scheme: "file",
            language: "magma"
        }, new DefProvider()));
        context.subscriptions.push(vscode.languages.registerHoverProvider({
            scheme: "file",
            language: "magma"
        }, new HoverProvider()));
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
