
import * as vscode from 'vscode';
import * as xmldom from '@xmldom/xmldom';
import * as http from "node:http";
import * as https from "node:https";
import { createServer, Server, Socket } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from 'node:child_process';
import LogObject from './Log';
import getLocaleStringBody from './locale';
import getConfig from './config';
import { load } from './Loader';
import { CellLocation, isCellLocation, IDFromCell, findCellOfLocation } from './Definition';
import DefinitionHandler from './DefinitionHandler';
import DocumentParser from './DocumentParser';
import { extractHtmlData, toHtmlContents } from './NotebookHTML';
const { Log, Output } = LogObject.bind("Notebook");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.Notebook");

const ID = "magma-calculator-notebook";
const HTML_ID = "magma-calculator-notebook-html";
const selectedControllers: {[uri: string]: "local" | "online"} = {}

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
        ["magma", "markdown"].includes(obj.language) &&
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
        try{
            const text = (new TextDecoder()).decode(content);
            if(!text.trim()) return new vscode.NotebookData([]);
            const data = JSON.parse(text);
            if(!isRowNotebookCellArray(data)) throw "invalid data";
            return new vscode.NotebookData(data.map(item => {
                const data = new vscode.NotebookCellData(item.kind, item.value, item.language);
                data.outputs = Serializer.stringToOutput(item.outputs);
                return data;
            }));
        }catch(e){
            Output("Imagma deserialization error:", e);
            try{
                return Serializer.tryToOpenAsImagmaHtml(content);
            }catch(e){
                Output("Imagma deserialization error:", e);
                throw new vscode.LanguageModelError(getLocaleString("deserializationError"));
            }
        }
    }
    async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
        const contents = data.cells.map((cell): RowNotebookCell => {
            return {
                kind: cell.kind,
                language: cell.languageId,
                value: cell.value,
                outputs: Serializer.outputsToString(cell.outputs)
            };
        });
        return (new TextEncoder()).encode(JSON.stringify(contents));
    }
    static tryToOpenAsImagmaHtml(content: Uint8Array): vscode.NotebookData{
        const text = (new TextDecoder()).decode(content);
        if(!text.trim()) return new vscode.NotebookData([]);
        const data = extractHtmlData(text);
        if(!isRowNotebookCellArray(data)) throw "invalid data";
        return new vscode.NotebookData(data.map(item => {
            const data = new vscode.NotebookCellData(item.kind, item.value, item.language);
            data.outputs = Serializer.stringToOutput(item.outputs);
            return data;
        }));
    }
    static copyOutputs(outputs: vscode.NotebookCellOutput[]): vscode.NotebookCellOutput[]{
        return this.stringToOutput(this.outputsToString(outputs));
    }
    static outputsToString(outputs: readonly vscode.NotebookCellOutput[] | undefined): string{
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
    static stringToOutput(text: string | undefined): vscode.NotebookCellOutput[]{
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

class HTMLSerializer extends Serializer{
    async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
        try{
            return Serializer.tryToOpenAsImagmaHtml(content);
        }catch(e){
            Output("Html-imagma deserialization error:", e);
            throw new vscode.LanguageModelError(getLocaleString("deserializationError"));
        }
    }
    async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
        const contents = data.cells.map((cell): RowNotebookCell => {
            return {
                kind: cell.kind,
                language: cell.languageId,
                value: cell.value,
                outputs: Serializer.outputsToString(cell.outputs)
            };
        });
        return (new TextEncoder()).encode(toHtmlContents(JSON.stringify(contents), contents));
    }
};

class Status implements vscode.NotebookCellStatusBarItemProvider{
    provideCellStatusBarItems(cell: vscode.NotebookCell): vscode.NotebookCellStatusBarItem[] {
        const removeButton = cell.outputs.length ? [{
            alignment: vscode.NotebookCellStatusBarAlignment.Right,
            text: getLocaleString("buttonRemovingOutputs"),
            command: {
                command: "extension.magmaNotebook.removeCellOutput",
                title: `delete cell (index ${cell.index})`,
                arguments: [cell]
            }
        }] : [];
        const id = IDFromCell(cell);
        const IDStatus = id ? [{
            alignment: vscode.NotebookCellStatusBarAlignment.Right,
            text: `ID: "${id}"`,
        }] : [];
        return [
            ...removeButton,
            ...IDStatus,
            {
                alignment: vscode.NotebookCellStatusBarAlignment.Right,
                text: `Index: ${cell.index}`
            },
        ];
    }
}

