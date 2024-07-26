
# MAGMA Language Support & IntelliSense

This extension adds language support and IntelliSense for [Magma computational algebra system](http://magma.maths.usyd.edu.au/magma/) to Visual Studio Code.

## Features

- Syntax highlighting
- Partial JSDoc support:
    - Function references provide hover widgets with documentation of their definitions.
    - Supports `@param`, `@returns`, `@example`.
- Go to Definition:
    - Load statements must be in the format `load "@/{path}";` or `load "@{alias}/{path}"`.
        - You cannot use `load "./{path}"` when hovering documentation or jumping to definitions.
        - `@/` of the path is treated as `./`.
        - `@{alias}/` of the path is treated as the path configured by `settings.json`.
    - The comment `// @defined intrinsics functionName();` configures a definition. (It does not actually define the function).
    - The comment `// @require "@/{path}";` configures a dependency. (It does not actually load the file).
        - You can use glob patterns in `@require` statements.
- Completions:
    - Suggests intrinsics.
    - Suggests defined functions.
    - Suggests `forward` statements.
    - Suggests file/directory names on `load`/`@require` statements.
    - Autocompletes the following statements (without suggestions):
        - `if ... end if;`
        - `for ... end for;`
        - `while ... end while;`
        - `case ... end case;`
        - `repeat ... until ...`
        - `try ... catch e ... end try;`
        - `function ... end function;`
        - `procedure ... end procedure;`
- Magma Calculator Notebooks
    - The file extensions `.imagma`, `.icmagma`, `.imag` and `.icmag` are available as the notebooks.
    - Executes at Magma Calculator.
    - Only the last code is executed. (Even when selecting the "Run All")
    - `// @use {cell index}` enables to load previous code blocks.
    - `// @append` or `// @overwrite` determines whether execute results are appended or overwritten.
        - You can specify the default mode by the setting `MagmaLanguageSupport.notebookOutputResultMode`.
    - Automatically disables [Vim Extension](https://marketplace.visualstudio.com/items?itemName=vscodevim.vim) on the notebooks.
- Execution on Magma
    - The command `extension.magma.executeInBackground`.
    - Runs a magma code on the Magma distribution in background.
    - Outputs will be redirected to the specified files.
    - The processes will continue to run even after this extension is deactivated or this window is closed.
    - You must configure the Magma path with the setting `MagmaLanguageSupport.magmaPath`.

## License

Licensed under the MIT License.
