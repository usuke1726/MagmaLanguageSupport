
import * as vscode from 'vscode';
import Log from './Log';

type Config = {
    enableAutoCompletion: boolean;
    enableHover: boolean;
    enableDifinition: boolean;
};
const defaultConfig: Config = {
    enableAutoCompletion: true,
    enableHover: true,
    enableDifinition: true
};
type ConfigKey = keyof Config;
const keys: ConfigKey[] = [
    "enableAutoCompletion",
    "enableHover",
    "enableDifinition",
];
const isConfig = (obj: any): obj is Config => {
    return (
        typeof obj === "object" &&
        keys.every(k => obj.hasOwnProperty(k) && typeof obj[k] === "boolean")
    );
};

let configCache: Config | undefined = undefined;
let initted = false;
const loadConfig = (): Config => {
    const config = vscode.workspace.getConfiguration("MagmaLanguageSupport");
    const obj = Object.fromEntries(keys.map(k => [k, config.get<boolean>(k)]));
    if(isConfig(obj)){
        configCache = obj;
    }else{
        Log("FAILED LOADING CONFIG");
        configCache = defaultConfig;
    }
    if(!initted){
        initted = true;
        vscode.workspace.onDidChangeConfiguration(e => {
            loadConfig();
        });
    }
    return configCache;
};
const getConfig = (): Config => {
    return configCache ?? loadConfig();
};

export default getConfig;
