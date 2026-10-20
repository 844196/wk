---
name: run-wk
description: Run wk against a throwaway config and see what it actually does. Use when building the binary, reproducing an exit code or the stdout protocol, screenshotting the menu rendering, or checking the zsh widget's BUFFER insertion.
---

# wk を動かす

入口は `.claude/skills/run-wk/driver.sh` (パスはリポジトリルート相対)。CLAUDE.md の run と widget の契約を、変更した層に合わせて叩く。

| 触ったもの | サブコマンド | 見えるもの |
|---|---|---|
| キー処理・出力形式・終了コード — `src/main.ts` `src/run.ts` `src/output.ts` `src/config.ts` | `keys` | 終了コードと stdout/stderr |
| 描画・色・記号・パンくず — `src/ui.ts` `src/tui.ts` | `screen` | キーごとの画面 (TUI のスクリーンショット) |
| ウィジェット — `src/widget.eta` `src/init.ts` | `widget` | 実 zsh の `BUFFER` と `CURSOR` |

どの層も使い捨ての `HOME` / `XDG_CONFIG_HOME` / `ZDOTDIR` と PID ごとの tmux ソケットで動くので、自分の設定は混ざらず、並行に走らせても干渉しない。環境変数・終了コード・`driver:` 行の意味は driver.sh 冒頭のコメントにあり、引数なしで実行しても出る。

## 準備

driver は `dist/wk` を叩くだけでビルドはしない。ソースを触ったら毎回先にビルドする (1 秒かからない)。

```bash
./.claude/skills/run-wk/driver.sh build
command -v tmux zsh script pgrep   # screen と widget が使う。bun 以外はホスト側の用意
```

既定の設定は `e2e/fixtures/widget.yaml` (global の `config.yaml` として置かれる)。差し替えは `WK_CONFIG` (global) と `WK_LOCAL` (cwd の `wk.yaml`) で、3 層すべてに効く。自作の YAML はスクラッチパッド (以下 `$SP`) に置く。`config:` だけ試すなら `WK_LOCAL` に `config:` だけ書くと、既定フィクスチャのメニューを残したまま設定を重ねられる。

## keys — 出力と終了コード

`script(1)` の pty の下で `wk run --inputs` を叩く。終了コードは wk のものをそのまま返す (キー待ちのまま `WK_TIMEOUT` 秒経てば 124)。

```bash
$ ./.claude/skills/run-wk/driver.sh keys g p
exit:   0  (selected a command)
stdout: \t\tgit push
stderr:
```

stdout の読み方:

- タブは `\t` にエスケープして見せている。末尾の改行 1 個は落としている。
- 先頭に区切り文字が 2 個並ぶのが正常。1 個目は区切り文字を伝えるフィールド、2 個目は join の区切り。`widget.eta` の `${res:2}` がこの 2 文字を捨てる。
- `key:value` の順は YAML の順ではない。schema が名前で持つ `eval` → `accept` が先、それ以外の追加フィールドがファイル順で続く。受け側は位置ではなく `key:` で引く。
- `eval: false` も `eval:false` として出る。出るかどうかを決めるのはキーを書いたかどうか。
- 既定の区切り文字はタブなので、`\t\t` だけでは buffer 中のタブと見分けられない。`delimiter: '|'` のバインディングを置くと `||echo hi|eval:true` のように全体が追従して境界が見える。
- 生のバイトが要るなら `TMPDIR=$SP WK_KEEP=1` を付ける。残ったサンドボックス (パスは stderr) の `out` / `err` / `status` に入っている。

区切り文字は buffer に出てこない文字にする。受け側の `${(@ps:$delimiter:)...}` は buffer 中の同じ文字でも切るので、既定のタブのまま `buffer: "echo a\tb"` を出すと `BUFFER=[echo a]` になる。バインディング単位の `delimiter` で、buffer と衝突しない文字を選ぶ。

特殊キーは `\xHH` で書く。この書き方は 3 層とも通じる。

