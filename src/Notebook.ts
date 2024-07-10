
import * as vscode from 'vscode';
import * as xmldom from '@xmldom/xmldom';
import * as http from "http";
import LogObject from './Log';
import getLocaleStringBody from './locale';
import getConfig from './config';
import FileHandler from './FileHandler';
import { clearSearchedFiles, loadRecursively, removeComments, throwError } from './Loader';
const { Log, Output } = LogObject.bind("Notebook");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.Notebook");

const ID = "magma-calculator-notebook";

const isNoteBookCellKind = (obj: any): obj is vscode.NotebookCellKind => {
    return obj === 1 || obj === 2;
};

type RowNotebookCell = {
    language: string;
    value: string;
    kind: vscode.NotebookCellKind;
    outputs: string | undefined;
};

const isRowNotebookCell = (obj: any): obj is RowNotebookCell => {
    return (
        typeof obj === "object" &&
        obj.hasOwnProperty("language") && typeof obj.language === "string" &&
        obj.hasOwnProperty("value") && typeof obj.value === "string" &&
        ["string", "undefined"].includes(typeof obj.outputs) &&
        obj.hasOwnProperty("kind") && isNoteBookCellKind(obj.kind)
    );
};
const isRowNotebookCellArray = (obj: any): obj is RowNotebookCell[] => {
    return (
        Array.isArray(obj) &&
        obj.every(el => isRowNotebookCell(el))
    );
};

const open = async () => {
    Log("Notebook open");
    const initialContents: vscode.NotebookCellData[] = [
        {
            kind: vscode.NotebookCellKind.Code,
            languageId: "magma",
            value: ""
        }
    ];
    const notebookData = new vscode.NotebookData(initialContents);
    Log(notebookData);
    const notebook = await vscode.workspace.openNotebookDocument(ID, notebookData);
    vscode.commands.executeCommand("vscode.open", notebook.uri);
};


class Serializer implements vscode.NotebookSerializer{
    async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
        const data = (() => {
            try{
                return JSON.parse((new TextDecoder()).decode(content));
            }catch{
                return undefined;
            }
        })();
        const cellData = isRowNotebookCellArray(data) ? data : [];
        return new vscode.NotebookData(cellData.map(item => {
            const data = new vscode.NotebookCellData(item.kind, item.value, item.language);
            data.outputs = this.stringToOutput(item.outputs);
            return data;
        }));
    }
    async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
        const contents = data.cells.map((cell): RowNotebookCell => {
            return {
                kind: cell.kind,
                language: cell.languageId,
                value: cell.value,
                outputs: this.outputsToString(cell.outputs)
            };
        });
        return (new TextEncoder()).encode(JSON.stringify(contents));
    }
    private outputsToString(outputs: vscode.NotebookCellOutput[] | undefined): string{
        if(!outputs) return "";
        if(!getConfig().notebookSavesOutputs) return "";
        const ret = outputs.map(output => {
            return output.items.map(item => {
                Log(`MINE: ${item.mime}`);
                return (new TextDecoder()).decode(item.data);
            });
        });
        return JSON.stringify(ret);
    }
    private stringToOutput(text: string | undefined): vscode.NotebookCellOutput[]{
        if(!text) return [];
        if(!getConfig().notebookSavesOutputs) return [];
        const isOutputFormat = (obj: any): obj is string[][] => {
            if(!Array.isArray(obj)) return false;
            return obj.every(row => {
                return Array.isArray(row) && row.every(s => typeof s === "string");
            });
        };
        try{
            const arr = JSON.parse(text);
            if(isOutputFormat(arr)){
                return arr.map(row => {
                    return new vscode.NotebookCellOutput(row.map(str => {
                        return vscode.NotebookCellOutputItem.text(str);
                    }));
                });
            }else{
                return [];
            }
        }catch{
            return [];
        }
    }
};

class Status implements vscode.NotebookCellStatusBarItemProvider{
    provideCellStatusBarItems(cell: vscode.NotebookCell): vscode.NotebookCellStatusBarItem {
        return {
            alignment: vscode.NotebookCellStatusBarAlignment.Right,
            text: `Index: ${cell.index}`
        };
    }
}

