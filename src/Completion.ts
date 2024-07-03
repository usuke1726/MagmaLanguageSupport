
import * as vscode from 'vscode';
import Log from './Log';
import getConfig from './config';

class ProviderBase{
    private trigger;
    private pattern;
    private insertFunc;
    constructor(
        trigger: string | ((char: string) => boolean) | null,
        pattern: string | RegExp | ((beforeText: string, afterText: string, wholeLine: string) => boolean),
        insert: ((line: number, character: number, wholeText: string[]) => void)
    ){
        this.trigger = trigger;
        this.pattern = pattern;
        this.insertFunc = insert;
    }
    public checkTrigger(lastChar: string): boolean{
        const trigger = this.trigger;
        if(trigger === null){
            return true;
        }else if(typeof trigger === "string"){
            return lastChar === trigger;
        }else{
            return trigger(lastChar);
        }
    }
    public test(beforeText: string, afterText: string, wholeLine: string): boolean{
        switch(typeof this.pattern){
            case "function":
                return this.pattern(beforeText, afterText, wholeLine);
            case "string":
                return beforeText.endsWith(this.pattern);
            default:
                return this.pattern.test(beforeText);
        }
    }
    public insert(line: number, character: number, wholeText: string[]): void{
        this.insertFunc(line, character, wholeText);
    }
};

class IfLikeProvider extends ProviderBase{
    constructor(name: string){
        super(" ", (beforeText, afterText, wholeLine) => {
            return RegExp(`^\\s*${name} $`).test(beforeText) && afterText === "";
        }, (line, character, wholeText) => {
            insertToNextLineWithSameTab(`end ${name};`, line, character, wholeText);
        });
    }
};
class FunctionLikeProvider extends ProviderBase{
    constructor(name: string){
        super(
            (c: string) => [" ", "()"].includes(c),
            (beforeText, afterText, wholeLine) => {
                return (
                    ( beforeText.endsWith(`${name} `) && afterText === "" ) ||
                    ( beforeText.endsWith(`${name}(`) && afterText === ")" ) ||
                    ( beforeText.endsWith(`(${name}(`) && afterText === "))" )
                );
            },
            (line, character, wholeText) => {
                if(/\(\) *\)$/.test(wholeText[line])){
                    const pos = new vscode.Position(line, wholeText[line].length - 1);
                    const tab = ToIndentStr(getIndentNum(line, character, wholeText));
                    insertTo(pos, `\n${tab}end ${name}`);
                }else{
                    insertToNextLineWithSameTab(`end ${name};`, line, character, wholeText);
                }
            }
        );
    }
};


const patterns: ProviderBase[] = [
    new IfLikeProvider("if"),
    new IfLikeProvider("for"),
    new IfLikeProvider("while"),
    new IfLikeProvider("case"),
    new ProviderBase("t", (beforeText, afterText, wholeLine) => {
        return /^[ \t]*repeat$/.test(beforeText) && afterText === "";
    }, (line, character, wholeText) => {
        insertToNextLineWithSameTab("until ", line, character, wholeText);
    }),
    new ProviderBase("y", (beforeText, afterText, wholeLine) => {
        return /^[ \t]*try$/.test(beforeText) && afterText === "";
    }, (line, character, wholeText) => {
        insertToNextLineWithSameTab(["catch e", "end try;"], line, character, wholeText);
    }),
    new FunctionLikeProvider("function"),
    new FunctionLikeProvider("procedure"),
];

const insertTo = (pos: vscode.Position, text: string) => {
    const Editor = vscode.window.activeTextEditor;
    if(!Editor) return;
    Editor.edit(editBuilder => {
        editBuilder.insert(pos, text);
    });
};
const insertToNextLineWithSameTab = (text: string | string[], line: number, character: number, wholeText: string[]) => {
    const thisline = wholeText[line];
    const tab = ToIndentStr(getIndentNum(line, character, wholeText));
    const fulltext = (() => {
        if(typeof text === "string"){
            return `${tab}${text}`;
        }else if(Array.isArray(text)){
            return text.map(t => `${tab}${t}`).join("\n");
        }else{
            return "";
        }
    })();
    if(line === wholeText.length - 1){
        const pos = new vscode.Position(line, thisline.length);
        insertTo(pos, `\n${fulltext}\n`);
    }else{
        const pos = new vscode.Position(line + 1, 0);
        insertTo(pos, `${fulltext}\n`);
    }
};
const insertToSameLine = (text: string, line: number, character: number, wholeText: string[]) => {
    const pos = new vscode.Position(line, character + 1);
    insertTo(pos, text);
};

const getOneIndentStr = (): string => {
    try{
        const Editor = vscode.window.activeTextEditor;
        if(!Editor) throw new Error("");
        const options = Editor.options;
        if(options.insertSpaces){
            if(typeof options.indentSize === "number"){
                return " ".repeat(options.indentSize);
            }
        }else{
            return "\t";
        }
    }catch{}
    return " ".repeat(4);
};

const getIndentNum = (line: number, character: number, wholeText: string[]) => {
    const thisline = wholeText[line];
    const m = /^(([ \t])(\2)*)/.exec(thisline);
    const tabstr = getOneIndentStr();
    const useTab = tabstr[0] === "\t";
    if(m){
        if(useTab) return m[0].length;
        else return Math.floor(m[0].length / tabstr.length);
    }else{
        return 0;
    }
};
const ToIndentStr = (indentNum: number) => {
    return getOneIndentStr().repeat(indentNum);
};

const inString = (beforeText: string) => {
    return /^[^"']*("[^"]*"|'[^']*')*("[^"]*|'[^']*)$/.test(beforeText);
};

export default class CompletionProvider{
    static async exec(e: vscode.TextDocumentChangeEvent){
        if(!getConfig().enableAutoCompletion){
            return;
        }
        const lastChange = e.contentChanges[e.contentChanges.length - 1];
        if(!lastChange) return;
        const lastChar = lastChange.text;

        if(patterns.every(p => !p.checkTrigger(lastChar))){
            return;
        }

        const range = lastChange.range;
        const line = range.start.line;
        const character = range.start.character;

        const wholeText = e.document.getText().split(/\r?\n/);
        const beforeText = wholeText[line].substring(0, character + 1);
        const afterText = wholeText[line].substring(character + 1);
        if(inString(beforeText)){
            Log("in string");
            return;
        }
        const matchedPattern = patterns.find(p => p.test(beforeText, afterText, wholeText[line]));
        if(matchedPattern){
            matchedPattern.insert(line, character, wholeText);
        }
    }
};
