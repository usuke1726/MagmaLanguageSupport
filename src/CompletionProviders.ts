
import * as vscode from 'vscode';
import * as Def from './Definition';
import getConfig, { CompletionKeysType, CompletionValue } from './config';
import INTRINSICS from './Intrinsics';
import DefinitionHandler from './DefinitionHandler';
import FileHandler from './FileHandler';
import DocumentParser from './DocumentParser';
import LogObject from './Log';
import getLocaleStringBody from './locale';
const { Log } = LogObject.bind("CompletionProvider");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.Completion");

const exculusiveConditions: Readonly<{
    [key: string]: (scheme: string, beforeText: string) => boolean
}> = {
    LoadFileComp: (scheme, beforeText) => {
        const patterns = [
            /^\s*\/\/\s+(@requires?|@exports?)\s+"([^"]*)/,
            /^\s*load\s+"([^"]*)/
        ];
        return (
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

abstract class CompletionWithSpaceCommitment implements vscode.CompletionItemProvider{
    protected abstract readonly kinds: CompletionKeysType[];
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[]{
        if(isExclusive(document, position)) return [];
        return this.kinds.map(k => this.makeCompletionItems(k)).flat();
    }
    private isEnabledType(type: CompletionValue): boolean{
        return type === "snippet" || type === "snippet-space";
    }
    private makeCompletionItems(kind: CompletionKeysType): vscode.CompletionItem[]{
        const type = getConfig().completionTypes[kind];
        if(!this.isEnabledType(type)) return [];
        const item = new vscode.CompletionItem(kind);
        item.kind = vscode.CompletionItemKind.Snippet;
        if(type === "snippet-space"){
            item.commitCharacters = [" "];
        }
        item.insertText = this.snippetString(kind);
        return [item];
    }
    protected abstract snippetString(name: string): vscode.SnippetString;
};
class FunctionComp extends CompletionWithSpaceCommitment{
    protected kinds: CompletionKeysType[] = ["function", "procedure"];
    protected snippetString(name: string){
        return new vscode.SnippetString(`${name} \${1:name}(\${2:args})\n\t\$3\nend ${name};\n`);
    }
};
class IfLikeComp extends CompletionWithSpaceCommitment{
    protected kinds: CompletionKeysType[] = ["if", "for", "while", "case"];
    protected snippetString(name: string){
        return new vscode.SnippetString(`${name} \$1${this.suffix(name)}\n\t\$2\nend ${name};\n`);
    }
    private suffix(name: string){
        switch(name){
            case "if": return " then";
            case "for":
            case "while": return " do";
            case "case": return ":";
            default: return "";
        }
    }
};
class RepeatComp extends CompletionWithSpaceCommitment{
    protected kinds: CompletionKeysType[] = ["repeat"];
    protected snippetString(name: string){
        return new vscode.SnippetString(`${name}\n\t\$1\nuntil \$2;\n`);
    }
};
class TryComp extends CompletionWithSpaceCommitment{
    protected kinds: CompletionKeysType[] = ["try"];
    protected snippetString(name: string){
        return new vscode.SnippetString(`${name}\n\t\$1\ncatch e\n\t\$2\nend try;\n`);
    }
};

class ForwardComp implements vscode.CompletionItemProvider{
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        if(isExclusive(document, position)) return [];
        if(getConfig().completionTypes["forward"] !== "snippet") return [];
        const item = new vscode.CompletionItem("forward");
        item.insertText = new vscode.SnippetString("forward ${1:name};");
        item.kind = vscode.CompletionItemKind.Snippet;
        return [item];
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
        if(getConfig().completionTypes["built-in-intrinsic"] !== "snippet") return [];
        const aliases = getConfig().intrinsicCompletionAliases;
        const aliasItems = Object.keys(aliases).map(key => {
            const name = aliases[key];
            const item = new vscode.CompletionItem(key);
            item.kind = vscode.CompletionItemKind.Function;
            item.insertText = name;
            item.detail = name;
            item.sortText = `.alias.${key}`;
            return item;
        });
        return this.initted ? [...aliasItems, ...this.items] : [];
    }
};

class DefinitionComp implements vscode.CompletionItemProvider{
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]>{
        if(isExclusive(document, position)) return [];
        if(getConfig().completionTypes["definition"] !== "snippet") return [];
        const definitions = await DefinitionHandler.searchAllDefinitions(document, position);
        const items = definitions.map(def => {
            const item = new vscode.CompletionItem(def.name);
            item.kind = (() => {
                const DefK = Def.DefinitionKind;
                const Kind = vscode.CompletionItemKind;
                switch(def.kind){
                    case DefK.forward: return Kind.Interface;
                    case DefK.function: return Kind.Function;
                    case DefK.variable: return Kind.Variable;
                    default: return Kind.Text;
                }
            })();
            item.documentation = def.document;
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
            item.documentation = new vscode.MarkdownString(getLocaleString("defined"));
            return [item];
        }else{
            return [];
        }
    }
};

