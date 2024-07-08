
import * as vscode from 'vscode';
import localeEn from "../package.nls.json";
import localeJa from "../package.nls.ja.json";

const format = (str: string, ...args: any[]): string => {
    args.forEach((value, idx) => {
        str = str.replace(new RegExp(`\\{${idx}\\}`, "g"), String(value));
    });
    return str;
};
type LocaleType = {
    [key: string]: string;
};
const getLocale = (): LocaleType => {
    switch(vscode.env.language){
        case "ja":
            return localeJa;
        default:
            return localeEn;
    }
};
const locale = getLocale();
const getLocaleString = (category: string, subkey: string, ...args: any[]) => {
    const key = `${category}.${subkey}`;
    if(locale.hasOwnProperty(key)){
        return format(locale[key], ...args);
    }else{
        return "";
    }
};

export default getLocaleString;

