
import * as vscode from 'vscode';

export default class DocumentParser{
    private uri: vscode.Uri;
    private positionLine?: number;
    private firstLine?: string;
    private lines: string[];
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
        this.lines.push(line);
    }
    private firstLineToCodeBlock(){
        if(!this.firstLine) return "";
        const num = Math.max(2, ...[...this.firstLine.matchAll(/`+/g)].map(m => m[0].length)) + 1;
        const brac = "`".repeat(num);
        return `${brac}magma\n${this.firstLine}\n${brac}`;
    }
    pop(): string{
        const body = this.lines.join("\n");
        if(this.firstLine){
            const code = this.firstLineToCodeBlock();
            this.reset();
            return `${code}\n\n${body}`;
        }else{
            this.reset();
            return body;
        }
    }
};
