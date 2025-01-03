
# Change Log

## 0.7.1 - 2024-12-29

- Updated dependent modules to fix vulnerabilities.

## 0.7.0 - 2024-10-26

- New support for variable definitions in `@defined`.
- New support for definitions of function params (arguments).
- New support for signature help of functions.

## 0.6.1 - 2024-10-24

- Fixed a bug where the intrinsic `ParallelSort` was not suggested.
- Fixed a bug where the statement `@internal` in an inline comment was not suggested.
- Fixed a bug where a statement after `load` was included in an inline comment when using MamgaLoader.
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
