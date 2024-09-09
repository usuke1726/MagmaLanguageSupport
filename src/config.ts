
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
const isStringValueObject = (obj: any) => {
    return (
        typeof obj === "object" &&
        Object.keys(obj).every(k => typeof obj[k] === "string")
    );
};

export type CompletionValue = "original" | "snippet" | "snippet-space" | "disabled";
export const CompletionKeys = [":=", "if", "for", "while", "case", "repeat", "try", "function", "procedure", "forward", "definition", "built-in-intrinsic"] as const;
export type CompletionKeysType = typeof CompletionKeys[number];
export type CompletionTypes = {
    [key in CompletionKeysType]: CompletionValue;
};
type UserDefinedCompletionTypes = {
    [key in CompletionKeysType]?: CompletionValue;
};
const isCompletionValue = (obj: any): obj is CompletionValue => {
    return ["original", "snippet", "snippet-space", "disabled"].includes(obj);
};
const isUserDefinedCompletionTypes = (obj: any): obj is UserDefinedCompletionTypes => {
    return (
        typeof obj === "object" &&
        CompletionKeys.every(k => !obj.hasOwnProperty(k) || isCompletionValue(obj[k]))
    );
};
const formatCompletionTypes = (types: UserDefinedCompletionTypes): CompletionTypes => {
    return {
        ...defaultConfig.completionTypes,
        ...types
    };
};

type Config = {
    completionTypes: CompletionTypes;
    intrinsicCompletionAliases: { [alias: string]: string },
    enableHover: boolean;
    enableDefinition: boolean;
    useLastInlineCommentAsDoc: boolean | "tripleSlash";
    onChangeDelay: number;
    warnsWhenRedefiningIntrinsic: boolean;
    paths: Paths;
    notebookSavesOutputs: boolean;
    notebookOutputResultMode: "append" | "overwrite";
    notebookDisablesVim: boolean;
    notebookSeparatesWithHorizontalLines: boolean;
    magmaPath: string;
    redirectsStderr: "yes" | "separately" | "select" | "no";
};
const defaultConfig: Config = {
    completionTypes: {
        ...Object.fromEntries(CompletionKeys.map<[CompletionKeysType, "snippet"]>(k => [k, "snippet"])) as CompletionTypes,
        ...{ ":=": "original" }
    },
    intrinsicCompletionAliases: {},
    enableHover: true,
    enableDefinition: true,
    useLastInlineCommentAsDoc: "tripleSlash",
    onChangeDelay: 1000,
    warnsWhenRedefiningIntrinsic: true,
    paths: {},
    notebookSavesOutputs: true,
    notebookOutputResultMode: "append",
    notebookDisablesVim: false,
    notebookSeparatesWithHorizontalLines: true,
    magmaPath: "",
    redirectsStderr: "select",
};
type ConfigKey = keyof Config;
const conditions: {[key in ConfigKey]: (val: unknown) => boolean} = {
    completionTypes: val => isUserDefinedCompletionTypes(val),
    intrinsicCompletionAliases: val => isStringValueObject(val),
    enableHover: val => typeof val === "boolean",
    enableDefinition: val => typeof val === "boolean",
    useLastInlineCommentAsDoc: val => val === "tripleSlash" || typeof val === "boolean",
    onChangeDelay: val => typeof val === "number",
    warnsWhenRedefiningIntrinsic: val => typeof val === "boolean",
    paths: val => isPaths(val),
    notebookSavesOutputs: val => typeof val === "boolean",
    notebookOutputResultMode: val => val === "append" || val === "overwrite",
    notebookDisablesVim: val => typeof val === "boolean",
    notebookSeparatesWithHorizontalLines: val => typeof val === "boolean",
    magmaPath: val => typeof val === "string",
    redirectsStderr: val => typeof val === "string" && ["yes", "separately", "select", "no"].includes(val),
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
    ret.completionTypes = formatCompletionTypes(ret.completionTypes);
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