type ExecuttionResult= {
    output: string;
    success: boolean;
};
class Controller{
    private readonly id: string;
    private readonly type: string;
    private readonly label = "Magma Calculator Notebook";
    private readonly controller: vscode.NotebookController;
    private readonly requestOption: http.RequestOptions = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 120 * 1000,
    };
    private sendHttpRequest(callback: (res: http.IncomingMessage) => void): http.ClientRequest{
        const { useHttps } = getConfig();
        const url = `http${useHttps ? "s" : ""}://magma.maths.usyd.edu.au/xml/calculator.xml`;
        return (useHttps ? https : http).request(url, this.requestOption, callback);
    }
    private cells: vscode.NotebookCell[] = [];
    private lastTimeBlocked: Date | undefined = undefined;
    private overwrites: boolean = false;
    private readonly delayMinutesAfterBlocked = 10;
    private loadedCellIndexes = new Set<CellLocation>();
    constructor(type: string){
        this.type = type;
        this.id = `${type}-controller`;
        this.controller = vscode.notebooks.createNotebookController(this.id, this.type, this.label);
        this.controller.supportedLanguages = ["magma"];
        this.controller.executeHandler = this.execute.bind(this);
        this.controller.onDidChangeSelectedNotebooks(e => {
            if(e.selected){
                Log(`online controller selected`);
                const uri = e.notebook.uri.toString(true);
                selectedControllers[uri] = "online";
            }
        });
    }
    private clearLoadedCellIndexes(){
        this.loadedCellIndexes.clear();
    }
    private async readBody(baseUri: vscode.Uri, body: string, currentIdx: number): Promise<string>{
        let m: RegExpExecArray | null;
        const usePattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@uses?[ \t]+([0-9]+|"[^"\n]+")[^\n]*(\n|$)/;
        const appendPattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@append(Results?)?[^\n]*(\n|$)/;
        const overwritePattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@overwrite(Results?)?[^\n]*(\n|$)/;
        const cellIDPattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@cell[ \t]+"[^"\n]*"[^\n]*(\n|$)/;
        while(true){
            m = appendPattern.exec(body);
            if(m){
                this.overwrites = false;
                body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                continue;
            }
            m = overwritePattern.exec(body);
            if(m){
                this.overwrites = true;
                body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                continue;
            }
            m = cellIDPattern.exec(body);
            if(m){
                body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                continue;
            }
            m = usePattern.exec(body);
            if(m){
                Log("use hit", m[1]);
                const location = (() => {
                    if(m[1].startsWith('"')){
                        const id = m[1].slice(1, -1);
                        return id || undefined;
                    }else{
                        const idx = Number(m[1]);
                        return Number.isFinite(idx) ? idx : undefined;
                    }
                })();
                if(isCellLocation(location)){
                    if(this.loadedCellIndexes.has(location)){
                        const id = typeof location === "string" ? `id "${location}"` : `${location}`
                        Output(`Circular reference ${id}\n\t(from: ${currentIdx})`);
                        throw new Error(getLocaleString("circularReference", id, currentIdx));
                    }else{
                        const cell = findCellOfLocation(this.cells, location);
                        if(cell){
                            body = body.substring(0, m.index) 
                                + "\n" + (await this.load(this.cells[cell.index])) + "\n"
                                + body.substring(m.index + m[0].length);
                        }else{
                            const id = typeof location === "string" ? `id "${location}"` : `${location}`
                            throw new Error(getLocaleString("cellNotFound", id));
                        }
                    }
                }else{
                    body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                }
                continue;
            }
            break;
        }
        return load(baseUri, body);
    }
    private async load(cell: vscode.NotebookCell): Promise<string>{
        Log(`load cell ${cell.index}`);
        const idx = cell.index;
        this.loadedCellIndexes.add(idx);
        const body = cell.document.getText().replaceAll("\r", "");
        return this.readBody(cell.document.uri, body, idx);
    }
    async loadForPreview(cell: vscode.NotebookCell): Promise<string>{
        this.clearLoadedCellIndexes();
        this.cells = cell.notebook.getCells();
        return this.load(cell);
    }
    async execute(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController){
        Log("EXECUTE");
        Log(cells);
        if(!cells.length) return;
        this.cells = notebook.getCells();
        const cell = cells.length > 1 ? cells[cells.length-1] : cells[0];
        const exe = controller.createNotebookCellExecution(cell);
        this.overwrites = getConfig().notebookOutputResultMode === "overwrite";
        const [code, success] = await (async () => {
            try{
                this.clearLoadedCellIndexes();
                const code = await this.load(cell);
                Log(code);
                return [code, true];
            }catch(e){
                const mes = (e instanceof Error) ? e.message : String(e);
                vscode.window.showErrorMessage(`${getLocaleStringBody("message.Loader", "failed")}\n${mes}`);
                return ["", false];
            }
        })();
        Log(code);
        exe.start(Date.now());
        if(!success){
            exe.end(false);
            return;
        }
        if(this.overwrites) exe.clearOutput();
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
            try{
                const request = this.sendHttpRequest(response => {
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
            }catch(e){
                Output("RequestError", e);
                resolve({
                    output: getLocaleString("requestError"),
                    success: false
                });
            }
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
    removeOutputs(cell: vscode.NotebookCell, indices: number[]){
        const newOutputs = cell.outputs.filter((_o, idx) => !indices.includes(idx));
        const exe = this.controller.createNotebookCellExecution(cell);
        exe.start();
        exe.replaceOutput(newOutputs);
        exe.end(true);
    }
};

// Type for tracking active notebook runs in local Magma
type ActiveNotebookRun = {
    socket: Socket;
    context: Promise<void> | undefined;
    outputcell: vscode.NotebookCellExecution;
    codeRunEnd: boolean;
    header: string;
    activeoutput: string;
    cancelRequested: boolean;
    previousOutpus: vscode.NotebookCellOutput[];
};

type ActiveNotebooksRuns = {
    [notebookId: string]: ActiveNotebookRun;
};

// Local Magma Controller - connects to local Magma installation
class LocalMagmaController {
    private readonly id: string;
    private readonly type: string;
    private readonly label = "Local Magma Notebook";
    private readonly controller: vscode.NotebookController;
    
    readonly headerTrace: string = 'Type ? for help.  Type <Ctrl>-D to quit.';
    readonly idEnd: string = "2CEAC29D938146F5B9BFD4F9A5A9DA02-END";
    readonly delay = (ms: number | undefined) => new Promise(resolve => setTimeout(resolve, ms));
    
    private server!: Server;
    private magmaActiveRuns: ActiveNotebooksRuns = {};
    private _executionOrder = 0;
    private _app: string = "";
    private _port: number = 9001;
    private serverstarted: boolean = false;
    private errorOnLaunchMagma: boolean = false;
    private cells: vscode.NotebookCell[] = [];
    private overwrites: boolean = false;
    private loadedCellIndexes = new Set<CellLocation>();

    constructor(type: string) {
        this.type = type;
        this.id = `${type}-local-controller`;
        this.controller = vscode.notebooks.createNotebookController(this.id, this.type, this.label);
        this.controller.supportedLanguages = ["magma"];
        this.controller.supportsExecutionOrder = true;
        this.controller.executeHandler = this.execute.bind(this);
        this.controller.interruptHandler = this.interrupt.bind(this);
        this.controller.onDidChangeSelectedNotebooks(e => {
            if(e.selected){
                Log(`local controller selected`);
                const uri = e.notebook.uri.toString(true);
                selectedControllers[uri] = "local";
            }
        });
    }

    private _startMagmaServer(): Promise<void> {
        this.errorOnLaunchMagma = false;
        return new Promise(async (resolve, reject) => {
            let resolved = false;
            const finalize = (started: boolean) => {
                if (resolved) return;
                resolved = true;
                this.serverstarted = started;
                resolve();
            };
            try{
                this._app = await this.resolveMagmaExecutable();
            }catch(e){
                const mes = e instanceof Error ? e.message : String(e);
                const goToSettings = getLocaleStringBody("message.Execute", "goToSettings");
                vscode.window.showErrorMessage(mes, goToSettings).then(val => {
                    if(val === goToSettings){
                        vscode.commands.executeCommand("workbench.action.openSettings", "MagmaLanguageSupport.magmaPath");
                    }
                });
                finalize(false);
                return;
            }
            
            this._port = getConfig().magmaServerPort;
            
            this.server = createServer((c: Socket) => {
                try{
                    const sh = spawn(this._app, []);
                    
                    sh.on('error', (err: string) => {
                        c.write(`ERROR: ${String(err)}\n`);
                        c.end();
                    });
                    
                    c.pipe(sh.stdin);
                    sh.stdout.pipe(c);
                    sh.stderr.pipe(c);
                }catch(e){
                    const mes = e instanceof Error ? e.message : String(e);
                    const erroMes = `Failed to spawn magma (path: \"${this._app}\") - ${mes}`
                    Log(erroMes);
                    Output(erroMes);
                    vscode.window.showErrorMessage(getLocaleString("failedToLaunchMagma"));
                    this.errorOnLaunchMagma = true;
                    c.end();
                    this.server.close();
                    this.serverstarted = false;
                }
            });
            
            this.server.listen(this._port);
            finalize(true);
        });
    }

    private async resolveMagmaExecutable(): Promise<string> {
        const magmaPath = getConfig().magmaPath.trim();
        if(!magmaPath){
            throw new Error(getLocaleStringBody("message.Execute", "notConfiguredMagmaPath"));
        }
        const stat = await fs.stat(magmaPath).catch(() => undefined);
        if(stat?.isFile()){
            return magmaPath;
        }
        if(stat?.isDirectory()){
            const exeName = process.platform === "win32" ? "magma.exe" : "magma";
            const exePath = path.join(magmaPath, exeName);
            const exeStat = await fs.stat(exePath).catch(() => undefined);
            if(exeStat?.isFile()){
                return exePath;
            }
        }
        throw new Error(getLocaleStringBody("message.Execute", "notFoundMagmaPath"));
    }

    private _connectNewClient(notebookId: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const socket = this.magmaActiveRuns[notebookId].socket;
            socket.once('error', err => {
                this.magmaActiveRuns[notebookId].codeRunEnd = true;
                reject(err);
            });
            socket.on('close', () => {
                this.magmaActiveRuns[notebookId].codeRunEnd = true;
            });
            socket.connect(this._port, '127.0.0.1', () => {
                socket.setEncoding('utf-8');
                socket.setNoDelay(true);
                socket.on('data', (data: string) => {
                    let chunk = data;
                    if (chunk.indexOf(this.headerTrace) !== -1) {
                        if (this.magmaActiveRuns[notebookId].header === "") {
                            const idx = chunk.indexOf(this.headerTrace);
                            this.magmaActiveRuns[notebookId].header = chunk.replace(/\r?\n|\r/g, "").replace(this.headerTrace, '');
                            chunk = chunk.substring(idx + this.headerTrace.length);
                        }
                        chunk = chunk.replace(this.headerTrace, "");
                    }
                    if (this.magmaActiveRuns[notebookId].header === "" && chunk.indexOf(this.headerTrace) === -1) {
                        return;
                    }
                    if (chunk.length) {
                        this.magmaActiveRuns[notebookId].activeoutput += chunk;
                        if (this.magmaActiveRuns[notebookId].activeoutput.includes(this.idEnd)) {
                            this.magmaActiveRuns[notebookId].activeoutput = this.magmaActiveRuns[notebookId].activeoutput
                                .replace('print("' + this.idEnd + '");', '')
                                .replace(this.idEnd, "");
                            this.magmaActiveRuns[notebookId].codeRunEnd = true;
                        }
                        this.magmaActiveRuns[notebookId].outputcell.replaceOutput([
                            ...this.magmaActiveRuns[notebookId].previousOutpus,
                            new vscode.NotebookCellOutput([
                                vscode.NotebookCellOutputItem.text(this.magmaActiveRuns[notebookId].activeoutput)
                            ])
                        ]);
                    }
                });
                socket.write("\n");
                resolve();
            });
        });
    }

    private _runMagmaCode(notebookId: string, magmacode: string, token?: vscode.CancellationToken): Promise<void> {
        return new Promise(async (resolve, reject) => {
            if (magmacode.slice(-1) !== ";") {
                magmacode += ";";
            }
            this.magmaActiveRuns[notebookId].codeRunEnd = false;
            this.magmaActiveRuns[notebookId].socket.write(magmacode + '\nprint("' + this.idEnd + '");\r\n');
            const start = Date.now();
            while (!this.magmaActiveRuns[notebookId].codeRunEnd) {
                if(this.errorOnLaunchMagma){
                    this.magmaActiveRuns[notebookId].codeRunEnd = true;
                    break;
                }
                if (token?.isCancellationRequested || this.magmaActiveRuns[notebookId].cancelRequested) {
                    this.magmaActiveRuns[notebookId].codeRunEnd = true;
                    break;
                }
                if (Date.now() - start > 60_000) {
                    this.magmaActiveRuns[notebookId].codeRunEnd = true;
                    break;
                }
                await this.delay(10);
            }
            resolve();
        });
    }

    private clearLoadedCellIndexes() {
        this.loadedCellIndexes.clear();
    }

    private async readBody(baseUri: vscode.Uri, body: string, currentIdx: number): Promise<string> {
        let m: RegExpExecArray | null;
        const usePattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@uses?[ \t]+([0-9]+|"[^"\n]+")[^\n]*(\n|$)/;
        const appendPattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@append(Results?)?[^\n]*(\n|$)/;
        const overwritePattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@overwrite(Results?)?[^\n]*(\n|$)/;
        const cellIDPattern = /(?:^|(?<=\n))[ \t]*\/{2,}[ \t]+@cell[ \t]+"[^"\n]*"[^\n]*(\n|$)/;
        
        while (true) {
            m = appendPattern.exec(body);
            if (m) {
                this.overwrites = false;
                body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                continue;
            }
            m = overwritePattern.exec(body);
            if (m) {
                this.overwrites = true;
                body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                continue;
            }
            m = cellIDPattern.exec(body);
            if (m) {
                body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                continue;
            }
            m = usePattern.exec(body);
            if (m) {
                Log("use hit", m[1]);
                const location = (() => {
                    if (m[1].startsWith('"')) {
                        const id = m[1].slice(1, -1);
                        return id || undefined;
                    } else {
                        const idx = Number(m[1]);
                        return Number.isFinite(idx) ? idx : undefined;
                    }
                })();
                if (isCellLocation(location)) {
                    if (this.loadedCellIndexes.has(location)) {
                        const id = typeof location === "string" ? `id "${location}"` : `${location}`;
                        Output(`Circular reference ${id}\n\t(from: ${currentIdx})`);
                        throw new Error(getLocaleString("circularReference", id, currentIdx));
                    } else {
                        const cell = findCellOfLocation(this.cells, location);
                        if (cell) {
                            body = body.substring(0, m.index)
                                + "\n" + (await this.load(this.cells[cell.index])) + "\n"
                                + body.substring(m.index + m[0].length);
                        } else {
                            const id = typeof location === "string" ? `id "${location}"` : `${location}`;
                            throw new Error(getLocaleString("cellNotFound", id));
                        }
                    }
                } else {
                    body = body.substring(0, m.index) + body.substring(m.index + m[0].length);
                }
                continue;
            }
            break;
        }
        return load(baseUri, body);
    }

    private async load(cell: vscode.NotebookCell): Promise<string> {
        Log(`load cell ${cell.index}`);
        const idx = cell.index;
        this.loadedCellIndexes.add(idx);
        const body = cell.document.getText().replaceAll("\r", "");
        return this.readBody(cell.document.uri, body, idx);
    }

    async loadForPreview(cell: vscode.NotebookCell): Promise<string> {
        this.clearLoadedCellIndexes();
        this.cells = cell.notebook.getCells();
        return this.load(cell);
    }

    async execute(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController) {
        Log("LOCAL MAGMA EXECUTE");
        Log(cells);
        if (!cells.length) return;
        this.cells = notebook.getCells();
        const cell = cells.length > 1 ? cells[cells.length - 1] : cells[0];
        const exe = controller.createNotebookCellExecution(cell);
        this.overwrites = getConfig().notebookOutputResultMode === "overwrite";
        
        const [code, success] = await (async () => {
            try {
                this.clearLoadedCellIndexes();
                const code = await this.load(cell);
                Log(code);
                return [code, true];
            } catch (e) {
                const mes = (e instanceof Error) ? e.message : String(e);
                vscode.window.showErrorMessage(`${getLocaleStringBody("message.Loader", "failed")}\n${mes}`);
                return ["", false];
            }
        })();
        
        exe.start(Date.now());
        if (!success) {
            exe.end(false);
            return;
        }
        if (this.overwrites) exe.clearOutput();
        
        if (!code.trim()) {
            exe.end(true, Date.now());
            return;
        }
        
        await this._doExecution(cell, notebook, exe, code);
    }

    private async _doExecution(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
        execution: vscode.NotebookCellExecution,
        code: string
    ): Promise<void> {
        execution.executionOrder = ++this._executionOrder;
        let notebookid = notebook.uri.toString(true);
        const cancelHandler = execution.token.onCancellationRequested(() => {
            this._interruptNotebook(notebookid);
        });
        
        if (!this.serverstarted) {
            await this._startMagmaServer();
        }
        
        if (this.serverstarted) {
            if (this.magmaActiveRuns[notebookid] === undefined) {
                this.magmaActiveRuns[notebookid] = {
                    socket: new Socket(),
                    context: undefined,
                    outputcell: execution,
                    codeRunEnd: true,
                    header: "",
                    activeoutput: "",
                    cancelRequested: false,
                    previousOutpus: this.overwrites ? [] : [... cell.outputs],
                };
                
                this.magmaActiveRuns[notebookid].context = this._connectNewClient(notebookid)
                    .then(() => this._runMagmaCode(notebookid, "SetAutoColumns(false);SetColumns(1000);"))
                    .catch(err => {
                        this.magmaActiveRuns[notebookid].codeRunEnd = true;
                        this.magmaActiveRuns[notebookid].cancelRequested = true;
                        execution.appendOutput(new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(String(err))
                        ]));
                        execution.end(false, Date.now());
                    });
            }else{
                this.magmaActiveRuns[notebookid].previousOutpus = this.overwrites ? [] : [... cell.outputs];
            }
            
            this.magmaActiveRuns[notebookid].cancelRequested = false;
            this.magmaActiveRuns[notebookid].activeoutput = "";
            this.magmaActiveRuns[notebookid].outputcell = execution;
            
            this.magmaActiveRuns[notebookid].context = this.magmaActiveRuns[notebookid].context!
                .then(() => this._runMagmaCode(notebookid, code, execution.token)
                    .then(() => {
                        if(this.errorOnLaunchMagma){
                            delete this.magmaActiveRuns[notebookid];
                            execution.end(false);
                        } else if (execution.token.isCancellationRequested || this.magmaActiveRuns[notebookid].cancelRequested) {
                            execution.end(false, Date.now());
                        } else {
                            execution.end(true, Date.now());
                        }
                    })
                ).catch(err => {
                    execution.appendOutput(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(String(err))
                    ]));
                    execution.end(false, Date.now());
                }).finally(() => {
                    cancelHandler.dispose();
                });
        } else {
            execution.end(false);
            cancelHandler.dispose();
        }
    }

    private _interruptNotebook(notebookId: string) {
        const run = this.magmaActiveRuns[notebookId];
        if (!run) return;
        run.cancelRequested = true;
        try {
            run.socket.write("\x03");
        } catch {
            // ignore
        }
        try {
            run.outputcell.end(false, Date.now());
        } catch {
            // ignore
        }
    }

    private interrupt(notebook: vscode.NotebookDocument): void {
        const notebookId = notebook.uri.toString(true);
        const run = this.magmaActiveRuns[notebookId];
        if (!run) return;
        run.cancelRequested = true;
        try {
            run.socket.write("\x03");
        } catch {
            // ignore
        }
    }

    removeOutputs(cell: vscode.NotebookCell, indices: number[]) {
        const newOutputs = cell.outputs.filter((_o, idx) => !indices.includes(idx));
        const exe = this.controller.createNotebookCellExecution(cell);
        exe.start();
        exe.replaceOutput(newOutputs);
        exe.end(true);
    }

    public clean() {
        if (this.server) {
            this.server.unref();
        }
    }
}

