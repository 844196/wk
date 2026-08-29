# wk

zsh向けのwhich-keyライクメニュー。Deno製CLI (`src/wk.ts`) と、それが吐き出すzshウィジェット (`src/widget.eta`) の2層構成。

## runとwidget の契約

`wk run` はTUIを `/dev/tty` に描き、選ばれた結果だけを標準出力に出す。それを `_wk_widget` が読んで `BUFFER` へ差し込む。この受け渡しは `src/run.ts` と `src/widget.eta` の間の契約で、片方だけ変えると壊れる。

- 出力形式: 先頭1文字が区切り文字、以降はその区切り文字で連結された `buffer` + `key:value` 列 (`eval:true`, `accept:true` など)。区切り文字はbindingの `delimiter`、無ければconfigの `outputDelimiter`。
- 終了コード: 0成功/3中断/4タイムアウト/5未定義キー/6キーパース失敗。`widget.eta` の `case` がこれで分岐し、それ以外は `zle -M` でエラー表示に回る。
- エラー種別を増やすときは `src/errors.ts`・`run.ts` のcatch・`widget.eta` のcaseをセットで触る。

## binding/config のスキーマは 3 箇所にある

`key`/`desc`/`buffer` などのフィールドを増減させたら、次の3箇所を揃える。

- `src/types/Binding.ts`, `src/types/Context.ts` (型と既定値)
- `schemas/bindings.json`, `schemas/config.json` (ユーザー向けJSON Schema)
- `README.md` の設定例

## 検証

静的チェックは `mise run check` にまとまっている。`VERSION` はgitignoreされた生成物で `wk.ts` がraw-importしているため、素の `deno check src/wk.ts` は `TS2307` で落ちる。型チェックは `mise run check:type` 経由で走らせる。テストコードは無い。`src/main.ts` はキー入力ループを `Dependencies` で注入する形になっているが、まだ差し替え先が存在しない。

実行しての確認には制約がある。`wk run` は実ttyを要求するので、エージェントのシェルからは `open '/dev/tty'` で即エラーになる。挙動確認が要るときはユーザーに実端末で叩いてもらう。`--inputs 'g p f'` を渡せばキー入力を再現できる。`wk init` が埋め込むパスは `Deno.execPath()` なので、`deno run` 経由だとdeno自身のパスが入る。ウィジェットの実挙動を見るなら `mise run build` したバイナリを使う。

## コミット

Conventional Commits (convcoがcommit-msgフックで検証)。`git log` の大半は旧来のgitmoji形式なので真似しない。typeは `.versionrc` の一覧、scopeは `deps` と `ci` のみ許可。

`.github/workflows` を触ったらactionはSHA固定 (`mise run gha:pin`)。pre-commitの `gha:lint` が未固定を弾く。