```bash
./.claude/skills/run-wk/driver.sh keys '\x1b'    # escape → exit 3。階層の途中でも 1 段戻らず中断する
./.claude/skills/run-wk/driver.sh keys '\x20'    # スペースキー
./.claude/skills/run-wk/driver.sh keys           # キーを送らない。config.timeout を見るとき
```

`keys ' '` (空白そのもの) は exit 1 で落ちる。`--inputs` を空白で split すると空文字列が 2 つでき、キーパーサが例外を出すため。スペースキーは `\x20` で送る。

## screen — メニューの描画

tmux ペインで `wk run` を起動し、キーを 1 つ送るたびに `capture-pane` を出す。既定フィクスチャは 2 階層しかないので、パンくずが ` » ` で連なるところは `e2e/fixtures/nested.yaml` (`g` → `p` → `f`) で見る。

```bash
$ WK_CONFIG=e2e/fixtures/nested.yaml ./.claude/skills/run-wk/driver.sh screen g p
=== menu ===

 d ➜ +Docker
 g ➜ +Git
 l ➜ List
=== after 'g' ===
 g
 p ➜ +Push
 y ➜ Pull
=== after 'p' ===
 g » p
 f ➜ Force
```

- パンくずに並ぶのは desc ではなく押したキー。
- `type: command` を選ぶと wk が終了してペインも消えるので、リーフまで降りた後の画面は無い (`(wk exited — ...)` と出る)。選んだ結果は `keys` で見る。
- 1 行目は空行に見えるが、既定のプロンプト記号 U+F460 (Nerd Font のグリフ) が描かれている。パンくず行の頭もこの記号で、半角スペースではない。画面を grep するならバインディングの行を狙う。記号を確かめるなら `od -c` (`357 221 240` = U+F460、`302 273` = `»`)。
- 画面の記号は `config.symbols` の `prompt` / `breadcrumb` / `separator` / `group` / `keys` で差し替えられる (既定値は `src/schema.ts`)。`keys` は描き方を変えるだけで、押すキーは YAML の `key` のまま。`keys: { g: "★" }` なら `★ ➜ +Git` と描かれるが、送るべきは `g` で、`★` を送ると exit 5。
- 描画を確かめるときは既定の 80 桁で走らせる。行が端末幅で折り返すと、次の再描画で前の画面の行が残る (wk は前回描いた論理行の数だけカーソルを戻し、折り返しで増えた物理行を数えていない)。`WK_COLS=12` で再現する。
- `config.timeout` のように時間で消えるものは、キーごとの待ち `WK_SETTLE` (既定 0.4 秒) より短ければ画面に写らない。消えたのか出なかったのかは `keys` に流して exit 4 かどうかで確かめる。

driver が exit 125 で止まるときのメッセージは 2 種類あり、意味は逆になる:

- `wk exited before drawing a menu` — すぐ返る。wk がクラッシュしたか即座に終了した。設定エラー (exit 7) もここに来る。同じ設定を `keys` に流して stderr を読む。
- `menu never appeared` — 5 秒かかる。wk は生きていてキーを待っている。

## widget — zsh の BUFFER まで

本物の zsh に `wk init` の出力を eval させてリーダーキーから叩く。契約が両側そろって動くのはこの層だけ。`BUFFER` と `CURSOR` は画面からではなく、`C-x` に割り当てたダンプ用ウィジェットで読む。

```bash
$ ./.claude/skills/run-wk/driver.sh widget g p
...
=== BUFFER ===
BUFFER=[git push] CURSOR=[8]
```

- 既定フィクスチャの `e` と `E` は同じ buffer `$WK_TEST_VAR` で、違いは `eval: true` の有無だけ。`e` は `BUFFER=[expanded]`、`E` は `BUFFER=[$WK_TEST_VAR]`。値 `expanded` はフィクスチャではなく driver が書く `.zshrc` が定義している。展開するのはウィジェット (`${(e)reply[1]}`) で、`wk run` の stdout はいつもリテラル。
- `BUFFER=[] CURSOR=[0]` は、wk が未定義キーで終了してウィジェットが `BUFFER` に触れなかったときの値。
- `accept: true` は既定ではスタブ (`=== BUFFER (via accept-widget) ===`) に差し替わり、コマンドは走らない。`WK_REAL_ACCEPT=1` を付けると本当に実行されるので、buffer を読んで安全だと分かったバインディングにだけ使う。

