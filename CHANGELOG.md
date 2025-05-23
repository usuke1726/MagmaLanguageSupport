
# Change Log

## 0.9.1 - 2025-05-23

- The settings `MagmaLanguageSupport.useHttps` and `MagmaLanguageSupport.magmaPath` are now only available only in user and remote settings.
- Fixed wrong rendering of HTML-like parts (e.g., `<a>`) within math blocks.
- Fixed a bug where statements following an empty inline block comment `/**/` were treated as comments.

## 0.9.0 - 2025-05-06

- The `@use` statement in a notebook cell can now load cells behind than itself.
- New support for loading with cell IDs in `@use` statements.
    - It can load cells with `@cell "cell ID"` at the beginning.
- More styles are available in Notebook markups.
    - Available styles: `color`, `background-color`, `border-color`, `text-decoration-color`, `text-align`, `font-size`, `font-family`, `line-height`, `letter-spacing`, `padding`, `margin`, `border-radius`, `border-width`, `text-decoration-line`, `text-decoration-style`, `text-decoration-thickness`
- New support for styleTag in Notebook markups.
    - By writing `<div id="__markup" style="..."></div>`, the styles of this tag will be applied to all markup cells.
    - Available IDs: `__body`, `__markup`, `__code`, `__output`, `__math`, `__math_block`, `__` (dummy. not applies any styles) and `__p-0` to `__p-9` (`__p-*` applies to tags with class `p-*`).
- You can now use data URIs in images in Notebook. (except SVG)
- Fixed a bug that opened a cell as a new file when adding a cell in Notebook.
- Improved suggestion: prevents the original suggestion (`function name(args)...end function;`) when writing `end function`.

## 0.8.1 - 2025-04-22

- Fixed a bug where the `extension.magmaNotebook.createNewNotebook` command created two files whose file types were not `.imagma`.

## 0.8.0 - 2025-04-06

- New support for `.imagma.html` file. (Can also use `.imag.html`, etc.)
    - This file can be opened in your browser as an html file. (Instead the file size will be about twice the vanilla.)
    - You can also export a Magma Calculator Notebook to html. (The html file size will be slightly larger than the vanilla.)
    - How to convert `.imagma` file to `.imagma.html`: (and `.imagma.html` to `.imagma`)
        1. Rewrite the extension `.imagma` to `.imagma.html`.
        1. Open and save the file.
- [**BREAKING CHANGE**] The command `extension.magmaNotebook.exportToMarkdown` has been replaced by `extension.magmaNotebook.export`.
    - Use this command whether exporting to markdown or html.
- New support for TeX in documentation.
    - To enable this feature, please first configure `MagmaLanguageSupport.useMath` to `true`. (default is `false`)
- New support for a configuration `MagmaLanguageSupport.priorityCompletionItems` and a tag `@priority`.
    - Functions, intrinsics, and variables tagged with `@priority` or contained in `MagmaLanguageSupport.priorityCompletionItems` will be suggested as a priority.
- New support for https communication when running a code on Magma Calculator Notebook.
- Fixed a bug where the one-line block comment `/* ... */` would disable documentation after the comment.
- Fixed a bug with definition jumps and hovers of arguments.
- Removed invalid intrinsics and fixed typos.

## 0.7.1 - 2024-12-29

- Updated dependent modules to fix vulnerabilities.

## 0.7.0 - 2024-10-26

- New support for variable definitions in `@defined`.
- New support for definitions of function params (arguments).
- New support for signature help of functions.

## 0.6.1 - 2024-10-24

- Fixed a bug where the intrinsic `ParallelSort` was not suggested.
- Fixed a bug where the statement `@internal` in an inline comment was not suggested.
- Fixed a bug where a statement after `load` was included in an inline comment when using MagmaLoader.
- Fixed a bug where the statement `load "A"; "B";` was treated as the wrong filename `A"; "B`;

## 0.6.0 - 2024-09-11

- [**BREAKING CHANGE**] Integrated `enableAutoCompletion` and `functionCompletionType` to `completionTypes`.
- Updated README.
- Added a new comment statement `@ignore`, `@internal`. (prevents external references)
- Added a new command `extension.magma.wrapWithStatement`.
- Enabled detailed settings of `enableDefinition`.
- Fixed a bug where diagnostics in deleted files were not removed.

