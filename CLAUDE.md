# wk

zsh向けのwhich-keyライクメニュー。Bun製CLI (`src/wk.ts`) と、それが吐き出すzshウィジェット (`src/widget.eta`) の2層構成。

## runとwidget の契約

`wk run` はTUIを `/dev/tty` に描き、選ばれた結果だけを標準出力に出す。それを `_wk_widget` が読んで `BUFFER` へ差し込む。この受け渡しは `src/run.ts` (出力の組み立ては `src/output.ts` の `formatOutput`) と `src/widget.eta` の間の契約で、片方だけ変えると壊れる。

- 出力形式: 先頭1文字が区切り文字、以降はその区切り文字で連結された `buffer` + `key:value` 列 (`eval:true`, `accept:true` など)。区切り文字はbindingの `delimiter`、無ければconfigの `outputDelimiter`。
- 終了コード: 0成功/3中断/4タイムアウト/5未定義キー/6キーパース失敗/7設定ファイル不正。`widget.eta` の `case` がこれで分岐し、それ以外は `zle -M` でエラー表示に回る。
- エラー種別を増やすときは `src/errors.ts`・`run.ts` のcatch・`widget.eta` のcaseをセットで触る。

## スキーマは `src/schema.ts` が SSoT

`key`/`desc`/`buffer` などのフィールドを増減させたら、触るのは `src/schema.ts` と `README.md` の設定例だけ。

- `src/schema.ts` — `zod/mini` のスキーマ。型 (`Binding`/`Command`/`Context`/`Color`) は `z.infer` で導出、既定値は `z._default`/`z.prefault` が持ち、`defaultContext` は `ContextSchema.parse({})`。手書きの型定義は無い。
- 設定ファイルはglobalの `$XDG_CONFIG_HOME/wk/config.ya?ml` とlocalの `$PWD/wk.ya?ml` の2つで、どちらも `FileSchema` (`config:` + `bindings:`、トップレベルはstrict) の同じ形。`.yaml` があれば `.yml` は読まない。読み込みと重ね合わせは `src/config.ts` の `loadConfig` で、localの `config:` は `mergeContext` でフィールド単位に重ね、既定値はマージの後で `resolveContext` が埋める — 各ファイルの段階で埋めるとlocalの既定値がglobalの値を消す。
- 配布用JSON Schemaはコミットしていない。`mise run generate:schemas` が両ファイル共通の `dist/schemas/config.json` を吐き、`mise run dist <name>` が `dist/wk` と一緒にリリースtarball (`<name>/{wk,LICENSE,schemas/}`) に詰める。生成は `io: 'input'` — ユーザーが書ける形を出す。
- `zod/mini` はロケールを積まないので、`error` を渡し忘れた検査は `Invalid input` になる。フィールドを足したら必ず `expected(...)` を渡し、既存の入力を一通り流して `Invalid input` が出ないことを見る。
- 設定エラーは `<ファイル>: <パス>: <期待>` の1行で exit 7。パスはzodのissueの `path` から `bindings[0].bindings[0].key` / `config.colors.prompt` の形に組む。
- `key` は文字列だが、YAMLがクォート無しの数字を数値にするため `0`〜`9` の整数も受けて `String()` で正規化する。クォートが要るのはYAMLのインジケータ文字だけ (null・空文字列になるか構文エラー) で、`.` のような大半の記号はそのまま通る。

## 検証

