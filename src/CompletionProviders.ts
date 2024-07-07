
import * as vscode from 'vscode';
import getConfig from './config';
import INTRINSICS from './Intrinsics';
import FileHandler from './FileHandler';
import search from './FileSearch';
import LogObject from './Log';
const { Log } = LogObject.bind("CompletionProvider");

class FunctionComp implements vscode.CompletionItemProvider{
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[]{
        Log(getConfig().functionCompletionType);
        if(getConfig().functionCompletionType !== "snippet") return [];
        if(LoadFileComp.isExclusive(document, position)) return [];
        const item_func = new vscode.CompletionItem("function");
        const item_proc = new vscode.CompletionItem("procedure");
        item_func.commitCharacters = [" "];
        item_proc.commitCharacters = [" "];
        item_func.kind = vscode.CompletionItemKind.Snippet;
        item_proc.kind = vscode.CompletionItemKind.Snippet;
        const make_snip = (name: string) => {
            return new vscode.SnippetString(`${name} \${1:name}(\${2:args})\n\t\$3\nend ${name};\n`);
        };
        item_func.insertText = make_snip("function");
        item_proc.insertText = make_snip("procedure");
        return [item_func, item_proc];
    }
};

class IntrinsicComp implements vscode.CompletionItemProvider{
    private initted = false;
    private items: vscode.CompletionItem[] = [];
    constructor(){
        this.init();
    }
    private async init(){
        Log("INIT START");
        this.items = INTRINSICS.map(name => {
            const item = new vscode.CompletionItem(name);
            item.kind = vscode.CompletionItemKind.Function;
            return item;
        });
        this.initted = true;
        Log("INIT END");
    }
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
        if(LoadFileComp.isExclusive(document, position)) return [];
        return this.initted ? this.items : [];
    }
};

class DefinitionComp implements vscode.CompletionItemProvider{
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]>{
        if(LoadFileComp.isExclusive(document, position)) return [];
        const definitions = await FileHandler.searchAllDefinitions(document, position);
        const items = definitions.map(def => {
            const item = new vscode.CompletionItem(def.name);
            item.kind = def.isForward ? vscode.CompletionItemKind.Interface : vscode.CompletionItemKind.Function;
            item.documentation = new vscode.MarkdownString(def.document);
            return item;
        });
        return items;
    }
};

class DefinedCommentComp implements vscode.CompletionItemProvider{
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] {
        const trigger = context.triggerCharacter;
        if(trigger === "@"){
            const pattern = /^\s*\/\/\s+@/;
            if(!pattern.test(document.lineAt(position.line).text)) return [];
            const item = new vscode.CompletionItem("defined");
            item.kind = vscode.CompletionItemKind.Snippet;
            item.insertText = new vscode.SnippetString('defined ${1|intrinsic,function,procedure|} ${2:functionName}();');
            return [item];
        }else{
            return [];
        }
    }
};

class LoadFileComp implements vscode.CompletionItemProvider{
    static isExclusive(document: vscode.TextDocument, position: vscode.Position): boolean{
        const pattern1 = /^\s*\/\/\s+@requires?\s+"([^"]*)/;
        const pattern2 = /^\s*load\s+"([^"]*)/;
        const prefix = document.lineAt(position.line).text.substring(0, position.character);
        return pattern1.test(prefix) || pattern2.test(prefix);
    }
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionItem[]>{
        const trigger = context.triggerCharacter;
        Log("LoadFile check start");
        if(trigger === "@"){
            Log("trigger @");
            return this.requireCompletion(document, position);
        }else{
            Log("trigger non @");
            const pattern1 = /^\s*\/\/\s+@requires?\s+"([^"]*\/)/;
            const pattern2 = /^\s*load\s+"([^"]*\/)/;
            const prefix = document.lineAt(position.line).text.substring(0, position.character);
            const m = pattern1.exec(prefix) ?? pattern2.exec(prefix);
            if(m){
                Log("fired");
                const query = m[1];
                return this.fileCompletion(vscode.Uri.joinPath(document.uri, "..").fsPath, query);
            }else{
                return [];
            }
        }
    }
    private requireCompletion(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[]{
        const pattern = /^\s*\/\/\s+@/;
        if(!pattern.test(document.lineAt(position.line).text)) return [];
        const item = new vscode.CompletionItem("require");
        item.kind = vscode.CompletionItemKind.Snippet;
        item.insertText = new vscode.SnippetString('require "@/$1";');
        item.command = {
            command: "editor.action.triggerSuggest",
            title: "re-trigger"
        };
        return [item];
    }
    private async fileCompletion(baseDir: string, query: string): Promise<vscode.CompletionItem[]>{
        const results = await search(baseDir, query);
        return results.map(res => {
            if(res.isFolder){
                const item = new vscode.CompletionItem(`${res.name}/`);
                item.command = {
                    command: "editor.action.triggerSuggest",
                    title: "re-trigger"
                };
                item.kind = vscode.CompletionItemKind.Folder;
                return item;
            }else{
                const item = new vscode.CompletionItem(res.name);
                item.kind = vscode.CompletionItemKind.File;
                return item;
            }
        });
    }
};

export const registerCompletionProviders = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider([
        {
            scheme: "file",
            language: "magma"
        },
        {
            scheme: "untitled",
            language: "magma"
        }
    ], new FunctionComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider([
        {
            scheme: "file",
            language: "magma"
        }
    ], new DefinitionComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider([
        {
            scheme: "file",
            language: "magma"
        },
        {
            scheme: "untitled",
            language: "magma"
        }
    ], new IntrinsicComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider([
        {
            scheme: "file",
            language: "magma",
        }
    ], new LoadFileComp(), "@", "/"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider([
        {
            scheme: "file",
            language: "magma",
        }
    ], new DefinedCommentComp(), "@"));
};