const controller: Controller = new Controller(ID);
const HTMLcontroller: Controller = new Controller(HTML_ID);
const localController: LocalMagmaController = new LocalMagmaController(ID);
const HTMLLocalController: LocalMagmaController = new LocalMagmaController(HTML_ID);

const controllerFromCell = (cell: vscode.NotebookCell): Controller | LocalMagmaController | undefined => {
    const notebook = cell.notebook;
    const type = notebook.notebookType;
    const backend = selectedControllers[notebook.uri.toString(true)];
    const errorInvalidType = () => {
        vscode.window.showErrorMessage(`invalid type: ${type}`);
        return undefined;
    }
    if(backend === "online"){
        if(type === ID) return controller;
        if(type === HTML_ID) return HTMLcontroller;
        return errorInvalidType();
    }else if(backend === "local"){
        if(type === ID) return localController;
        if(type === HTML_ID) return HTMLLocalController;
        return errorInvalidType();
    }else{
        vscode.window.showErrorMessage(`Failed to fetch the kernel. Please reopen this file.`);
        return undefined;
    }
}

const removeCellOutput = async (cell: vscode.NotebookCell) => {
    const ctl = controllerFromCell(cell);
    if(!ctl) return;
    const length = cell.outputs.length;
    if(!length) return;
    if(length === 1){
        ctl.removeOutputs(cell, [0]);
        return;
    }
    const indices = [...Array(length).keys()];
    const decoder = new TextDecoder();
    const maxLength = 80;
    const format = (desc: string) => {
        desc = desc.replaceAll("\r", "").replaceAll("\n", " ").trim();
        if(desc.length > maxLength){
            return `${desc.substring(0, maxLength)}...`;
        }else{
            return desc;
        }
    };
    const items: vscode.QuickPickItem[] = indices.map(i => {
        const output = cell.outputs[i].items[0];
        const description = format(decoder.decode(output?.data)) ?? "";
        return {
            label: `${i}`,
            description
        };
    });
    const res = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: getLocaleString("selectRemovingOutputs")
    });
    if(res && res.length){
        const removed = res.map(s => Number(s.label));
        ctl.removeOutputs(cell, removed);
    }
};

