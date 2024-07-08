
import * as vscode from 'vscode';
import LogObject from './Log';
const { Log, Output } = LogObject.bind("Config");

type Paths = {
    [key: string]: string
};
const isPaths = (obj: any): obj is Paths => {
    return (
        typeof obj === "object" &&
        Object.keys(obj).every(key => typeof obj[key] === "string")
    );
};
const formatPath = (paths: Paths): Paths => {
    const pathsWithoutInvalid = Object.fromEntries(
        Object.entries(paths)
        .filter(([key, value]) => {
            const keyPattern = /^@\w+\/$/;
            const valuePattern = /^\.\/([^~?\/<>\\*"|:]+\/)+$/;
            return keyPattern.test(key) && valuePattern.test(value);
        })
        .map(([key, value]) => {
            value = value.replace(".", "~");
            return [key, value];
        })
    );
    pathsWithoutInvalid["@/"] = "./";
    return pathsWithoutInvalid;
};

type Config = {
    enableAutoCompletion: boolean;
    enableHover: boolean;
    enableDefinition: boolean;
    onChangeDelay: number;
    functionCompletionType: "snippet" | "original" | "none";
    warnsWhenRedefiningIntrinsic: boolean;
    paths: Paths;
};
const defaultConfig: Config = {
    enableAutoCompletion: true,
    enableHover: true,
    enableDefinition: true,
    onChangeDelay: 1000,
    functionCompletionType: "snippet",
    warnsWhenRedefiningIntrinsic: true,
    paths: {},
};
type ConfigKey = keyof Config;
const conditions: {[key in ConfigKey]: (val: unknown) => boolean} = {
    enableAutoCompletion: val => typeof val === "boolean",
    enableHover: val => typeof val === "boolean",
    enableDefinition: val => typeof val === "boolean",
    onChangeDelay: val => typeof val === "number",
    functionCompletionType: val => typeof val === "string" && ["snippet", "original", "none"].includes(val),
    warnsWhenRedefiningIntrinsic: val => typeof val === "boolean",
    paths: val => isPaths(val),
};
const keys: ConfigKey[] = Object.keys(conditions) as ConfigKey[];
const isConfig = (obj: any): obj is Config => {
    return (
        typeof obj === "object" &&
        keys.every(k => obj.hasOwnProperty(k) && conditions[k](obj[k]))
    );
};
const format = (obj: Config): Config => {
    const ret = {...obj};
    ret.paths = formatPath(ret.paths);
    return ret;
};

let configCache: Config | undefined = undefined;
let initted = false;
const loadConfig = (): Config => {
    const config = vscode.workspace.getConfiguration("MagmaLanguageSupport");
    const obj = Object.fromEntries(keys.map(k => [k, config.get<any>(k)]));
    if(isConfig(obj)){
        configCache = format(obj);
        Output(`successfully ${initted ? "re" : ""}loaded config.`);
        Log("config:", configCache);
    }else{
        Log("FAILED LOADING CONFIG");
        Output(`FAILED LOADING CONFIG (will use default values)\n\tvalue: ${JSON.stringify(obj)}`);
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
