
import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import mathEscaper from "./MarkdownMathEscaper";

type RowNotebookCell = {
    language: string;
    value: string;
    kind: vscode.NotebookCellKind;
    outputs: string | undefined;
};

const md = MarkdownIt({
    html: true,
    linkify: true,
});
md.use(mathEscaper);

const isInvalidImg = (frame: sanitizeHtml.IFrame) => (
    frame.tag === "img" &&
    typeof frame.attribs.src === "string" &&
    !/^data:image\/(png|jpeg|gif|webp|apng|avif);/i.test(frame.attribs.src)
);

const sanitizeOptions: sanitizeHtml.IOptions = {
    ...sanitizeHtml.defaults,
    allowedTags: [
        ...sanitizeHtml.defaults.allowedTags,
        "details", "summary",
        "img",
    ],
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        span: ["class", "style"],
        div: ["class", "style"],
        td: ["style"],
        th: ["style"],
        details: ["open"],
        img: [ 'src', 'srcset', 'alt', 'title', 'width', 'height', 'loading' ],
    },
    allowedStyles: {
        "*": {
            "color": [/^[a-z]+$/, /^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/],
            "text-align": [/^(start|end|left|center|right|justify|match-parent)$/],
        },
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
        img: ["data"]
    },
    exclusiveFilter: frame => {
        return isInvalidImg(frame);
    },
};

const toOneLine = (t: string) => t.split("\n").map(s => s.trimStart()).join("");

const prefix: string = toOneLine(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
`);

const htmlKaTeXScripts = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css" integrity="sha384-zh0CIslj+VczCZtlzBcjt5ppRcsAmDnRem7ESsYwWwg3m/OaJ2l4x7YBZl9Kxxib" crossorigin="anonymous">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js" integrity="sha384-Rma6DA2IPUwhNxmrB/7S3Tno0YY7sFu9WSYMCuulLhIqYSGZ2gKCJWIqhBWqMQfh" crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/contrib/auto-render.min.js" integrity="sha384-hCXGrW6PitJEwbkoStFjeJxv+fSOOQKOPbJxSfM6G5sWZjAyWhXiTIIAmQqnlLlh" crossorigin="anonymous"></script>
<script>
document.addEventListener("DOMContentLoaded", () => {
    renderMathInElement(document.body, {
        delimiters: [
            {left: "\$\$", right: "\$\$", display: true},
            {left: "\$", right: "\$", display: false}
        ],
        throwOnError: false
    });
});
</script>
`.trim();

const htmlMarkdownStyleLink = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Microsoft/vscode/extensions/markdown-language-features/media/markdown.css">
`.trim();

const htmlOriginalStyle = `
<style>
    pre.code{
        text-wrap: initial;
        background-color: #fafafa !important;
        border: 1px solid #eee;
        border-radius: 5px;
        padding: 10px;
    }
    pre.output{
        text-wrap: initial;
    }
    p.outputs{
        margin-bottom: 0;
    }
</style>
`;

const headerSuffix: string = toOneLine(`
${htmlKaTeXScripts}
${htmlMarkdownStyleLink}
${htmlOriginalStyle}
</head>
`);

const render = (text: string) => sanitizeHtml(md.render(text), sanitizeOptions);
const parseOutputs = (outputs: string | undefined) => {
    if(!outputs) return [];
    const isOutputs = (obj: any): obj is string[][] => 
        Array.isArray(obj) && obj.every(items =>
            Array.isArray(items) && items.every(item => typeof item === "string")
        );
    try{
        const parsed = JSON.parse(outputs);
        return isOutputs(parsed) ? parsed : [];
    }catch{
        return [];
    }
};
const escape = (s: string) => {
    return s.replace(/[&'\`"<>]/g, m => {
        return {
            '&': '&amp;',
            "'": '&#x27;',
            '\`': '&#x60;',
            '"': '&quot;',
            '<': '&lt;',
            '>': '&gt;',
        }[m] as string;
    });
};
const parseData = (cells: readonly RowNotebookCell[]) => {
    return cells.map(cell => {
        if(cell.kind === vscode.NotebookCellKind.Markup){
            return `<div class="markup">${render(cell.value)}</div>`;
        }else{
            const outputs = parseOutputs(cell.outputs);
            const outputHtml = outputs.length ? (
                `<p class="outputs">Outputs:</p>` + outputs.flat().map(item => 
                    `<pre class="output"><code>${escape(item)}</code></pre>`
                ).join("")
            ) : "";
            return `<pre class="code"><code>${escape(cell.value)}</code></pre>${outputHtml}`;
        }
    }).map(cell => `<div class="cell">${cell}</div>`).join("");
};

export const extractHtmlData = (htmlContents: string) => {
    const lines = htmlContents.replaceAll("\r\n", "\n").split("\n");
    if(lines.length > 1){
        return JSON.parse(lines[1].replaceAll("<\\!--", "<!--").replaceAll("--\\>", "-->"));
    }else{
        return JSON.parse(htmlContents);
    }
};

export const toHtmlContents = (data: string, rowData: readonly RowNotebookCell[], includesData: boolean = true) => {
    const dataContents = includesData ? `<!--\n${data.replaceAll("<!--", "<\\!--").replaceAll("-->", "--\\>")}\n-->` : "";
    const body = `<body class="vscode-body vscode-light">${parseData(rowData)}</body>`;
    return `${prefix}${dataContents}${headerSuffix}${body}</html>`;
};