## 0.5.4 - 2024-09-07

- Updated dependent modules to fix vulnerabilities.

## 0.5.3 - 2024-08-20

- Fixed a bug where links to files with relative paths did not work.

## 0.5.2 - 2024-08-19

- Fixed a bug where user-defined functions were not suggested.

## 0.5.1 - 2024-08-09

- Fixed a bug where function definitions on non-document block comment (`/* ... */`) were registered.
    - This bug fix does not work if `/*` is not at the beginning of a line (ignoring indentation).
- Fixed a bug where hovers and completions did not work on files without save destination.
- Fixed a bug where a file document contained the immediately preceding function definition if the function had no documentation.

## 0.5.0 - 2024-08-08

- Newly supports variable IntelliSense. (hovers and suggestions)
- Newly supports IntelliSense of local scope.
- Newly supports documentation of files.
    - Comments at the beginning of files with `@file` tag are treated as the file documentation. (same as JSDoc)
- Newly supports almost all intrinsics added since version 2.14. (Perhaps some are still remaining.)
- Added a new command `extension.magmaNotebook.openLoadingResult`.
    - Previews execution contents of specified notebook cell.
- Added a new command `extension.magmaNotebook.exportToMarkdown`.
    - Exports contents of a notebook file as a markdown.
- Enabled to configure aliases of intrinsics with `MagmaLanguageSupport.intrinsicCompletionAliases`.
- Enabled treating an inline comment `// ...` or `/// ...` on the line immediately preceding a definition as documentation.
    - You can disable this feature with the configuration `MagmaLanguageSupport.useLastInlineCommentAsDoc`.
- Enabled index shifting when inserting a notebook cell.
- Enabled syntax highlighting on markdown code blocks.

## 0.4.0 - 2024-07-27

- Added outlines of definitions.
- Added hovers of `load` statements. (show links of loaded files)
- Fixed a bug not autocompleting `P<x> := ` and `a, b, c := `.
- Vim disabling feature got disabled as default.

## 0.3.1 - 2024-07-16

- Enabled getting output file paths as the environment variables `MAGMA_OUTPUT_FILE` and `MAGMA_ERROR_FILE` on the running Magma processes.

## 0.3.0 - 2024-07-16

- Added a new command `extension.magma.executeInBackground`.
    - Runs a magma code on the Magma distribution in background.
    - Outputs will be redirected to the specified files.
    - The processes will continue to run even after this extension is deactivated or this window is closed.
- Enabled removing some of outputs of notebook cells.
- Added a new setting `notebookOutputResultMode`.
    - Configures whether appends outputs of notebook cells by default.
- Newly supports a new comment statement `@append`, `@overwrite`. (only available in notebooks)
    - `@append` is the alias of `@appendResult`.

## 0.2.1 - 2024-07-14

- Fixed a bug that the statement `@export` does not work correctly.
- Fixed a bug not catching file read errors.

## 0.2.0 - 2024-07-14

- Newly supports other notebook file extensions `.imag`, `.icmag`, `.icmagma`.
- Newly supports type-specific setting `enableCompletion`.
- Added a new comment statement `@export`. (only available in non-notebook files)
- Added a new command `extension.magmaLoader.openLoadingResult`
- Added a new comment statement `@appendResult`. (only available in notebooks)
- Added documentation of suggestions.
- Fixed a bug that suggestions include intrinsics at `@require` statements in untitled files.
- Fixed a bug that the disabling Vim does not work. (perhaps be still incomplete?)

## 0.1.1 - 2024-07-11

- Modified CHANGELOG.md.

## 0.1.0 - 2024-07-11

- Enabled completions, hovering documentation and jumping definitions in untitled files/notebooks.
- Enabled loading in notebooks.
- Added an auto correction of the assign operation `:=`.
    - Auto corrects `:- `, `: =` and `: -` to `:=`.
- Added a completion of `forward`.

## 0.0.3 - 2024-07-09

- Fix problems that the tag `@param` which has invalid variable name and other tags are not highlighted.
- Enabled slicing when more than 100 files are loaded in `load` and `@require`.

## 0.0.2 - 2024-07-09

- Minor fix in documentation

## 0.0.1 - 2024-07-09

- Initial release
