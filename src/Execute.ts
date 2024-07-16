
import * as vscode from 'vscode';
import LogObject from './Log';
import getLocaleStringBody from './locale';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getMagmaDocument, load } from './Loader';
import getConfig from './config';
import FileHandler from './FileHandler';
const { Log, Output } = LogObject.bind("Execute");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.Execute");
const getLoaderLocaleString = getLocaleStringBody.bind(undefined, "message.Loader");
const getRedirectTypeLocaleString = getLocaleStringBody.bind(undefined, "config.redirectsStderr");


const validatePath = async (path: string) => {
    if(!path.trim()){
        throw new Error(getLocaleString("notConfiguredMagmaPath"));
    }
    Log(path);
    const status = await (async () => {
        try{
            return await fs.stat(path);
        }catch{
            throw new Error(getLocaleString("notFoundMagmaPath"));
        }
    })();
    if(!status.isFile()){
        throw new Error("MagmaPathIsNotFile");
    }
};

const basename = (uri: vscode.Uri): string => {
    const fullpath = uri.fsPath.replaceAll("\\", "/");
    const idx = fullpath.lastIndexOf("/");
    if(idx < 0) return fullpath;
    return fullpath.substring(idx + 1);
};
const toDefaultOutputFile = (uri: vscode.Uri): string => {
    return basename(uri).replace(/\.(m|mag|magma|\.magmarc|\.magmarc-dev)$/, "-out.txt");
};
const toDefaultErrorFile = (uri: vscode.Uri): string => {
    return basename(uri).replace(/\.(m|mag|magma|\.magmarc|\.magmarc-dev)$/, "-err.txt");
};

const main = async () => {
    const document = getMagmaDocument(false);
    if(!document) return;
    const uri = document.uri;
    const {magmaPath, redirectsStderr} = getConfig();
    let errType = redirectsStderr;
    try{
        await validatePath(magmaPath);
    }catch(e){
        const mes = e instanceof Error ? e.message : String(e);
        const goToSettings = getLocaleString("goToSettings");
        vscode.window.showErrorMessage(mes, goToSettings).then(val => {
            if(val === goToSettings){
                vscode.commands.executeCommand("workbench.action.openSettings", "MagmaLanguageSupport.magmaPath");
            }
        });
        return;
    }
    let code: string;
    try{
        code = await load(uri);
        code = `SetQuitOnError(true);\n${code}\n;quit;\n\n`;
    }catch(e){
        const mes = (e instanceof Error) ? e.message : String(e);
        vscode.window.showErrorMessage(`${getLoaderLocaleString("failed")}\n${mes}`);
        return;
    }
    const baseDir = FileHandler.base(uri);
    const out = (await vscode.window.showInputBox({
        placeHolder: getLocaleString("InputBoxPlaceHolder"),
        prompt: getLocaleString("InputBoxPrompt"),
        value: toDefaultOutputFile(uri)
    }))?.trim();
    if(!out) return;
    if(errType === "select"){
        const keys = ["yes", "separately", "no"] as ("yes" | "separately" | "no")[];
        const type = await vscode.window.showQuickPick(
            keys.map(type => {
                return {
                    label: type,
                    description: getRedirectTypeLocaleString(type)
                };
            }), {
                title: getLocaleString("RedirectTypePrompt")
            }
        );
        if(type){
            errType = type.label;
        }else{
            return;
        }
    }
    const isSep = errType === "separately";
    const err = isSep ? (await vscode.window.showInputBox({
        placeHolder: getLocaleString("InputBoxPlaceHolder"),
        prompt: getLocaleString("InputBoxStderrPrompt"),
        value: toDefaultErrorFile(uri)
    }))?.trim() : "";
    if(err === undefined) return;
    if(isSep && !err.trim()) return;
    let outPath;
    let errPath;
    let file;
    let errfile;
    try{
        outPath = vscode.Uri.joinPath(baseDir, out).fsPath;
        file = await fs.open(outPath, "a");
        if(isSep){
            errPath = vscode.Uri.joinPath(baseDir, err).fsPath;
            errfile = await fs.open(errPath, "a");
        }
    }catch(e){
        const mes = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`${getLocaleString("fileOpenError")}: ${mes}`);
        return;
    }
    try{
        const fd = file.fd;
        const errfd = (() => {
            switch(errType){
                case "yes": return fd;
                case "separately": return errfile?.fd;
                case "no": return undefined;
            }
        })() ?? "ignore";
        const process = spawn(magmaPath, [], {
            stdio: ["pipe", fd, errfd],
            detached: true
        });
        const {pid} = process;
        if(pid && process.stdin){
            Output(`start execute magma with\n\tmagmaFile: ${uri.fsPath}\n\toutPath: ${outPath} (fd: ${fd})\n\terrPath: ${errPath}${typeof errfd === "number" ? ` (fd: ${errfd})` : ""}\n\tPID: ${pid}`);
            file.write(new TextEncoder().encode(`\n=== PID: ${pid} ===\n`));
            process.stdin.end(code);
            process.unref();
        }else{
            vscode.window.showErrorMessage(getLocaleString("processError"));
        }
        file.close();
        errfile?.close();
    }catch(e){
        const mes = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`${getLocaleString("executionError")}: ${mes}`);
    }
};

const setExecuteProviders = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(vscode.commands.registerCommand("extension.magma.executeInBackground", () => {
        main();
    }));
};

export default setExecuteProviders;
