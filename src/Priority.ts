
import getConfig from "./config";

export const hasPriority = (name: string, type: "intrinsic" | "function" | "variable" | "other"): boolean => {
    const { priorityCompletionItems } = getConfig();
    if(priorityCompletionItems.includes(name)) return true;
    switch(type){
        case "function": return priorityCompletionItems.includes("@functions");
        case "variable": return priorityCompletionItems.includes("@variables");
        default: return false;
    }
};

export const sortTextWithPriority = (name: string): string => `..${name}`;

export default (name: string, type: "intrinsic" | "function" | "variable" | "other"): string => {
    return hasPriority(name, type) ? sortTextWithPriority(name) : name;
};
