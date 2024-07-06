
import * as vscode from 'vscode';
import getConfig from './config';
import INTRINSICS from './Intrinsics';
import FileHandler from './FileHandler';
import LogObject from './Log';
const { Log } = LogObject.bind("Config");

class FunctionComp implements vscode.CompletionItemProvider{
    provideCompletionItems(): vscode.CompletionItem[]{
        Log(getConfig().functionCompletionType);
        if(getConfig().functionCompletionType !== "snippet") return [];
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
    async provideCompletionItems(): Promise<vscode.CompletionItem[]> {
        return this.initted ? this.items : [];
    }
};

class DefinitionComp implements vscode.CompletionItemProvider{
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]>{
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
};
