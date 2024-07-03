
import * as vscode from 'vscode';
import Log from './Log';

type Config = {
    enableAutoCompletion: boolean;
    enableHover: boolean;
    enableDefinition: boolean;
    onChangeDelay: number;
};
const defaultConfig: Config = {
    enableAutoCompletion: true,
    enableHover: true,
    enableDefinition: true,
    onChangeDelay: 3000
};
type ConfigKey = keyof Config;
const keys: ConfigKey[] = [
    "enableAutoCompletion",
    "enableHover",
    "enableDefinition",
    "onChangeDelay",
];
const isConfig = (obj: any): obj is Config => {
    return (
        typeof obj === "object" &&
        keys.every(k => obj.hasOwnProperty(k)) &&
        typeof obj["enableAutoCompletion"] === "boolean" &&
        typeof obj["enableHover"] === "boolean" &&
        typeof obj["enableDefinition"] === "boolean" &&
        typeof obj["onChangeDelay"] === "number"
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