静的チェックは `mise run check` にまとまっている — biomeのformatとlint (warningも落とす) と、TypeScript 7の `tsc`。biomeは `mise.toml` のtools、`tsc` は `package.json` のdevDependenciesから入る。`widget.eta` は `with { type: 'text' }` で読み込み、`bun build --compile` が文字列として埋め込む (`tsc` 向けの型は `src/text-imports.d.ts`)。`--version` が出すバージョンとビルド日時は、`mise run build <target>` が `bun build --define` で `BUILD_VERSION` (環境変数 `$BUILD_VERSION`、無ければ `unknown`) と `BUILD_TIME` (ビルド時のUTC) に埋め込む。型宣言は `src/build-constants.d.ts` にあり、`--define` 無しの `bun src/wk.ts` では未定義なので `src/wk.ts` が `typeof` で確かめて `unknown` に倒す。依存の挙動を単発スクリプトで確かめるときはリポジトリ内で `bun <file>`。依存を足す前に、Bun (`Bun.YAML`・`Bun.stringWidth`・`Bun.color` など) と `node:` の組み込みで足りないかを見る。YAMLのパース、色、表の描画、XDGのパスは組み込みと自前のコードで賄っている。依存はnpmにあるものはnpmから `bun add --exact`、cliffy のようにJSRにしか無いものは `bunx jsr add --bun` (`.npmrc` の `@jsr:registry` 経由、`bun add jsr:…` は動かない) で足す。npm.jsr.io が生成する `@cliffy/keypress` の型定義は `[Symbol.asyncIterator]` を落とすので、`src/tui.ts` に cast がある。CIは `bun install --frozen-lockfile` なので `bun.lock` も一緒にコミットする。`src/wk.ts` 末尾の `process.exit(0)` は、cliffy の keypress が `process.stdin` に残すリスナーでプロセスが終わらなくなるのを断つためのもの — 消すと widget の e2e が timeout する。`src/main.ts` はキー入力ループを `Dependencies` で注入する形になっていて、`src/main.test.ts` が偽の `keypress` を渡している。

e2eテストが `e2e/` にある。`mise run e2e` でバイナリをビルドしてから走らせ、`mise run e2e:only` は `dist/` の既存バイナリをそのまま使う (パスを渡せば1ファイルだけ — `mise run e2e:only e2e/tests/06_widget.bats`)。`exec format error` は `WK_E2E_TARGET` とバイナリのアーキ不一致。Docker (zsh/tmux/bats-core、ランタイムは入れない) の中でbats-coreを回し、対象バイナリは `WK_BIN` で受け取る黒箱テスト。ランタイムを替えても受け入れ仕様として使い回せるよう、テスト側からBunを参照しないこと。層は3つ — `script(1)` でptyを張ってCLIを直叩き (`helpers/common.bash` の `wk_run`)、TTY不要の `wk init`、tmuxで実zshウィジェットを動かす (`helpers/tmux.bash`)。

単体・統合テストはVitestで、対象モジュールの隣に `src/<module>.test.ts` として置く。`mise run test` (watchは `mise run test:watch`) で走り、CIでは `check`・`e2e` と別の `test` ジョブ。中身は `bun --bun vitest` — `--bun` 無しだとVitestがNodeで動き、`Bun.YAML` などで `Bun is not defined` になる。`widget.eta` の text import は `vitest.config.ts` の小さなプラグインが文字列にしている。純粋関数や一時ディレクトリで確かめられること (スキーマのエラー文言、設定ファイルの読み込み・マージ・並び順、出力形式、描画、キー入力ループ、偽の `Tty` を渡した `TUI`) はVitestに書き、e2eはプロセス境界の契約 (終了コード・stdoutの形式・設定ファイルの探索・TTY・zshウィジェット) の代表ケースを受け持つ。

実行しての確認は `.claude/skills/run-wk/` の run-wk スキルにまとめてある。`driver.sh` が使い捨ての `HOME`/`XDG_CONFIG_HOME`/`ZDOTDIR` の中で、`keys` (pty直叩き)・`screen` (tmuxで描画)・`widget` (実zsh) の3層を叩き分ける。手で組み直す必要は無いので、そちらを読む。`wk init` が埋め込むパスは `process.execPath` なので `bun run` 経由だとbun自身のパスが入る — ウィジェットを見るならビルドしたバイナリで。

## コミット

Conventional Commits (convcoがcommit-msgフックで検証)。`git log` の大半は旧来のgitmoji形式なので真似しない。

typeは `.versionrc` の一覧、scopeは `deps` と `ci` のみ許可。
コーディングエージェント関係の Markdown (e.g. `CLAUDE.md`, `SKILL.md`) の追加・変更・削除は wk を使うユーザーには関係がないため `chore` として扱うこと。

`.github/workflows` を触ったらactionはSHA固定 (`mise run gha:pin`)。pre-commitの `gha:lint` が未固定を弾く。
