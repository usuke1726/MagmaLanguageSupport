
import * as vscode from 'vscode';
import * as Def from './Definition';
import getConfig, { isDefinitionCompletelyDisabled } from './config';
import LogObject from './Log';
import getLocaleStringBody from './locale';
import DefinitionCore from './DefinitionCore';
const { Log } = LogObject.bind("DefinitionHandler");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.DefinitionHandler");

class DefProvider implements vscode.DefinitionProvider{
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if(isDefinitionCompletelyDisabled()) return undefined;
        return DefinitionHandler.onDefinitionCall(document, position);
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
        return config.enableHover;
    }
    static setProviders(context: vscode.ExtensionContext){
        vscode.workspace.onDidChangeConfiguration(e => {
            if(e.affectsConfiguration("MagmaLanguageSupport.enableDefinition")){
                setTimeout(() => {
                    this.refresh();
                }, 500);
            }
        });
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
    static async onSymbolCall(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]>{
        const uri = document.uri;
        const cache = await this.requestCache(uri);
        if(!cache || Def.isNotebookCache(cache)) return [];
        const toSymbol = (def: Def.Definition): vscode.DocumentSymbol => {
            const kind = def.kind === Def.DefinitionKind.forward 
                ? vscode.SymbolKind.Interface
                : vscode.SymbolKind.Function;
            const range = def.endsAt
                ? new vscode.Range(
                    def.range.start,
                    def.endsAt
                )
                : def.range;
            const selectionRange = def.range;
            if(!range.contains(selectionRange)){
                Log("Bad Symbol Range");
                Log("range:", range);
                Log("selectionRange:", selectionRange);
            }
            const obj = new vscode.DocumentSymbol(def.name, "", kind, range, selectionRange);
            obj.children = def.definitions
                .filter(def => def.kind === Def.DefinitionKind.forward || def.kind === Def.DefinitionKind.function)
                .map(toSymbol);
            return obj;
        };
        const definitions = cache.definitions
        .filter(def => def.kind === Def.DefinitionKind.forward || def.kind === Def.DefinitionKind.function)
        .map<vscode.DocumentSymbol>(toSymbol);
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
            const forwardParam = await this.searchForwardParams(document, position);
            if(forwardParam){
                return {
                    uri: forwardParam.uri,
                    range: forwardParam.definition.range
                };
            }
            return undefined;
        }
    }
    static async onHoverCall(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined>{
        const depResult = await this.searchDependency(document, position);
        if(depResult) return depResult;
        const isArgWithoutDoc = (def: Def.Definition) => !!def.isArg && !def.document.value.trim();
        const selfDef = this.searchDefinitionAtPosition(document, position);
        if(selfDef && !isArgWithoutDoc(selfDef)){
            if(Def.isForward(selfDef)){
                return {
                    contents: [selfDef.document]
                };
            }
            const forward = await this.searchDefinition(document, position, {
                onlyForward: true,
                functionName: selfDef.name
            });
            if(forward){
                return {
                    contents: [
                        forward.definition.document,
                        ...(
                            forward.uri.scheme === "file"
                            ? [new vscode.MarkdownString(`[${getLocaleString("openFile")}](${forward.uri})`)]
                            : []
                        ),
                        new vscode.MarkdownString("---"),
                        selfDef.document
                    ]
                };
            }else{
                return {
                    contents: [selfDef.document]
                };
            }
        }else{
            const makeContents = (res: Def.SearchResult) => { return { contents: [res.definition.document] }; };
            const result = await this.searchDefinition(document, position);
            if(result && !isArgWithoutDoc(result.definition)){
                return makeContents(result);
            }else{
                const forwardParam = await this.searchForwardParams(document, position);
                if(forwardParam){
                    return makeContents(forwardParam);
                }
                if(result){
                    return makeContents({
                        uri: result.uri,
                        definition: {
                            ...result.definition,
                            document: new vscode.MarkdownString(getLocaleString("AlternativeHoverDocumentationOfArguments"))
                        }
                    });
                }
                return undefined;
            }
        }
    }
};
