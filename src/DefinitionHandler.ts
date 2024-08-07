
import * as vscode from 'vscode';
import * as Def from './Definition';
import getConfig from './config';
import LogObject from './Log';
import getLocaleStringBody from './locale';
import DefinitionCore from './DefinitionCore';
const { Log } = LogObject.bind("DefinitionHandler");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.DefinitionHandler");

class DefProvider implements vscode.DefinitionProvider{
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if(getConfig().enableDefinition){
            return DefinitionHandler.onDefinitionCall(document, position);
        }else{
            return undefined;
        }
    }
};
class HoverProvider implements vscode.HoverProvider{
    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        if(getConfig().enableHover){
            return DefinitionHandler.onHoverCall(document, position);
        }else{
            return undefined;
        }
    }
};
class SymbolProvider implements vscode.DocumentSymbolProvider{
    provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        return DefinitionHandler.onSymbolCall(document);
    }
}

export default class DefinitionHandler extends DefinitionCore{
    private static dirtyChangeTimeout: NodeJS.Timeout | undefined = undefined;
    private static isEnabled(){
        const config = getConfig();
        return config.enableDefinition || config.enableHover;
    }
    static setProviders(context: vscode.ExtensionContext){
        context.subscriptions.push(vscode.languages.registerDefinitionProvider([
            {
                scheme: "file",
                language: "magma"
            },
            {
                scheme: "untitled",
                language: "magma"
            },
            {
                scheme: "vscode-notebook-cell",
                language: "magma"
            }
        ], new DefProvider()));
        context.subscriptions.push(vscode.languages.registerHoverProvider([
            {
                scheme: "file",
                language: "magma"
            },
            {
                scheme: "untitled",
                language: "magma"
            },
            {
                scheme: "vscode-notebook-cell",
                language: "magma"
            }
        ], new HoverProvider()));
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection("magma");
        context.subscriptions.push(this.diagnosticCollection);
        vscode.languages.registerDocumentSymbolProvider([
            {
                scheme: "file",
                language: "magma"
            },
            {
                scheme: "untitled",
                language: "magma"
            }
        ], new SymbolProvider());
    }
    static onDidChange(e: vscode.TextDocumentChangeEvent){
        this.dirtyChangeTimeout = undefined;
        if(!this.isEnabled()) return;
        const uri = e.document.uri;
        const fullText = e.document.getText();
        if(e.reason === vscode.TextDocumentChangeReason.Redo || e.reason === vscode.TextDocumentChangeReason.Undo){
            setTimeout(() => {
                this.load(uri, fullText);
            }, 500);
        }else{
            this.reserveLoad(uri, fullText);
        }
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
    static onDidChangeNotebook(notebook: vscode.NotebookDocument){
        this.dirtyChangeTimeout = undefined;
        if(!this.isEnabled()) return;
        this.reserveLoadNotebook(notebook);
    }
    static onDidDirtyChangeNotebook(notebook: vscode.NotebookDocument){
        clearTimeout(this.dirtyChangeTimeout);
        this.dirtyChangeTimeout = setTimeout(() => {
            if(this.dirtyChangeTimeout){
                this.onDidChangeNotebook(notebook);
            }
        }, getConfig().onChangeDelay);
    }
    static onDidOpenNotebook(notebook: vscode.NotebookDocument){
        if(!this.isEnabled()) return;
        if(!this.isRegistered(notebook.uri)){
            Log("open registering!");
            this.reserveLoadNotebook(notebook);
        }else{
            Log("Already registered");
        }
    }
    static async onSymbolCall(document: vscode.TextDocument): Promise<vscode.SymbolInformation[]>{
        const uri = document.uri;
        const cache = await this.requestCache(uri);
        if(!cache || Def.isNotebookCache(cache)) return [];
        const definitions = cache.definitions.map<vscode.SymbolInformation>(def => {
            return {
                kind: vscode.SymbolKind.Function,
                name: def.name,
                location: {
                    uri: uri,
                    range: def.endsAt
                        ? new vscode.Range(
                            new vscode.Position(def.range.start.line, 0),
                            def.endsAt
                        )
                        : def.range
                },
                containerName: "Functions"
            };
        });
        return [
            ...definitions
        ];
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
        const depResult = await this.searchDependency(document, position);
        if(depResult) return depResult;
        const selfDef = this.searchDefinitionAtPosition(document, position);
        if(selfDef){
            if(Def.isForward(selfDef)){
                return {
                    contents: [new vscode.MarkdownString(selfDef.document)]
                };
            }
            const forward = await this.searchDefinition(document, position, {
                onlyForward: true,
                functionName: selfDef.name
            });
            if(forward){
                return {
                    contents: [
                        new vscode.MarkdownString(forward.definition.document),
                        ...(
                            forward.uri.scheme === "file"
                            ? [new vscode.MarkdownString(`[${getLocaleString("openFile")}](${forward.uri})`)]
                            : []
                        ),
                        new vscode.MarkdownString("---"),
                        new vscode.MarkdownString(selfDef.document)
                    ]
                };
            }else{
                return {
                    contents: [new vscode.MarkdownString(selfDef.document)]
                };
            }
        }else{
            const result = await this.searchDefinition(document, position);
            if(result){
                const documentBody = new vscode.MarkdownString(result.definition.document);
                const contents = [documentBody];
                return { contents };
            }else{
                return undefined;
            }
        }
    }
};
