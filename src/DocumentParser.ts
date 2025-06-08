
import * as vscode from 'vscode';
import LogObject from './Log';
import { allConvert } from './MathParser';
const { Log } = LogObject.bind("DocumentParser");

export default class DocumentParser{
    private uri: vscode.Uri;
    private positionLine?: number;
    private firstLine?: string;
    private lines: string[];
    private tag?: string;
    private tokenCount: number = 0;
    private firstToken?: string;
    private buffer: string[] = [];
    private _isEmpty: boolean = true;
    private _maybeDocument: boolean = false;
    private isInternal: boolean = false;
    private isFirstDoc: boolean = true;
    private isFileDocument: boolean = false;
    private _endComment: boolean = false;
    private _fileDocument: string = "";
    private _disabled: boolean = false;
    private _params: { name: string, document: string }[] = [];
    private _hasPriority: boolean = false;
    constructor(uri: vscode.Uri){
        this.uri = uri;
        this.lines = [];
    }
    get maybeDocument(){
        return this._maybeDocument;
    }
    get isEmpty(){
        return this._isEmpty;
    }
    get fileDocument(){
        return this._fileDocument;
    }
    get disabled(){
        return this._disabled;
    }
    get params(){
        return [...this._params];
    }
    get hasPriority(){
        return this._hasPriority;
    }
    disable(){
        this._disabled = true;
    }
    reset(disableFirstDoc: boolean = true){
        this._disabled = false;
        this._isEmpty = true;
        this.positionLine = undefined;
        this.firstLine = undefined;
        this.lines = [];
        this._maybeDocument = false;
        this.isFileDocument = false;
        this.isInternal = false;
        this._endComment = false;
        this._params.splice(0);
        this._hasPriority = false;
        if(disableFirstDoc){
            this.isFirstDoc = false;
        }
        this.resetTag();
    }
    resetTag(){
        this.tokenCount = 0;
        this.firstToken = undefined;
        this.tag = undefined;
        this.buffer = [];
    }
    setPositionLine(line: number){
        if(this._disabled) return;
        this.positionLine = line;
    }
    setFirstLine(line: string){
        if(this._disabled) return;
        this.firstLine = line;
    }
    grantPriority(){
        this._hasPriority = true;
    }
    private resetIfPreviousOneRemaining(){
        if(this._endComment){
            this.reset();
            this._endComment = false;
        }
    }
    sendMaybeDocument(line: string = ""){
        if(this._disabled) return;
        this.resetIfPreviousOneRemaining();
        if(!this.lines.length && !line) return;
        this._maybeDocument = true;
        this.sendBody(line);
    }
    send(line: string = ""){
        if(this._disabled) return;
        this.resetIfPreviousOneRemaining();
        if(!this.lines.length && !line) return;
        if(this._maybeDocument) this.reset();
        this.sendBody(line);
    }
    private sendBody(line: string){
        this._isEmpty = false;
        const tagPattern = /^\s*(@[A-Za-z_][A-Za-z0-9_]*)(|\s+.*)$/;
        const tagsExpectingArgs = ["param", "arg", "argument"];
        const tagsFileOverview = ["file", "overview", "fileoverview", "fileOverview"];
        const tagsWithoutArgs = ["internal", "external", "priority", "priorityInCompletion"];
        const tagsOnlyOneLine = ["author"];
        const m = tagPattern.exec(line);
        if(m){
            if(this.tag){
                this.finishTag();
            }
            this.tag = m[1].substring(1);
            if(tagsExpectingArgs.includes(this.tag)){
                this.tokenCount = 1;
            }
            const remaining = m[2];
            if(this.isFirstDoc && tagsFileOverview.includes(this.tag)){
                this.isFileDocument = true;
                this.resetTag();
                if(remaining){
                    this.lines.push(remaining);
                }
            }else if(tagsWithoutArgs.includes(this.tag)){
                this.sendAsInTagWithoutArgs();
                this.lines.push(remaining);
            }else if(remaining){
                this.sendAsInMode(remaining);
            }
            if(tagsOnlyOneLine.includes(this.tag)){
                this.finishTag();
            }
            return;
        }
        if(this.tag){
            this.sendAsInMode(line);
            return;
        }
        this.lines.push(line);
    }
    private sendAsInMode(line: string){
        if(this.tokenCount){
            switch(this.tag){
                case "param":
                case "arg":
                case "argument":
                    this.sendAsInParamTag(line);
                    break;
                default:
                    this.sendAsInTagExpectingOneArg(line);
                    break;
            }
        }else{
            if(!this.buffer.length && !line.trim()) return;
            this.buffer.push(line);
        }
    }
    private sendAsInParamTag(line: string){
        line = line.trimStart();
        const typePattern = /^(\{.*?\})(|.+)$/;
        const variablePattern = /^([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')(|.+)$/;
        let m: RegExpExecArray | null;
        if(this.tokenCount === 1){
            m = typePattern.exec(line);
            if(m){
                line = m[2].trimStart();
                this.tokenCount++;
                // 現時点では，型情報は使わない
            }
        }
        m = variablePattern.exec(line);
        if(m){
            this.firstToken = m[1];
            const remaining = m[2].trimStart();
            if(remaining){
                this.buffer.push(remaining);
            }
            this.tokenCount = 0;
        }else if(line){
            this.firstToken = undefined;
            this.tokenCount = 0;
            this.buffer.push(line);
        }
    }
    private sendAsInTagWithoutArgs(){
        switch(this.tag){
            case "priority":
            case "priorityInCompletion":
                this._hasPriority = true;
                this.resetTag();
                break;
            case "internal":
            case "external":
                this.resetTag();
                break;
            default:
                this.finishTag();
                break;
        }
    }
    private sendAsInTagExpectingOneArg(line: string){
        line = line.trimStart();
        const m = /^([A-Za-z_][A-Za-z0-9_]*|'[^\n]*?(?<!\\)')(|.+)$/.exec(line);
        if(m){
            this.firstToken = m[1];
            const remaining = m[2].trimStart();
            if(remaining){
                this.buffer.push(remaining);
            }
            this.tokenCount = 0;
        }else if(line){
            this.firstToken = undefined;
            this.tokenCount = 0;
            this.buffer.push(line);
        }
    }
    private finishTag(){
        Log("finishTag");
        if(this.tag === undefined) return;
        while(true){
            const lastLine = this.buffer.pop();
            if(lastLine === undefined) break;
            if(lastLine.trim()){
                this.buffer.push(lastLine);
                break;
            }
        }
        Log(`   buffer:`, this.buffer);
        let out = `*@${this.tag}*`;
        if(["param", "arg", "argument"].includes(this.tag) && this.firstToken){
            this._params.push({ name: this.firstToken, document: this.buffer.join("\n") });
        }
        if(this.firstToken){
            out += ` ${DocumentParser.wrapWithInlineCode(this.firstToken)}`;
        }
        if(this.tag === "example"){
            if(this.buffer.length){
                out += `  \n${DocumentParser.wrapWithBlockMagmaCode(this.buffer.join("\n"))}`;
            }
        }else{
            if(this.buffer.length > 1){
                out += "  \n";
            }else if(this.buffer.length === 1){
                out += " \u2014 ";
            }else{
                if(this.tag === "return" || this.tag === "returns"){
                    return;
                }
            }
            out += this.buffer.join("\n");
        }
        this.lines.push("");
        this.lines.push(out);
        this.resetTag();
    }
    static wrapWithInlineCode(code: string){
        const num = Math.max(0, ...[...code.matchAll(/`+/g)].map(m => m[0].length)) + 1;
        const brac = "`".repeat(num);
        return `${brac}${code}${brac}`;
    }
    static wrapWithBlockMagmaCode(code: string){
        const num = Math.max(2, ...[...code.matchAll(/`+/g)].map(m => m[0].length)) + 1;
        const brac = "`".repeat(num);
        return `${brac}magma\n${code}\n${brac}`;
    }
    static wrapWithBlockTextCode(code: string, lang: string = ""){
        const num = Math.max(2, ...[...code.matchAll(/`+/g)].map(m => m[0].length)) + 1;
        const brac = "`".repeat(num);
        return `${brac}${lang}\n${code}\n${brac}`;
    }
    static markdownEscape(text: string){
        return text.replace(/[#+\-*_\\`.!<>{}\[\]()]/g, s => `\\${s}`);
    }
    endComment(){
        this._endComment = true;
        if(this.tag){
            this.finishTag();
        }
        if(this.isFileDocument){
            this._fileDocument = this.pop();
        }
    }
    setInternal(){
        if(this.isInternal) return;
        this.isInternal = true;
        this.lines = ["*@internal*", "", ...this.lines];
    }
    pop(): string{
        if(this.tag){
            this.finishTag();
        }
        const body = allConvert(this.lines.join("\n"));
        if(this.firstLine){
            const code = this.firstLine ? DocumentParser.wrapWithBlockMagmaCode(this.firstLine) : "";
            this.reset();
            return `${code}\n\n${body}`;
        }else{
            this.reset();
            return body;
        }
    }
};
