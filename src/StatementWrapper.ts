
import * as vscode from 'vscode';

const Kinds = [
    "if",
    "for",
    "while",
    "case",
    "repeat",
    "try",
    "function",
    "procedure",
] as const;
type Kinds = typeof Kinds[number];

type WrapperArgs = {
    textEditor: vscode.TextEditor;
    startLine: number;
    endLine: number;
    indent: string;
};
interface Wrapper{
    insertBegin(args: WrapperArgs): Promise<void>;
    insertEnd(args: WrapperArgs): Promise<void>;
};
const insertOption = {
    undoStopBefore: false,
    undoStopAfter: false
};

type SnippetType = "begin" | "end";
class WrapperWithMaybeSnippet implements Wrapper{
    beginText: string;
    endText: string;
    snippetType?: SnippetType;
    constructor(beginText: string, endText: string, snippetType?: SnippetType){
        this.beginText = beginText;
        this.endText = endText;
        this.snippetType = snippetType;
    }
    async insertBegin(args: WrapperArgs){
        const beginText = this.beginText.split("\n").map(t => `${args.indent}${t}`).join("\n");
        const pos = new vscode.Position(args.startLine, 0);
        if(this.snippetType === "begin"){
            const snip = new vscode.SnippetString(`${beginText}\n`);
            await args.textEditor.insertSnippet(snip, pos, insertOption);
        }else{
            await args.textEditor.edit(edit => edit.insert(pos, `${beginText}\n`), insertOption);
        }
    }
    async insertEnd(args: WrapperArgs){
        const endText = this.endText.split("\n").map(t => `${args.indent}${t}`).join("\n");
        const lineEnd = args.textEditor.document.lineAt(args.endLine).text.length;
        const pos = new vscode.Position(args.endLine, lineEnd);
        if(this.snippetType === "end"){
            const snip = new vscode.SnippetString(`\n${endText}`);
            await args.textEditor.insertSnippet(snip, pos, insertOption);
        }else{
            await args.textEditor.edit(edit => edit.insert(pos, `\n${endText}`), insertOption);
        }
    }
};

const quickPickItems: Readonly<{label: Kinds}[]> = Kinds.map(label => {
    return {label};
});
const wrappers: {[label in Kinds]: Wrapper} = {
    if: new WrapperWithMaybeSnippet("if $1 then", "end if;", "begin"),
    for: new WrapperWithMaybeSnippet("for $1 do", "end for;", "begin"),
    while: new WrapperWithMaybeSnippet("while $1 do", "end while;", "begin"),
    case: new WrapperWithMaybeSnippet("case $1:", "end case;", "begin"),
    repeat: new WrapperWithMaybeSnippet("repeat", "until $1;", "end"),
    try: new WrapperWithMaybeSnippet("try", "catch e\nend try;"),
    function: new WrapperWithMaybeSnippet("function ${1:name}($2)", "end function;", "begin"),
    procedure: new WrapperWithMaybeSnippet("procedure ${1:name}($2)", "end procedure;", "begin"),
};

const selectKind = async (...args: any[]): Promise<Kinds | undefined> => {
    const extractKindFromArgs = (...args: any[]): Kinds | undefined => {
        if(args.length === 0) return undefined;
        const arg = args[0];
        if(typeof arg !== "string") return undefined;
        if(([...Kinds] as string[]).includes(arg)){
            return arg as Kinds;
        }else{
            return undefined;
        }
    };
    return extractKindFromArgs(...args) ?? (await vscode.window.showQuickPick(quickPickItems, {
        canPickMany: false
    }))?.label;
};

const wrapWithStatement = async (textEditor: vscode.TextEditor, ...args: any[]) => {
    const kind = await selectKind(...args);
    if(!kind) return;
    const wrapper = wrappers[kind];
    const {document} = textEditor;
    const range = (start: number, end: number) => {
        return [...new Array(end - start + 1).keys()].map(i => i + start);
    };
    for(const selection of textEditor.selections){
        const {start, end} = selection;
        const line = document.lineAt(start.line);
        const indent = line.text.substring(0, line.firstNonWhitespaceCharacterIndex);
        for(const idx of range(start.line, end.line)){
            const pos = new vscode.Position(idx, 0);
            await textEditor.insertSnippet(new vscode.SnippetString("\t"), pos, insertOption);
        };
        const wrapperArgs: WrapperArgs = {
            textEditor, indent,
            startLine: start.line,
            endLine: end.line
        };
        await wrapper.insertEnd(wrapperArgs);
        await wrapper.insertBegin(wrapperArgs);
    };
};

export const registerStatmentWrapperCommand = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(
        vscode.commands.registerCommand("extension.magma.wrapWithStatement", (...args: any[]) => {
            const textEditor = vscode.window.activeTextEditor;
            if(!textEditor) return;
            wrapWithStatement(textEditor, ...args);
        })
    );
};
