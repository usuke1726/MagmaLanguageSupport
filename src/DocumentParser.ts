
import * as vscode from 'vscode';
import Log from './Log';

export default class DocumentParser{
    private uri: vscode.Uri;
    private positionLine?: number;
    private firstLine?: string;
    private lines: string[];
    private tag?: string;
    private tokenCount: number = 0;
    private firstToken?: string;
    private buffer: string[] = [];
    constructor(uri: vscode.Uri){
        this.uri = uri;
        this.lines = [];
    }
    private reset(){
        this.positionLine = undefined;
        this.firstLine = undefined;
        this.lines = [];
    }
    setPositionLine(line: number){
        this.positionLine = line;
    }
    setFirstLine(line: string){
        this.firstLine = line;
    }
    send(line: string = ""){
        if(!this.lines.length && !line) return;
        const tagPattern = /^\s*(@[A-Za-z_][A-Za-z0-9_]*)(|\s+.*)$/;
        const tagsExpectingArgs = ["param", "arg", "argument"];
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
            if(remaining){
                this.sendAsInMode(remaining);
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
        const typePattern = /^(\{[A-Za-z_][A-Za-z0-9_]*\})(|.+)$/;
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
        if(this.firstToken){
            out += ` ${this.wrapWithInlineCode(this.firstToken)}`;
        }
        if(this.tag === "example"){
            if(this.buffer.length){
                out += `  \n${this.wrapWithBlockMagmaCode(this.buffer.join("\n"))}`;
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
        this.tokenCount = 0;
        this.firstToken = undefined;
        this.tag = undefined;
        this.buffer = [];
    }
    private wrapWithInlineCode(code: string){
        const num = Math.max(0, ...[...code.matchAll(/`+/g)].map(m => m[0].length)) + 1;
        const brac = "`".repeat(num);
        return `${brac}${code}${brac}`;
    }
    private wrapWithBlockMagmaCode(code: string){
        const num = Math.max(2, ...[...code.matchAll(/`+/g)].map(m => m[0].length)) + 1;
        const brac = "`".repeat(num);
        return `${brac}magma\n${code}\n${brac}`;
    }
    pop(): string{
        if(this.tag){
            this.finishTag();
        }
        const body = this.lines.join("\n");
        if(this.firstLine){
            const code = this.firstLine ? this.wrapWithBlockMagmaCode(this.firstLine) : "";
            this.reset();
            return `${code}\n\n${body}`;
        }else{
            this.reset();
            return body;
        }
    }
};