const cellsToMarkdownContents = (cells: readonly vscode.NotebookCell[]) => {
    return "\n" + cells.map(cell => {
        if(cell.kind === vscode.NotebookCellKind.Markup){
            return cell.document.getText();
        }else{
            const code = DocumentParser.wrapWithBlockMagmaCode(cell.document.getText());
            const outputs = cell.outputs;
            const outputCode = `\n\noutputs:\n\n${outputs.map(out => {
                return out.items.map(item => {
                    const text = (new TextDecoder).decode(item.data);
                    return DocumentParser.wrapWithBlockTextCode(text);
                }).join("\n\n");
            }).join("\n\n")}`;
            return `${code}${outputCode}`;
        }
    }).join(getConfig().notebookSeparatesWithHorizontalLines ? "\n\n---\n\n" : "\n\n");
};
const cellsToHtmlContents = (cells: readonly vscode.NotebookCell[]) => {
    const data = cells.map<RowNotebookCell>(cell => {
        return {
            kind: cell.kind,
            language: cell.document.languageId,
            value: cell.document.getText(),
            outputs: Serializer.outputsToString(cell.outputs)
        };
    });
    return toHtmlContents(JSON.stringify(data), data, false);
};
const exportNotebook = async () => {
    const notebook = vscode.window.activeNotebookEditor?.notebook;
    if(!notebook || ![ID, HTML_ID].includes(notebook.notebookType)){
        vscode.window.showErrorMessage(getLocaleString("calledOnNonMagmaNotebookFile"));
        return;
    }
    const file = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(notebook.uri.fsPath.replace(/\.(imagma|icmagma|imag|icmag)(\.html?)?$/, ".html")),
        filters: {
            "HTML": ["html"],
            "Markdown": ["md"],
        },
    });
    if(!file) return;
    Output(`export to ${file}`);

    const contents = (() => {
        if(file.fsPath.endsWith(".html")){
            return cellsToHtmlContents(notebook.getCells());
        }else if(file.fsPath.endsWith(".md")){
            return cellsToMarkdownContents(notebook.getCells());
        }else{
            return undefined;
        }
    })();
    if(contents === undefined) return;

    const edit = new vscode.WorkspaceEdit();
    edit.createFile(file, {
        overwrite: true,
        contents: (new TextEncoder()).encode(contents)
    });
    vscode.workspace.applyEdit(edit);
}
const previewCode = async (cell: vscode.NotebookCell) => {
    const ctl = controllerFromCell(cell);
    if(!ctl) return;
    let code: string;
    try{
        code = await ctl.loadForPreview(cell);
    }catch(e){
        const mes = (e instanceof Error) ? e.message : String(e);
        vscode.window.showErrorMessage(`${getLocaleStringBody("message.Loader", "failed")}\n${mes}`);
        return;
    }
    const doc = await vscode.workspace.openTextDocument({
        content: code,
        language: "magma"
    });
    vscode.window.showTextDocument(doc);
};
const oneCellAdded = (e: vscode.NotebookDocumentChangeEvent): [boolean, number] => {
    if(e.contentChanges.length !== 1) return [false, -1];
    const change = e.contentChanges[0];
    const oneAdded = change.addedCells.length === 1;
    const noRemoved = change.removedCells.length === 0;
    if(oneAdded && noRemoved) return [true, change.addedCells[0].index];
    else return [false, -1];
};
const adjustUseIndexes = async (notebook: vscode.NotebookDocument, addedCellIndex: number) => {
    const edits = notebook.getCells().map(cell => {
        if(cell.kind === vscode.NotebookCellKind.Markup){
            return undefined;
        }
        const lines = cell.document.getText().replaceAll("\r", "").split("\n");
        let found = false;
        const usePattern = /^(\s*\/{2,}\s+@uses?\s+)([0-9]+)(;?.*?)$/;
        const newContents = lines.map(line => {
            return line.replace(usePattern, (match, prefix, index, suffix) => {
                const idx = Number(index);
                if(Number.isFinite(idx) && idx >= addedCellIndex){
                    found = true;
                    return `${prefix}${Number(idx) + 1}${suffix}`;
                }else{
                    return match;
                }
            });
        }).join("\n");
        if(!found){
            return undefined;
        }
        const newCell = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            newContents,
            cell.document.languageId
        );
        newCell.outputs = Serializer.copyOutputs([...cell.outputs]);
        return new vscode.NotebookEdit(
            new vscode.NotebookRange(cell.index, cell.index + 1),
            [newCell]
        );
    }).filter(edit => edit !== undefined);
    if(edits.length){
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, edits);
        await vscode.workspace.applyEdit(edit);
    }
};

