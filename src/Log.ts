
import * as vscode from 'vscode';

class Log{
    private static readonly isDebug: boolean = false;
    private static allowedTags = new Set<string>([
        // "FileHandler",
        // "extension",
        // "DocumentParser",
        "Loader",
    ]);
    private static outputChannel = vscode.window.createOutputChannel("MAGMA Language");
    static log(tag: string, ...messages: any[]){
        if(this.isDebug && this.allowedTags.has(tag)){
            console.log(...messages);
        }
    }
    static output(tag: string, ...messages: any[]){
        this.log(tag, ...messages);
        const line = `[${tag}] ${messages.map(m => String(m)).join(" ")}`;
        this.outputChannel.appendLine(line);
    }
    static bind(tag: string){
        return {
            Log: (...messages: any[]) => this.log(tag, ...messages),
            Output: (...messages: any[]) => this.output(tag, ...messages)
        };
    }
};
export default Log;
