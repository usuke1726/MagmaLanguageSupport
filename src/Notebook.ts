
import * as vscode from 'vscode';
import * as xmldom from '@xmldom/xmldom';
import * as http from "http";
import * as https from "https";
import LogObject from './Log';
import getLocaleStringBody from './locale';
import getConfig from './config';
import FileHandler from './FileHandler';
import { clearSearchedFiles, loadRecursively, removeComments, throwError } from './Loader';
import { CellLocation, isCellLocation, IDFromCell, findCellOfLocation } from './Definition';
import DefinitionHandler from './DefinitionHandler';
import DocumentParser from './DocumentParser';
import { extractHtmlData, toHtmlContents } from './NotebookHTML';
const { Log, Output } = LogObject.bind("Notebook");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.Notebook");

const ID = "magma-calculator-notebook";
const HTML_ID = "magma-calculator-notebook-html";

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
        vscode.notebooks.registerNotebookCellStatusBarItemProvider(this.type, new Status());
        this.controller.supportedLanguages = ["magma"];
        this.controller.executeHandler = this.execute.bind(this);
    }
    private clearLoadedCellIndexes(){
        this.loadedCellIndexes.clear();
    }
    private getLines(cell: vscode.NotebookCell): string[]{
        return cell.document.getText().replaceAll("\r", "").split("\n");
    }
    private async readLine(baseUri: vscode.Uri, line: string, currentIdx: number): Promise<string[]>{
        let m: RegExpExecArray | null;
        const usePattern = /^\s*\/{2,}\s+@uses?\s+([0-9]+|"[^"\n]+");?.*?$/;
        const loadPattern = /^\s*load\s+"(.+)";\s*$/;
        const appendPattern = /^\s*\/{2,}\s+@append(Results?)?\s*;?.*?$/;
        const overwritePattern = /^\s*\/{2,}\s+@overwrite(Results?)?\s*;?.*?$/;
        const cellIDPattern = /^\s*\/{2,}\s+@cell\s+"[^"\n]*";?.*?$/;
        if(appendPattern.test(line)){
            this.overwrites = false;
            return [];
        }
        if(overwritePattern.test(line)){
            this.overwrites = true;
            return [];
        }
        if(cellIDPattern.test(line)){
            return [];
        }
        m = usePattern.exec(line);
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
            if(!isCellLocation(location)) return [];
            if(this.loadedCellIndexes.has(location)){
                const id = typeof location === "string" ? `id "${location}"` : `${location}`
                Output(`Circular reference ${id}\n\t(from: ${currentIdx})`);
                throw new Error(getLocaleString("circularReference", id, currentIdx));
            }else{
                const cell = findCellOfLocation(this.cells, location);
                if(cell){
                    return this.load(this.cells[cell.index]);
                }else{
                    const id = typeof location === "string" ? `id "${location}"` : `${location}`
                    throw new Error(getLocaleString("cellNotFound", id));
                }
            }
        }
        m = loadPattern.exec(line);
        if(m){
            if(!FileHandler.hasSaveLocation(baseUri)){
                throw new Error(getLocaleString("loadingAtUntitledFile"));
            }
            const query = m[1];
            const loadFiles = await FileHandler.resolve(
                baseUri, query, {
                    useGlob: false,
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
        this.loadedCellIndexes.add(idx);
        const lines = this.getLines(cell);
        return (await Promise.all(lines.map(line => {
            return this.readLine(cell.document.uri, line, idx);
        }))).flat();
    }
    async loadForPreview(cell: vscode.NotebookCell): Promise<string>{
        this.clearLoadedCellIndexes();
        this.cells = cell.notebook.getCells();
        return (await this.load(cell)).join("\n");
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
                return [removeComments(code.join("\n")), true];
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
const controller: Controller = new Controller(ID);
const HTMLcontroller: Controller = new Controller(HTML_ID);

const controllerFromCell = (cell: vscode.NotebookCell) => {
    const type = cell.notebook.notebookType;
    if(type === ID) return controller;
    else if(type === HTML_ID) return HTMLcontroller;
    else{
        vscode.window.showErrorMessage(`${type} は無効です．`);
        return undefined;
    };
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
