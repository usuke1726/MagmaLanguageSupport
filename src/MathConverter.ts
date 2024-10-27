
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import * as http from "http";
import getConfig, { onChanged } from "./config";
import LogObject from './Log';
import DocumentParser from "./DocumentParser";
const { Log, Output } = LogObject.bind("MathConverter");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({
    packages: AllPackages,
});
const svg = new SVG({
    fontCache: 'none'
});

type ServerRequest = {
    text: string;
    isBlock: boolean;
};
class Server{
    private _isActive: boolean
    private server: http.Server | undefined;
    private _port: number | undefined;
    get port(){
        if(this._port === undefined) throw Error();
        return this._port;
    }
    get isActive(){ return this._isActive; }
    constructor(){
        this._isActive = false;
        this._port = undefined;
        this.server = undefined;
        const config = getConfig();
        if(config.useMath && config.mathRenderingType === "server"){
            this.start();
        }
        onChanged((newConfig) => {
            const isActive = newConfig.useMath && newConfig.mathRenderingType === "server";
            if(this._isActive !== isActive){
                isActive ? this.start() : this.close();
            }
        });
    }
    private close(){
        this._isActive = false;
        this._port = undefined;
        this.server?.close();
        this.server = undefined;
        Output(`Server closed.`);
    }
    private start(){
        Log("start server");
        this.server = http.createServer((req, res) => {
            Log("server requested");
            const body = this.parseRequest(req);
            Log(body);
            if(!body){
                res.writeHead(400, {
                    "Content-Type": "text/plain"
                });
                res.end("bad request");
                return;
            }
            try{
                const svg = toSVG(body.text, body.isBlock);
                res.writeHead(200, {
                    "Content-Type": "image/svg+xml"
                });
                res.end(svg);
            }catch(e){
                Output(`Math converting error:\n\t${String(e)}`);
                res.writeHead(400, {
                    "Content-Type": "text/plain"
                });
                res.end("bad request");
                return;
            }
        });
        this.server.on("listening", () => {
            const address = this.server?.address();
            if(address && typeof address !== "string"){
                this._port = address.port;
                Output(`Server started listening on port ${this._port}.`);
                this._isActive = true;
            }else{
                Output(`Server seems to have failed to start.`);
                this.close();
            }
        });
        this.server.on("error", e => {
            Output(`Server error:\n\t${e.message}`);
            this.close();
        });
        this.server.listen(0);
    }
    private parseRequest(req: http.IncomingMessage): ServerRequest | undefined{
        const query = req.url;
        if(!query) return undefined;
        const pattern = /^\/\?(from|inline)=([a-zA-Z0-9\-_.!%*'~()]+)$/;
        const m = pattern.exec(query);
        if(!m) return undefined;
        try{
            const text = decodeURIComponent(m[2]);
            const isBlock = m[1] === "from";
            return { text, isBlock };
        }catch{
            return undefined;
        }
    }
};

let server: Server;
export const setMathConverter = () => {
    server = new Server();
}

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

// maybe use this in the future
const _toExternalURI = (text: string, isBlock: boolean): string => {
    const uri = `https://math.vercel.app/?color=%23d4d4d4&bgcolor=transparent&${isBlock ? "from" : "inline"}=${encodeURIComponent(text.trim())}.svg`
    Log("URI:", uri);
    return `![](${uri})`;
}

const toEmbeddedURI = (text: string, isBlock: boolean): string => {
    const svg = toSVG(text, isBlock)
    const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    Log("URI:", uri);
    return `![](${uri})`;
}

const toURI = (text: string, isBlock: boolean): string => {
    const port = server.port;
    const uri = `http://localhost:${port}/?${isBlock ? "from" : "inline"}=${encodeURIComponent(text.trim())}`;
    Log("URI:", uri);
    return `![](${uri})`;
}

const convertMath = (text: string, isBlock: boolean): string => {
    try{
        if(!getConfig().useMath) throw Error();
        if(server.isActive){
            return toURI(text, isBlock);
        }else{
            return toEmbeddedURI(text, isBlock);
        }
    }catch{
        return isBlock
            ? DocumentParser.wrapWithBlockTextCode(text, "tex")
            : DocumentParser.wrapWithInlineCode(text);
    }
}

export default convertMath;
