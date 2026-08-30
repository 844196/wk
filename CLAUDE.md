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

静的チェックは `mise run check` にまとまっている。`VERSION` はgitignoreされた生成物で `wk.ts` がraw-importしているため、素の `deno check src/wk.ts` は `TS2307` で落ちる。型チェックは `mise run check:type` 経由で走らせる。依存の挙動を単発スクリプトで確かめるときは `deno run --config deno.jsonc <file>` — import map がここにあるので、渡さないと `@cliffy/*` が解決できずに落ちる。`src/main.ts` はキー入力ループを `Dependencies` で注入する形になっているが、まだ差し替え先が存在しない。

e2eテストが `e2e/` にある。`mise run e2e` でバイナリをビルドしてから走らせ、`mise run e2e:only` は `dist/` の既存バイナリをそのまま使う (パスを渡せば1ファイルだけ — `mise run e2e:only e2e/tests/06_widget.bats`)。`exec format error` は `WK_E2E_TARGET` とバイナリのアーキ不一致。Docker (zsh/tmux/bats-core、Denoは入れない) の中でbats-coreを回し、対象バイナリは `WK_BIN` で受け取る黒箱テスト。将来Denoをやめても受け入れ仕様として使い回せるよう、テスト側からDenoを参照しないこと。層は3つ — `script(1)` でptyを張ってCLIを直叩き (`helpers/common.bash` の `wk_run`)、TTY不要の `wk init`、tmuxで実zshウィジェットを動かす (`helpers/tmux.bash`)。ユニットテストは無い。

実行しての確認は `.claude/skills/run-wk/` の run-wk スキルにまとめてある。`driver.sh` が使い捨ての `HOME`/`XDG_CONFIG_HOME`/`ZDOTDIR` の中で、`keys` (pty直叩き)・`screen` (tmuxで描画)・`widget` (実zsh) の3層を叩き分ける。手で組み直す必要は無いので、そちらを読む。`wk init` が埋め込むパスは `Deno.execPath()` なので `deno run` 経由だとdeno自身のパスが入る — ウィジェットを見るならビルドしたバイナリで。

## コミット

Conventional Commits (convcoがcommit-msgフックで検証)。`git log` の大半は旧来のgitmoji形式なので真似しない。typeは `.versionrc` の一覧、scopeは `deps` と `ci` のみ許可。

`.github/workflows` を触ったらactionはSHA固定 (`mise run gha:pin`)。pre-commitの `gha:lint` が未固定を弾く。
