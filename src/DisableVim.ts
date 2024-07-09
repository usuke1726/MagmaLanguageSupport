
import * as vscode from 'vscode';
import LogObject from './Log';
import getConfig from './config';
import getLocaleStringBody from './locale';
const { Log } = LogObject.bind("Notebook");
const getLocaleString = getLocaleStringBody.bind(undefined, "message.DisableVim");

let isVimActive: boolean = false;
let isDisabled: boolean = false;

const init = () => {
    try{
        const VimConfig = vscode.workspace.getConfiguration("vim");
        const disabled = VimConfig.get<boolean>("disableExtension");
        if(disabled === undefined) return;
        isVimActive = true;
        isDisabled = disabled;
    }catch{}
};

const setDisableVim = (disabled: boolean) => {
    if(!isVimActive) return;
    Log("setDisableVim", isDisabled, disabled);
    if(isDisabled !== disabled){
        isDisabled = disabled;
        if(getConfig().notebookDisablesVim){
            try{
                vscode.commands.executeCommand("toggleVim");
            }catch{}
        }
    }else{
        Log("same disable");
    }
};

let previousScheme: string | undefined = undefined;
const setDisableVimProviders = (context: vscode.ExtensionContext) => {
    Log("DisableVim activated");
    init();
    vscode.workspace.onDidChangeConfiguration(e => {
        try{
            if(e.affectsConfiguration("vim.disableExtension")){
                Log("vim.disableExtension changed");
                init();
            }
            if(e.affectsConfiguration("MagmaLanguageSupport.notebookDisablesVim")){
                const reloadTitle = getLocaleString("reload");
                vscode.window.showInformationMessage(getLocaleString("suggestsReloading"), {}, {
                    title: reloadTitle
                }).then(val => {
                    if(!val) return;
                    if(val.title === reloadTitle){
                        vscode.commands.executeCommand("workbench.action.reloadWindow");
                    }
                });
            }
            Log("CHANGED");
        }catch(e){
            Log("ERROR", e);
        }
    });
    vscode.window.onDidChangeActiveTextEditor(e => {
        Log("activeTextEditor changed");
        Log("previousScheme:", previousScheme);
        const newScheme = e?.document.uri.scheme;
        Log(newScheme);
        const notebookScheme = "vscode-notebook-cell";
        if(newScheme === undefined){
            Log("scheme is undefined");
        }else if(newScheme !== notebookScheme){
            Log("Note -> non Note");
            setDisableVim(false);
        }else if(newScheme === notebookScheme){
            Log("non Note -> Note");
            setDisableVim(true);
        }else{
            Log("otherwise");
        }
        previousScheme = newScheme;
    });
};

export default setDisableVimProviders;
