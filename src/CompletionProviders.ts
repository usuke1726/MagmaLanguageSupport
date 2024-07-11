
import * as vscode from 'vscode';
import getConfig from './config';
import INTRINSICS from './Intrinsics';
import DefinitionHandler from './DefinitionHandler';
import FileHandler from './FileHandler';
import DocumentParser from './DocumentParser';
import LogObject from './Log';
const { Log } = LogObject.bind("CompletionProvider");

const exculusiveConditions: Readonly<{
    [key: string]: (scheme: string, beforeText: string) => boolean
}> = {
    LoadFileComp: (scheme, beforeText) => {
        const patterns = [
            /^\s*\/\/\s+@requires?\s+"([^"]*)/,
            /^\s*load\s+"([^"]*)/
        ];
        return (
            scheme === "file" &&
            patterns.some(p => p.test(beforeText))
        );
    },
    NotebookUseStatementComp: (scheme, beforeText) => {
        const pattern = /^\s*\/\/\s+@uses?\s+\d*$/;
        return (
            scheme === "vscode-notebook-cell" &&
            pattern.test(beforeText)
        );
    }
};
const isExclusive = (document: vscode.TextDocument, position: vscode.Position, ignore: string[] = []): boolean => {
    const beforeText = document.lineAt(position.line).text.substring(0, position.character);
    return Object.entries(exculusiveConditions)
    .filter(([key]) => !ignore.includes(key))
    .some(([key, func]) => func(document.uri.scheme, beforeText));
};

class FunctionComp implements vscode.CompletionItemProvider{
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[]{
        Log(getConfig().functionCompletionType);
        if(getConfig().functionCompletionType !== "snippet") return [];
        if(isExclusive(document, position)) return [];
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
        if(isExclusive(document, position)) return [];
        return this.initted ? this.items : [];
    }
};

class DefinitionComp implements vscode.CompletionItemProvider{
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]>{
        if(isExclusive(document, position)) return [];
        const definitions = await DefinitionHandler.searchAllDefinitions(document, position);
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
        if(isExclusive(document, position)) return [];
        const trigger = context.triggerCharacter;
        if(trigger === "@"){
            const pattern = /^\s*\/\/\s+@$/;
            if(!pattern.test(document.lineAt(position.line).text.substring(0, position.character))) return [];
            const item = new vscode.CompletionItem("defined");
            item.kind = vscode.CompletionItemKind.Snippet;
            item.insertText = new vscode.SnippetString('defined ${1|intrinsic,function,procedure|} ${2:functionName}();');
            return [item];
        }else{
            return [];
        }
    }
};

class DocTagComp implements vscode.CompletionItemProvider{
    private readonly paramTags = ["param", "arg", "argument"];
    private readonly reservedTags = ["returns", "example", "remarks"];
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] {
        if(isExclusive(document, position)) return [];
        const trigger = context.triggerCharacter;
        if(trigger === "@"){
            const pattern = /^\s*(\/\*\*|\*)\s*@$/;
            if(!pattern.test(document.lineAt(position.line).text.substring(0, position.character))) return [];
            const normalItems = [...this.reservedTags, ...this.paramTags].map(tag => {
                const item = new vscode.CompletionItem(tag);
                item.kind = vscode.CompletionItemKind.Keyword;
                return item;
            });
            const snippetItems = [...this.paramTags].map(tag => {
                const item = new vscode.CompletionItem(`${tag} {Type} Variable`);
                item.insertText = new vscode.SnippetString(`${tag} {\${1:type}} \${2:variable}`);
                item.sortText = `~with-type-${tag}`;
                return item;
            });
            return [...normalItems, ...snippetItems];
        }else{
            return [];
        }
    }
};

class LoadFileComp implements vscode.CompletionItemProvider{
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionItem[]>{
        if(isExclusive(document, position, ["LoadFileComp"])) return [];
        if(!FileHandler.hasSaveLocation(document.uri)) return [];
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
                return this.fileCompletion(FileHandler.base(document.uri), query);
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
    private async fileCompletion(baseUri: vscode.Uri, query: string): Promise<vscode.CompletionItem[]>{
        const results = await FileHandler.readdir(baseUri, query);
        return results.map(res => {
            if(res.isFolder){
                const item = new vscode.CompletionItem(`${res.name}/`);
                item.command = {
                    command: "editor.action.triggerSuggest",
                    title: "re-trigger"
                };
                item.kind = vscode.CompletionItemKind.Folder;
                item.sortText = `0-${res.name.toLowerCase()}`;
                return item;
            }else{
                const item = new vscode.CompletionItem(res.name);
                item.kind = vscode.CompletionItemKind.File;
                item.sortText = `1-${res.name.toLowerCase()}`;
                return item;
            }
        });
    }
};

class NotebookUseStatementComp implements vscode.CompletionItemProvider{
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
        if(isExclusive(document, position, ["NotebookUseStatementComp"])) return [];
        const editor = vscode.window.activeNotebookEditor;
        if(!editor) return [];
        const trigger = context.triggerCharacter;
        if(trigger === "@"){
            return this.tagCompletion(document, position);
        }else{
            Log(editor.selection.start, editor.selection.end, editor.selection.isEmpty);
            return this.numberCompletion(document, position, editor.notebook);
        }
    }
    private tagCompletion(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[]{
        const pattern = /^\s*\/\/\s+@/;
        if(pattern.test(document.lineAt(position.line).text)){
            const item = new vscode.CompletionItem("use");
            item.kind = vscode.CompletionItemKind.Snippet;
            item.insertText = "use ";
            item.command = {
                command: "editor.action.triggerSuggest",
                title: "re-trigger"
            };
            return [item];
        }else{
            return [];
        }
    }
    private numberCompletion(document: vscode.TextDocument, position: vscode.Position, notebook: vscode.NotebookDocument): vscode.CompletionItem[]{
        const pattern = /^\s*\/\/\s+@uses?\s+\d*$/;
        const beforeText = document.lineAt(position.line).text.substring(0, position.character);
        const cells = notebook.getCells();
        const selfIndex = cells.find(cell => cell.document.uri.fragment === document.uri.fragment)?.index ?? Infinity;
        if(pattern.test(beforeText)){
            return cells
            .filter(cell => cell.kind === vscode.NotebookCellKind.Code && cell.index < selfIndex)
            .map(cell => {
                const text = cell.document.getText();
                const idx = cell.index;
                const item = new vscode.CompletionItem(`${idx}`);
                item.kind = vscode.CompletionItemKind.EnumMember;
                item.documentation = new vscode.MarkdownString(DocumentParser.wrapWithBlockMagmaCode(text));
                if(cell.index === selfIndex - 1) item.preselect = true;
                return item;
            });
        }else{
            return [];
        }
    }
};

const FileScheme = {
    scheme: "file",
    language: "magma"
};
const UntitledScheme = {
    scheme: "untitled",
    language: "magma"
};
const NotebookScheme = {
    scheme: "vscode-notebook-cell",
    language: "magma"
};
const FullScheme = [
    FileScheme, UntitledScheme, NotebookScheme
];

export const registerCompletionProviders = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new FunctionComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new DefinitionComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new IntrinsicComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new LoadFileComp(), "@", "/"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new DefinedCommentComp(), "@"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new DocTagComp(), "@"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(NotebookScheme, new NotebookUseStatementComp(), "@"));
};
