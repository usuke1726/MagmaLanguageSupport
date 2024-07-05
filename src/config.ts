
import * as vscode from 'vscode';
import Log from './Log';

type Config = {
    enableAutoCompletion: boolean;
    enableHover: boolean;
    enableDefinition: boolean;
    onChangeDelay: number;
    functionCompletionType: "snippet" | "original" | "none";
    warnsWhenRedefiningIntrinsic: boolean;
};
const defaultConfig: Config = {
    enableAutoCompletion: true,
    enableHover: true,
    enableDefinition: true,
    onChangeDelay: 1000,
    functionCompletionType: "snippet",
    warnsWhenRedefiningIntrinsic: true,
};
type ConfigKey = keyof Config;
const conditions: {[key in ConfigKey]: (val: unknown) => boolean} = {
    enableAutoCompletion: val => typeof val === "boolean",
    enableHover: val => typeof val === "boolean",
    enableDefinition: val => typeof val === "boolean",
    onChangeDelay: val => typeof val === "number",
    functionCompletionType: val => typeof val === "string" && ["snippet", "original", "none"].includes(val),
    warnsWhenRedefiningIntrinsic: val => typeof val === "boolean",
};
const keys: ConfigKey[] = Object.keys(conditions) as ConfigKey[];
const isConfig = (obj: any): obj is Config => {
    return (
        typeof obj === "object" &&
        keys.every(k => obj.hasOwnProperty(k) && conditions[k](obj[k]))
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
