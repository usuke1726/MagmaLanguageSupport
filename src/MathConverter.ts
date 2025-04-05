
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import getConfig from "./config";
import LogObject from './Log';
import DocumentParser from "./DocumentParser";
const { Log } = LogObject.bind("MathConverter");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({
    packages: AllPackages,
});
const svg = new SVG({
    fontCache: 'none'
});

const toSVG = (text: string, isBlock: boolean): string => {
    const mathdoc = mathjax.document('', {
        InputJax: tex,
        OutputJax: svg
    });
    const ret = mathdoc.convert(text, {
        display: isBlock
    });
    let out = adaptor.innerHTML(ret).replace(
        /(?<=<svg.+?>)/,
        `
<style>
    * {
        fill: #d4d4d4;
        background-color: transparent;
    }
</style>`
    );
    if(out.includes("merror")) {
        out = out.replace(/<rect.+?><\/rect>/, "");
    }
    const header = `<?xml version="1.0" standalone="no" ?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.0//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">`;
    const full = `${header}\n${out}`;
    return full;
}

const toURI_MathAPI = (text: string, isBlock: boolean): string => {
    const uri = `https://math.vercel.app/?color=%23d4d4d4&bgcolor=transparent&${isBlock ? "from" : "inline"}=${encodeURIComponent(text.trim())}.svg`
    Log("URI:", uri);
    return `![](${uri})`;
}
const toURI_TeXSVGWorker = (text: string, isBlock: boolean): string => {
    const css = encodeURIComponent("svg{color:#d4d4d4;background:transparent}");
    const tex = encodeURIComponent(text.trim());
    const inline = isBlock ? "" : "&inline=true"
    const uri = `https://tex.jacob.workers.dev/?tex=${tex}${inline}&css=${css}`;
    Log("URI:", uri);
    return `![](${uri})`;
}

const toEmbeddedURI = (text: string, isBlock: boolean): string => {
    const svg = toSVG(text, isBlock)
    const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    Log("URI:", uri);
    return `![](${uri})`;
}

const convertMath = (text: string, isBlock: boolean): string => {
    try{
        const config = getConfig();
        if(!config.useMath) throw Error();
        switch(config.mathRenderingType){
            case "embedding": return toEmbeddedURI(text, isBlock);
            case "fetch:math-api": return toURI_MathAPI(text, isBlock);
            case "fetch:TeX-SVG-Worker": return toURI_TeXSVGWorker(text, isBlock);
            default: throw Error();
        }
    }catch{
        return isBlock
            ? DocumentParser.wrapWithBlockTextCode(text, "tex")
            : DocumentParser.wrapWithInlineCode(text);
    }
}

export default convertMath;