### 途中に差し込む

リーダーは既定では `BUFFER` が空のときだけ反応する (`_wk_self_insert_or_wk`)。カーソル位置への差し込み `BUFFER="${LBUFFER}...${RBUFFER}"` を見るには `WK_BIND_GLOBAL=1` (`wk init --bind-global`) で、空でない行からリーダーを効かせる。

差し込みの後、`CURSOR` はいつも行末に移る (`widget.eta` の `CURSOR=${#BUFFER}`)。`WK_PRETYPE` は生のバイトを送るだけで矢印キーを送れず、カーソルは行末にしか置けない。それでは差し込み位置と行末が一致して区別できないので、カーソルを行の途中に置くときは `WK_ZSHRC` で初期状態を作る:

```bash
$ cat > $SP/mid.zsh <<'ZSH'
_wk_mid() { BUFFER='echoZZ'; CURSOR=4 }
zle -N zle-line-init _wk_mid
ZSH
$ WK_BIND_GLOBAL=1 WK_ZSHRC=$SP/mid.zsh ./.claude/skills/run-wk/driver.sh widget x
...
BUFFER=[echoXZZ] CURSOR=[7]   # echo|ZZ の位置に入り、CURSOR は 5 ではなく行末の 7
```

### WK_PRETYPE とリーダーの衝突

`WK_PRETYPE` は生のバイトとして届く。`WK_BIND_GLOBAL=1` の下でリーダーと同じ文字 (既定は空白) が含まれていると、そこでメニューが開き、続く文字を wk がキーとして読む。たとえば `WK_PRETYPE='echo 0123456789 abc'` は `echo` の後の空白でメニューが開き、`0` が未定義キーになる (`wk: "0" is undefined`)。wk のバグに見えるが、原因は pretype の文字。

対策はリーダーを制御キーに替えること (`WK_LEADER='^O'`)。wk は ctrl + 印字可能キーを読み捨てる (`src/main.ts`) ので、`^O` が開いているメニューに届いても何も起きない。印字可能な文字に替えた場合は、メニューに届いた時点で未定義キーとして exit 5 になる。

major リーダー (既定 `,`) は最上段を飛ばして `--major-prefix` (既定 `m`) のグループに直接入る。driver が送るのは `WK_LEADER` だけなので、major リーダーは `WK_PRETYPE` に載せる。`BUFFER` は空なので `--bind-global` は要らない。ただし後から driver が送るリーダーが開いたメニューに届くので、ここでもリーダーを制御キーに替える:

```bash
$ WK_LEADER='^O' WK_PRETYPE=',' ./.claude/skills/run-wk/driver.sh widget t
...
BUFFER=[make test] CURSOR=[9]
```

## 設定ファイルを試すとき

受け付ける形とエラーの書式は CLAUDE.md のスキーマの節にある。driver から見て分かりにくいことだけ書く:

- 設定エラーは exit 7 と stderr の 1 行 (`.../config.yaml: bindings[0].bindings[0].key: expected a key name or a digit 0-9`)。`screen` では `wk exited before drawing a menu` としか出ないので `keys` で読む。v1 形式 (トップレベルの `timeout:` など) も `unknown field "timeout"` でここに来る。
- 空のファイル (0 バイト、コメントだけ、`---`、`null` など) はファイルが無いのと同じ扱いになる。global も local も空ならすべてのキーが未定義で exit 5。
- 同じ場所に `config.yaml` と `config.yml` があれば `.yaml` だけを読み、`.yml` は壊れていても黙って無視する。`.yml` を直しても効かないときはこれを疑う。v1 の `bindings.yaml` / `wk.bindings.yaml` も読まれず、エラーも出ないままメニューが空になる。
- local の `bindings:` は、同じキーを持つ global のバインディングをグループごと置き換える (中の bindings は混ざらない)。1 つのファイルの中で同じキーが重なったら、先に書いた方だけが表示され、選ばれるのもそちら。
