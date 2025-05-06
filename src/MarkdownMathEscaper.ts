
import MarkdownIt, { StateInline, StateBlock } from "markdown-it";

const escape = (s: string) => {
    return s
    .replace(/&(?!#92;)/g, "&amp;")
    .replace(/['\`"<>]/g, m => {
        return {
            "'": '&#x27;',
            '\`': '&#x60;',
            '"': '&quot;',
            '<': '&lt;',
            '>': '&gt;',
        }[m] as string;
    });
};

export default function(md: MarkdownIt){
    md.inline.ruler.before("escape", "math_inline", inlineMath);
    md.renderer.rules.math_inline = (tokens, idx) => {
        return `$${escape(tokens[idx].content)}$`;
    };
    md.inline.ruler.before("escape", "math_inline_block", inlineMathBlock);
    md.renderer.rules.math_inline_block = (tokens, idx) => {
        return `$$\n${escape(tokens[idx].content).trim()}\n$$\n`;
    };
    md.inline.ruler.before("escape", "math_inline_bare_block", inlineBareBlock);
    md.renderer.rules.math_inline_bare_block = (tokens, idx) => {
        return `$$\n${escape(tokens[idx].content).trim()}\n$$\n`;
    };
    md.block.ruler.after("blockquote", "math_block", (state, start, end, silent) => 
        blockBareMath(state, start, end, silent) || blockMath(state, start, end, silent)
    );
    md.renderer.rules.math_block = (tokens, idx) => {
        return `$$\n${escape(tokens[idx].content).trim()}\n$$\n`;
    };
};


/*
=================================================
The following codes are used under the MIT License:
Copyright (c) Microsoft Corporation - MIT License https://github.com/microsoft/vscode-markdown-it-katex

(Unused functions have been removed.)
=================================================
*/

/**
 * Test if potential opening or closing delimiter
 */
function isValidInlineDelim(state: StateInline, pos: number): { can_open: boolean; can_close: boolean; } {
    const prevChar = state.src[pos - 1];
    const char = state.src[pos];
    const nextChar = state.src[pos + 1];

    if (char !== '$') {
        return { can_open: false, can_close: false };
    }

    let canOpen = false;
    let canClose = false;
    if (prevChar !== '$' && prevChar !== '\\' && (
        prevChar === undefined || isWhitespace(prevChar) || !isWordCharacterOrNumber(prevChar)
    )) {
        canOpen = true;
    }

    if (nextChar !== '$' && (
        nextChar == undefined || isWhitespace(nextChar) || !isWordCharacterOrNumber(nextChar))
    ) {
        canClose = true;
    }

    return { can_open: canOpen, can_close: canClose };
}

function isWhitespace(char: string): boolean {
    return /^\s$/u.test(char);
}

function isWordCharacterOrNumber(char: string): boolean {
    return /^[\w\d]$/u.test(char);
}

function isValidBlockDelim(state: StateInline, pos: number): { readonly can_open: boolean; readonly can_close: boolean; } {
    const prevChar = state.src[pos - 1];
    const char = state.src[pos];
    const nextChar = state.src[pos + 1];
    const nextCharPlus1 = state.src[pos + 2];

    if (
        char === '$'
        && prevChar !== '$' && prevChar !== '\\'
        && nextChar === '$'
        && nextCharPlus1 !== '$'
    ) {
        return { can_open: true, can_close: true };
    }

    return { can_open: false, can_close: false };
}

function inlineMath(state: StateInline, silent: boolean): boolean {
    if (state.src[state.pos] !== "$") {
        return false;
    }

    const lastToken = state.tokens.at(-1);
    if (lastToken?.type === 'html_inline') {
        // We may be inside of inside of inline html
        if (/^<\w+.+[^/]>$/.test(lastToken.content)) {
            return false;
        }
    }

    let res = isValidInlineDelim(state, state.pos);
    if (!res.can_open) {
        if (!silent) {
            state.pending += "$";
        }
        state.pos += 1;
        return true;
    }

    // First check for and bypass all properly escaped delimieters
    // This loop will assume that the first leading backtick can not
    // be the first character in state.src, which is known since
    // we have found an opening delimieter already.
    let start = state.pos + 1;
    let match = start;
    let pos;
    while ((match = state.src.indexOf("$", match)) !== -1) {
        // Found potential $, look for escapes, pos will point to
        // first non escape when complete
        pos = match - 1;
        while (state.src[pos] === "\\") {
            pos -= 1;
        }

        // Even number of escapes, potential closing delimiter found
        if (((match - pos) % 2) == 1) {
            break;
        }
        match += 1;
    }

    // No closing delimter found.  Consume $ and continue.
    if (match === -1) {
        if (!silent) {
            state.pending += "$";
        }
        state.pos = start;
        return true;
    }

    // Check if we have empty content, ie: $$.  Do not parse.
    if (match - start === 0) {
        if (!silent) {
            state.pending += "$$";
        }
        state.pos = start + 1;
        return true;
    }

    // Check for valid closing delimiter
    res = isValidInlineDelim(state, match);
    if (!res.can_close) {
        if (!silent) {
            state.pending += "$";
        }
        state.pos = start;
        return true;
    }

    if (!silent) {
        const token = state.push('math_inline', 'math', 0);
        token.markup = "$";
        token.content = state.src.slice(start, match);
    }

    state.pos = match + 1;
    return true;
}

function blockMath(state: StateBlock, start: number, end: number, silent: boolean): boolean {
    var lastLine, next, lastPos, found = false, token,
        pos = state.bMarks[start] + state.tShift[start],
        max = state.eMarks[start]

    if (pos + 2 > max) {
        return false;
    }
    if (state.src.slice(pos, pos + 2) !== '$$') {
        return false;
    }

    pos += 2;
    let firstLine = state.src.slice(pos, max);

    if (silent) {
        return true;
    }
    if (firstLine.trim().slice(-2) === '$$') {
        // Single line expression
        firstLine = firstLine.trim().slice(0, -2);
        found = true;
    }

    for (next = start; !found;) {

        next++;

        if (next >= end) {
            break;
        }

        pos = state.bMarks[next] + state.tShift[next];
        max = state.eMarks[next];

        if (pos < max && state.tShift[next] < state.blkIndent) {
            // non-empty line with negative indent should stop the list:
            break;
        }

        if (state.src.slice(pos, max).trim().slice(-2) === '$$') {
            lastPos = state.src.slice(0, max).lastIndexOf('$$');
            lastLine = state.src.slice(pos, lastPos);
            found = true;
        }
        else if (state.src.slice(pos, max).trim().includes('$$')) {
            lastPos = state.src.slice(0, max).trim().indexOf('$$');
            lastLine = state.src.slice(pos, lastPos);
            found = true;
        }
    }

    state.line = next + 1;

    token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '')
        + state.getLines(start + 1, next, state.tShift[start], true)
        + (lastLine && lastLine.trim() ? lastLine : '');
    token.map = [start, state.line];
    token.markup = '$$';
    return true;
}

function blockBareMath(state: StateBlock, start: number, end: number, silent: boolean): boolean {
    const startPos = state.bMarks[start] + state.tShift[start];
    const startMax = state.eMarks[start];
    const firstLine = state.src.slice(startPos, startMax);

    const beginMatch = firstLine.match(/^\s*\\begin\s*\{([^{}]+)\}/);
    if (!beginMatch) {
        return false;
    }

    if (start > 0) {
        // Previous line must be blank for bare blocks. There are instead handled by inlineBareBlock
        const previousStart = state.bMarks[start - 1] + state.tShift[start - 1];
        const previousEnd = state.eMarks[start - 1];
        const previousLine = state.src.slice(previousStart, previousEnd);
        if (!/^\s*$/.test(previousLine)) {
            return false;
        }
    }

    if (silent) {
        return true;
    }

    const beginEndStack: string[] = [];
    let next = start;
    let lastLine: string | undefined;
    let found = false;
    outer: for (; !found; next++) {
        if (next >= end) {
            break;
        }

        const pos = state.bMarks[next] + state.tShift[next];
        const max = state.eMarks[next];

        if (pos < max && state.tShift[next] < state.blkIndent) {
            // non-empty line with negative indent should stop the list:
            break;
        }

        const line = state.src.slice(pos, max);
        for (const match of line.matchAll(/(\\begin|\\end)\s*\{([^{}]+)\}/g)) {
            if (match[1] === '\\begin') {
                beginEndStack.push(match[2].trim());
            } else if (match[1] === '\\end') {
                beginEndStack.pop();
                if (!beginEndStack.length) {
                    lastLine = state.src.slice(pos, max);
                    found = true;
                    break outer;
                }
            }
        }
    }

    state.line = next + 1;

    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = (state.getLines(start, next, state.tShift[start], true) + (lastLine ?? '')).trim()
    token.map = [start, state.line];
    token.markup = '$$';
    return true;
}

function inlineMathBlock(state: StateInline, silent: boolean): boolean {
    var start, match, token, res, pos;

    if (state.src.slice(state.pos, state.pos + 2) !== "$$") {
        return false;
    }

    res = isValidBlockDelim(state, state.pos);
    if (!res.can_open) {
        if (!silent) {
            state.pending += "$$";
        }
        state.pos += 2;
        return true;
    }

    // First check for and bypass all properly escaped delimieters
    // This loop will assume that the first leading backtick can not
    // be the first character in state.src, which is known since
    // we have found an opening delimieter already.
    start = state.pos + 2;
    match = start;
    while ((match = state.src.indexOf("$$", match)) !== -1) {
        // Found potential $$, look for escapes, pos will point to
        // first non escape when complete
        pos = match - 1;
        while (state.src[pos] === "\\") {
            pos -= 1;
        }

        // Even number of escapes, potential closing delimiter found
        if (((match - pos) % 2) == 1) {
            break;
        }
        match += 2;
    }

    // No closing delimter found.  Consume $$ and continue.
    if (match === -1) {
        if (!silent) {
            state.pending += "$$";
        }
        state.pos = start;
        return true;
    }

    // Check if we have empty content, ie: $$$$.  Do not parse.
    if (match - start === 0) {
        if (!silent) {
            state.pending += "$$$$";
        }
        state.pos = start + 2;
        return true;
    }

    // Check for valid closing delimiter
    res = isValidBlockDelim(state, match);
    if (!res.can_close) {
        if (!silent) {
            state.pending += "$$";
        }
        state.pos = start;
        return true;
    }

    if (!silent) {
        token = state.push('math_block', 'math', 0);
        token.block = true;
        token.markup = "$$";
        token.content = state.src.slice(start, match);
    }

    state.pos = match + 2;
    return true;
}

function inlineBareBlock(state: StateInline, silent: boolean): boolean {
    const text = state.src.slice(state.pos);

    // Make sure this is not a normal bare block
    if (!/^\n\\begin/.test(text)) {
        return false;
    }
    state.pos += 1;

    if (silent) {
        return true;
    }

    const lines = text.split(/\n/g).slice(1);

    let foundLine: number | undefined;
    const beginEndStack: string[] = [];
    outer: for (var i = 0; i < lines.length; ++i) {
        const line = lines[i];
        for (const match of line.matchAll(/(\\begin|\\end)\s*\{([^{}]+)\}/g)) {
            if (match[1] === '\\begin') {
                beginEndStack.push(match[2].trim());
            } else if (match[1] === '\\end') {
                beginEndStack.pop();
                if (!beginEndStack.length) {
                    foundLine = i;
                    break outer;
                }
            }
        }
    }

    if (typeof foundLine === 'undefined') {
        return false;
    }

    const endIndex = lines.slice(0, foundLine + 1).reduce((p, c) => p + c.length, 0) + foundLine + 1;

    const token = state.push('math_inline_bare_block', 'math', 0);
    token.block = true;
    token.markup = "$$";
    token.content = text.slice(1, endIndex)
    state.pos = state.pos + endIndex;
    return true;
}
