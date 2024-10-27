
import convertMath from "./MathConverter";
import LogObject from './Log';
const { Log } = LogObject.bind("MathParser");

const indexOfEndOfBlockCode = (text: string, indent: string, fence: string): number => {
    const endBlockCode = RegExp(`(^|(?<=\\n)|\\G)(${indent}|\\s{0,3})(${fence})\\s*(?=\\n|$)`);
    const m = endBlockCode.exec(text);
    if(!m) return text.length;
    else return m.index + m[0].length;
}
const indexOfEndOfBlockMath = (text: string): number => {
    const endBlockMath = /(^|(?<=\n)|\G)((?<!\\)\$){2}/;
    const m = endBlockMath.exec(text);
    if(!m) return text.length;
    else return m.index + m[0].length;
}

const main = (text: string): [string, string] => {
    const inlineCode = /(`+)((?:[^`]|(?!(?<!`)\1(?!`))`)*)(\1)/;
    const startBlockCode = /(^|(?<=\n)|\G)(\s*)(`{3,}|~{3,})\s*[^`\n]*(?=\n|$)/;
    const inlineMath = /(?<!\\)\$(([^\$]|(\\\$))*)(?<!\\)\$/;
    const startBlockMath = /(^|(?<=\n)|\G)((?<!\\)\$){2}/;
    const m1 = startBlockCode.exec(text);
    const m2 = startBlockMath.exec(text);
    const m3 = inlineCode.exec(text);
    const m4 = inlineMath.exec(text);
    if(!m1 && !m2 && !m3 && !m4) return [text, ""];
    const minIndex = Math.min(
        ...[m1,m2,m3,m4]
        .filter(m => m !== null)
        .map(m => m.index)
    );
    if(m1?.index === minIndex){
        const head = text.substring(0, m1.index + m1[0].length);
        text = text.substring(m1.index + m1[0].length);
        const endIdx = indexOfEndOfBlockCode(text, m1[2], m1[3]);
        const body = text.substring(0, endIdx);
        Log(`==CODE==\n\t${body}\n`);
        text = text.substring(endIdx);
        Log(`-- remaining --\n\t${text}\n`);
        return [`${head}${body}`, text];
    }
    if(m2?.index === minIndex){
        const head = text.substring(0, m2.index);
        text = text.substring(m2.index + m2[0].length);
        const endIdx = indexOfEndOfBlockMath(text);
        const body = text.substring(0, endIdx);
        const mathContents = body.substring(0, body.length-2);
        Log(`== MATH BLOCK ==\n\t${body}\n`);
        text = text.substring(endIdx);
        Log(`-- remaining --\n\t${text}\n`);
        return [`${head}${convertMath(mathContents, true)}`, text];
    }
    if(m3?.index === minIndex){
        const head = text.substring(0, m3.index);
        text = text.substring(m3.index);
        const body = text.substring(0, m3[0].length)
        Log(`== inlineCode ==\n\t${body}\n`);
        text = text.substring(m3[0].length);
        Log(`-- remaining --\n\t${text}\n`);
        return [`${head}${body}`, text];
    }
    if(m4?.index === minIndex){
        const head = text.substring(0, m4.index);
        text = text.substring(m4.index);
        const body = text.substring(0, m4[0].length)
        const mathContents = m4[1];
        Log(`== inlineMath ==\n\t${body}\nmathContents:\n\t${mathContents}\n`);
        text = text.substring(m4[0].length);
        Log(`-- remaining --\n\t${text}\n`);
        return [`${head}${convertMath(mathContents, false)}`, text];
    }
    throw Error("not expected");
}

export const allConvert = (text: string): string => {
    let ret = "";
    while(true){
        const [done, remaining] = main(text);
        ret += done;
        if(!remaining){
            Log(`ALL DONE:\nlength: ${ret.length}`);
            return ret;
        }
        text = remaining;
    }
}
