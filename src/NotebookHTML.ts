
const toOneLine = (t: string) => t.split("\n").map(s => s.trimStart()).join("");

const prefix: string = toOneLine(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
`);

const htmlKaTeXLinks = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css" integrity="sha384-zh0CIslj+VczCZtlzBcjt5ppRcsAmDnRem7ESsYwWwg3m/OaJ2l4x7YBZl9Kxxib" crossorigin="anonymous">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js" integrity="sha384-Rma6DA2IPUwhNxmrB/7S3Tno0YY7sFu9WSYMCuulLhIqYSGZ2gKCJWIqhBWqMQfh" crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/contrib/auto-render.min.js" integrity="sha384-hCXGrW6PitJEwbkoStFjeJxv+fSOOQKOPbJxSfM6G5sWZjAyWhXiTIIAmQqnlLlh" crossorigin="anonymous"></script>
`.trim();

const htmlMarkdownStyleLink = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Microsoft/vscode/extensions/markdown-language-features/media/markdown.css">
`.trim();

const htmlMarkdownWasmLink = `
<script defer src='https://cdn.jsdelivr.net/gh/rsms/markdown-wasm@v1.2.0/dist/markdown.js'></script>
`.trim();

const htmlParseDataScript = `
<script>
const esc = s => {
    return s.replace(/[&'\`"<>]/g, m => {
        return {
            '&': '&amp;',
            "'": '&#x27;',
            '\`': '&#x60;',
            '"': '&quot;',
            '<': '&lt;',
            '>': '&gt;',
        }[m]
    });
};
document.addEventListener("DOMContentLoaded", async () => {
    await markdown.ready;
    document.body.innerHTML = DATA.map(data => {
        if(data.kind === 1){
            return \`<div class="markdown">\${markdown.parse(data.value)}</div>\`;
        }else{
            const outputs = (() => {
                if(data.hasOwnProperty("outputs")){
                    const outputs = JSON.parse(data.outputs);
                    if(outputs.length > 0){
                        return \`<p class="outputs">Outputs:</p>\` + outputs.map(items => items.map(item => \`<pre class="output"><code>\${esc(item)}</code></pre>\`).join("")).join("");
                    }else{
                        return "";
                    }
                }else{
                    return "";
                }
            })();
            return \`<pre class="code"><code>\${esc(data.value)}</code></pre>\${outputs}\`;
        }
    }).map(cell => \`<div class="cell">\${cell}</div>\`).join("");
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

const suffix: string = toOneLine(`
${htmlKaTeXLinks}
${htmlMarkdownStyleLink}
${htmlMarkdownWasmLink}
${htmlParseDataScript}
${htmlOriginalStyle}
</head>
<body class="vscode-body vscode-light"></body>
</html>
`);

export const extractHtmlData = (htmlContents: string) => {
    const lines = htmlContents.replaceAll("\r\n", "\n").split("\n");
    if(lines.length > 1 && lines[1].startsWith("DATA=")){
        return JSON.parse(lines[1].slice(5));
    }else{
        return JSON.parse(htmlContents);
    }
};

export const toHtmlContents = (data: string) => {
    data = data.replaceAll("</script>", "<\\/script>");
    return `${prefix}<script>\nDATA=${data}\n</script>${suffix}`;
};