class IgnoreCommentComp implements vscode.CompletionItemProvider{
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] {
        if(isExclusive(document, position)) return [];
        const trigger = context.triggerCharacter;
        if(trigger === "@"){
            const pattern = /^\s*\/\/\s+@$/;
            if(!pattern.test(document.lineAt(position.line).text.substring(0, position.character))) return [];
            const item = new vscode.CompletionItem("ignore");
            item.kind = vscode.CompletionItemKind.Snippet;
            item.insertText = new vscode.SnippetString('ignore ${1|this,all,forwards,functions,variables|};');
            item.documentation = new vscode.MarkdownString(getLocaleString("ignore"));
            return [item];
        }else{
            return [];
        }
    }
};

class DocTagComp implements vscode.CompletionItemProvider{
    private readonly paramTags = ["param", "arg", "argument"];
    private readonly reservedTags = ["returns", "example", "remarks", "internal"];
    private tagToLocaleStringKey(tag: string){
        return this.paramTags.includes(tag) ? "param" : tag;
    }
    private tagToDocument(tag: string): vscode.MarkdownString{
        const body = getLocaleString(this.tagToLocaleStringKey(tag));
        const prefix = (() => {
            if(this.paramTags.includes(tag) && tag !== "param"){
                return getLocaleString("paramAlias") + "\n\n";
            }else{
                return "";
            }
        })();
        return new vscode.MarkdownString(`${prefix}${body}`);
    }
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.CompletionItem[] {
        if(isExclusive(document, position)) return [];
        const trigger = context.triggerCharacter;
        if(trigger === "@"){
            const pattern = /^\s*(\/\*\*|\*)\s*@$/;
            if(!pattern.test(document.lineAt(position.line).text.substring(0, position.character))) return [];
            const normalItems = [...this.reservedTags, ...this.paramTags].map(tag => {
                const item = new vscode.CompletionItem(tag);
                item.kind = vscode.CompletionItemKind.Keyword;
                item.documentation = this.tagToDocument(tag);
                return item;
            });
            const snippetItems = [...this.paramTags].map(tag => {
                const item = new vscode.CompletionItem(`${tag} {Type} Variable`);
                item.insertText = new vscode.SnippetString(`${tag} {\${1:type}} \${2:variable}`);
                item.sortText = `~with-type-${tag}`;
                item.documentation = this.tagToDocument(tag);
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
            const pattern3 = /^\s*\/\/\s+@exports?\s+"([^"]*\/)/;
            const prefix = document.lineAt(position.line).text.substring(0, position.character);
            const m = pattern1.exec(prefix) ?? pattern2.exec(prefix) ?? pattern3.exec(prefix);
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
        const requireItem = new vscode.CompletionItem("require");
        const exportItem = new vscode.CompletionItem("export");
        const command = {
            command: "editor.action.triggerSuggest",
            title: "re-trigger"
        };
        requireItem.kind = vscode.CompletionItemKind.Snippet;
        exportItem.kind = vscode.CompletionItemKind.Snippet;
        requireItem.insertText = new vscode.SnippetString('require "@/$1";');
        exportItem.insertText = new vscode.SnippetString('export "@/$1";');
        requireItem.command = command;
        exportItem.command = command;
        requireItem.documentation = new vscode.MarkdownString(getLocaleString("require"));
        exportItem.documentation = new vscode.MarkdownString(getLocaleString("export"));
        if(document.uri.scheme === "vscode-notebook-cell"){
            return [requireItem];
        }else{
            return [requireItem, exportItem];
        }
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
            const use = new vscode.CompletionItem("use");
            use.kind = vscode.CompletionItemKind.Snippet;
            use.insertText = "use ";
            use.command = {
                command: "editor.action.triggerSuggest",
                title: "re-trigger"
            };
            use.documentation = new vscode.MarkdownString(getLocaleString("use"));
            const append = new vscode.CompletionItem("append");
            append.kind = vscode.CompletionItemKind.Snippet;
            append.insertText = "append;";
            append.documentation = new vscode.MarkdownString(getLocaleString("append"));
            const overwrite = new vscode.CompletionItem("overwrite");
            overwrite.kind = vscode.CompletionItemKind.Snippet;
            overwrite.insertText = "overwrite;";
            overwrite.documentation = new vscode.MarkdownString(getLocaleString("overwrite"));
            return [use, append, overwrite];
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
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new IfLikeComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new RepeatComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new TryComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new ForwardComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new DefinitionComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new IntrinsicComp()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new LoadFileComp(), "@", "/"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new DefinedCommentComp(), "@"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new IgnoreCommentComp(), "@"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(FullScheme, new DocTagComp(), "@"));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(NotebookScheme, new NotebookUseStatementComp(), "@"));
};
