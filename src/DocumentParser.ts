
import * as vscode from 'vscode';
import Log from './Log';

export default class DocumentParser{
    private uri: vscode.Uri;
    private positionLine?: number;
    private firstLine?: string;
    private lines: string[];
    private tag?: string;
    private waitingForFirstToken: boolean = false;
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
        const tagPatterns = [
            /^\s*(@param)(|\s+.*)$/,
            /^\s*(@returns?)(|\s+.*)$/,
            /^\s*(@example)(|\s+.*)$/,
            /^\s*(@remarks?)(|\s+.*)$/,
        ];
        const m = tagPatterns.map(pattern => pattern.exec(line)).find(m => m);
        if(m){
            if(this.tag){
                this.finishTag();
            }
            this.tag = m[1].substring(1);
            if(this.tag === "param"){
                this.waitingForFirstToken = true;
            }
            const remaining = m[2].trimStart();
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
        if(this.waitingForFirstToken){
            line = line.trimStart();
            const m = /^(\w+)(|.+)$/.exec(line);
            if(m){
                this.firstToken = m[1];
                const remaining = m[2].trimStart();
                if(remaining){
                    this.buffer.push(remaining);
                }
                this.waitingForFirstToken = false;
            }else if(line){
                this.firstToken = undefined;
                this.waitingForFirstToken = false;
                this.buffer.push(line);
            }
        }else{
            if(!this.buffer.length && !line.trim()) return;
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
        this.waitingForFirstToken = false;
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