const setNotebookProviders = (context: vscode.ExtensionContext) => {
    Log("Notebook activated");
    context.subscriptions.push(vscode.workspace.registerNotebookSerializer(ID, new Serializer()));
    context.subscriptions.push(vscode.workspace.registerNotebookSerializer(HTML_ID, new HTMLSerializer()));
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaNotebook.createNewNotebook", open));
    vscode.notebooks.registerNotebookCellStatusBarItemProvider(ID, new Status());
    vscode.notebooks.registerNotebookCellStatusBarItemProvider(HTML_ID, new Status());
    vscode.workspace.onDidCloseNotebookDocument(e => {
        const uri = e.uri.toString(true);
        delete selectedControllers[uri];
    });
    vscode.workspace.onDidChangeNotebookDocument(async e => {
        if(![ID, HTML_ID].includes(e.notebook.notebookType)) return;
        const [oneAdded, addedCellIndex] = oneCellAdded(e);
        if(oneAdded){
            await adjustUseIndexes(e.notebook, addedCellIndex);
        }
        DefinitionHandler.onDidChangeNotebook(e.notebook);
    });
    vscode.workspace.onDidOpenNotebookDocument(notebook => {
        if(![ID, HTML_ID].includes(notebook.notebookType)) return;
        DefinitionHandler.onDidOpenNotebook(notebook);
    });
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaNotebook.removeCellOutput", (...args) => {
        try{
            const cell = args[0] as vscode.NotebookCell;
            removeCellOutput(cell).catch();
        }catch{}
    }));
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaNotebook.export", exportNotebook));
    context.subscriptions.push(vscode.commands.registerCommand("extension.magmaNotebook.openLoadingResult", (...args) => {
        try{
            const cell = args[0] as vscode.NotebookCell;
            previewCode(cell).catch();
        }catch{}
    }));
};

export default setNotebookProviders;
