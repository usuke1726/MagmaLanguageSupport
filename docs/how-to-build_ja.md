
# ビルド方法

本拡張機能はまだリリースをしておらず，現段階で拡張機能を利用するにはビルドが必要である．その方法を以下に紹介する．

1. 事前に[Node.js](https://nodejs.org/en)をインストールしておく．
1. リポジトリをダウンロードする．
    - `git clone https://github.com/usuke1726/MagmaLanguageSupport.git` を実行，あるいはGitHubサイトの `<> Code` ボタンから 「Download ZIP」をクリック
    - ダウンロードしたら，そのディレクトリに移動しておく．
1. `npm install` を実行．
    - `node_modules` フォルダが作成されればOK．
    - `deprecated` 関連の警告が出力されるかもしれないが，これは無視してOK．
1. `npx vsce package` を実行． 
    - `magma-language-support-0.0.1.vsix` ファイルが作成されればOK．
1. Visual Studio Code を開き，コマンドパレットを開く．(デフォルトのキーバインドは `ctrl+shift+P` )
1. `vsix` と入力し，候補に現れた 「拡張機能: VSIX からのインストール」 (「Extensions: Install from VSIX」)をクリックし，先ほどの `.vsix` ファイルを選択
1. インストール完了！