type ExecuttionResult= {
    output: string;
    success: boolean;
};
class Controller{
    private readonly id = "magma-notebook-controller";
    private readonly type = ID;
    private readonly label = "Magma Calculator Notebook";
    private readonly controller: vscode.NotebookController;
    private readonly targetUrl = "http://magma.maths.usyd.edu.au/xml/calculator.xml";
    private readonly requestOption: http.RequestOptions = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 120 * 1000,
    };
    private cells: vscode.NotebookCell[] = [];
    private lastTimeBlocked: Date | undefined = undefined;
    private readonly delayMinutesAfterBlocked = 10;
    constructor(){
        this.controller = vscode.notebooks.createNotebookController(this.id, this.type, this.label);
        vscode.notebooks.registerNotebookCellStatusBarItemProvider(this.type, new Status());
        this.controller.supportedLanguages = ["magma"];
        this.controller.executeHandler = this.execute.bind(this);
    }
    private getLines(cell: vscode.NotebookCell): string[]{
        return cell.document.getText().replaceAll("\r", "").split("\n");
    }
    private async readLine(baseUri: vscode.Uri, line: string, currentIdx: number): Promise<string[]>{
        let m: RegExpExecArray | null;
        const usePattern = /^\s*\/\/\s+@uses?\s+(\d+);?.*?$/;
        const loadPattern = /^\s*load\s+"(.+)";\s*$/;
        m = usePattern.exec(line);
        if(m){
            Log("use hit", m[1]);
            const idx = Number(m[1]);
            if(!Number.isFinite(idx)){
                Log("invalid");
                return [];
            }else if(idx >= currentIdx){
                Log("too big");
                return [];
            }else{
                const cell = this.cells[idx];
                if(cell.kind === vscode.NotebookCellKind.Code){
                    Log("FOUND!");
                    return this.load(this.cells[idx]);
                }else{
                    Log("is document");
                    return [];
                }
            }
        }
        m = loadPattern.exec(line);
        if(m){
            const query = m[1];
            const loadFiles = await FileHandler.resolve(
                baseUri, query, {
                    useGlob: false,
                    onlyAtMark: false,
                }
            );
            clearSearchedFiles();
            if(loadFiles.length !== 1) throwError(baseUri, query, loadFiles);
            const fileUri = loadFiles[0];
            return (
                await loadRecursively(baseUri, fileUri)
            ).split("\n");
        }
        return [line];
    }
    private async load(cell: vscode.NotebookCell): Promise<string[]>{
        Log(`load cell ${cell.index}`);
        const idx = cell.index;
        const lines = this.getLines(cell);
        return (await Promise.all(lines.map(line => {
            return this.readLine(cell.document.uri, line, idx);
        }))).flat();
    }
    async execute(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController){
        Log("EXECUTE");
        Log(cells);
        if(!cells.length) return;
        this.cells = notebook.getCells();
        const cell = cells.length > 1 ? cells[cells.length-1] : cells[0];
        const exe = controller.createNotebookCellExecution(cell);
        const [code, success] = await (async () => {
            try{
                return [removeComments((await this.load(cell)).join("\n")), true];
            }catch(e){
                const mes = (e instanceof Error) ? e.message : String(e);
                vscode.window.showErrorMessage(`${getLocaleStringBody("message.Loader", "failed")}\n${mes}`);
                return ["", false];
            }
        })();
        exe.start(Date.now());
        if(!success){
            exe.end(false);
            return;
        }
        exe.clearOutput();
        if(this.calledImmediatelyAfterBlocked()){
            exe.appendOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(getLocaleString("calledImmediately", this.delayMinutesAfterBlocked))
            ]));
            exe.end(false, Date.now());
            return;
        }
        if(!code.trim()){
            exe.end(true, Date.now());
            return;
        }
        const result = await this.requests(code, exe.token);
        exe.appendOutput(new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(result.output)
        ]));
        exe.end(result.success, Date.now());
    }
    private async requests(code: string, token: vscode.CancellationToken): Promise<ExecuttionResult>{
        return new Promise<ExecuttionResult>((resolve) => {
            const data = `input=${encodeURIComponent(code)}`;
            const request = http.request(this.targetUrl, this.requestOption, response => {
                this.onReceived(response, resolve);
            });
            token.onCancellationRequested(() => {
                Log("CANCELED");
                resolve({
                    output: "canceled",
                    success: false
                });
            });
            request.on("timeout", () => {
                Log("timeout");
                resolve({
                    output: getLocaleString("timeout"),
                    success: false
                });
            });
            request.end(data);
        });
    }
    private onReceived(response: http.IncomingMessage, resolve: (value: ExecuttionResult) => void){
        Log("received");
        Log(response.statusCode);
        Log(JSON.stringify(response.headers));
        let body = "";
        const decoder = new TextDecoder();
        if(response.statusCode === 504){
            resolve({
                output: getLocaleString("timeout"),
                success: false
            });
            return;
        }
        response.on("data", chunk => {
            body += decoder.decode(chunk);
        });
        response.on("end", () => {
            try{
                resolve(this.parse(body));
            }catch(e){
                Log(`ERRORED\n${e}`);
                resolve({
                    output: getLocaleString("failedParsing"),
                    success: false
                });
            }
        });
    }
    private calledImmediatelyAfterBlocked(): boolean{
        if(!this.lastTimeBlocked) return false;
        const now = new Date();
        const milliseconds = now.getTime() - this.lastTimeBlocked.getTime();
        const delay = this.delayMinutesAfterBlocked * 60 * 1000;
        if(milliseconds > delay){
            this.lastTimeBlocked = undefined;
            return false;
        }else{
            return true;
        }
    }
    private parse(body: string): ExecuttionResult{
        Log(body);
        const parser = new xmldom.DOMParser();
        const doc = parser.parseFromString(body, "text/xml");
        const results = doc.getElementsByTagName("results");
        if(results.length !== 1){
            const offlines = doc.getElementsByTagName("offline");
            if(offlines.length){
                this.lastTimeBlocked = new Date();
                return {
                    output: getLocaleString("blocked", this.delayMinutesAfterBlocked),
                    success: false
                };
            }
            const mes = Array.from(results).map(el => el.textContent).join("\n").trim();
            return {
                output: getLocaleString("otherErrors", mes || body),
                success: false
            };
        }else{
            const lines = Array.from(results[0].getElementsByTagName("line"));
            const res = lines.map(el => el.textContent).filter(t => t !== null).join("\n");
            Log("SUCCESS!");
            return {
                output: res,
                success: true
            };
        }
    }
};


let controller: Controller;
const setNotebookProviders = (context: vscode.ExtensionContext) => {
    Log("Notebook activated");
    context.subscriptions.push(vscode.workspace.registerNotebookSerializer(ID, new Serializer()));
    controller = new Controller();
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaNotebook.createNewNotebook", open));
};

export default setNotebookProviders;
