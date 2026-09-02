---
name: run-wk
description: Run wk against a throwaway config and see what it actually does. Use when building the binary, reproducing an exit code or the stdout protocol, screenshotting the menu rendering, or checking the zsh widget's BUFFER insertion.
---

# wk を動かす

入口は `.claude/skills/run-wk/driver.sh` ひとつ。CLAUDE.md の言う **契約** の両側 (`wk run` の stdout と `_wk_widget` の `BUFFER`) に、それぞれ対応する層がある。**触った層をその層のサブコマンドで叩く。**

| 触ったもの | 叩く層 |
|---|---|
| キー処理・出力形式・終了コード — `src/main.ts` `src/run.ts` | `keys` |
| 描画・色・記号・パンくず — `src/ui.ts` `src/tui.ts` | `screen` |
| ウィジェットと契約 — `src/widget.eta` `src/init.ts` | `widget` |

使い捨てサンドボックスと PID 単位の tmux ソケットで動くので、並行に走らせても干渉しない。パスはリポジトリルート相対。

**画面に出ているものが実体とは限らない — 以下この食い違いを 虚像 と呼ぶ。** 虚像 と印を付けた箇所では、見た目と「押すキー・選ばれる行・実バイト」がずれる。実体を取る手段は箇所ごとに違うので、各所に併記した。

driver はコンパイル済みバイナリだけを叩く。暗黙にビルドはしない。**ソースを変えたなら、変えたか怪しいときも、先に走らせる。**

```bash
./.claude/skills/run-wk/driver.sh build   # → dist/wk-x86_64-unknown-linux-gnu, 1 秒未満
```

`deno` は `mise install` で入るが、**`tmux` / `zsh` / `script(1)` はホスト依存**なので `screen` と `widget` の前に `command -v tmux zsh script pgrep`。

環境変数と終了コードの一覧、`driver:` 行の意味は driver.sh 冒頭コメント (引数なし実行でも出る)。以下はそれを読んでも分からないことだけ。

自作フィクスチャは**スクラッチパッド** (以下 `$SP`) に置く。`WK_BINDINGS` / `WK_CONFIG` / `WK_LOCAL_BINDINGS` は 3 層すべてに効く。config のフィクスチャは無いので自分で書く (部分指定でよい)。

## keys — プロトコルと終了コード

`script(1)` で pty を張って `wk run --inputs` を直叩きする。タブは `\t` にエスケープして出る。

```bash
$ ./.claude/skills/run-wk/driver.sh keys g p
exit:   0  (selected a command)
stdout: \t\tgit push
```

**1 つ目のフィールドは区切り文字そのもの**なので、buffer の前に区切り文字が 2 個並ぶ。`src/run.ts` が `[delimiter, buffer, ...].join(delimiter)` を出しており、1 個目はフィールドの中身、2 個目は join の区切り。受け側の `src/widget.eta` が `${res:2}` で捨てているのはこの 2 つ。末尾に改行が 1 個付く (`console.log` 由来、driver の `stdout:` 行では落としている)。

**`key:value` の並び順は保証しない。** `src/run.ts` は `...rest` を `Object.entries()` で回すが、その `rest` は zod が組み直したオブジェクトなので、schema が名前で持つ `eval` / `accept` が schema の順で先に出て、それ以外の追加フィールドがファイル順で続く (`accept` を先に書いても `eval:true accept:true` の順)。受け側は位置ではなく `key:` で引くこと — `src/widget.eta` の `reply[(rb:2:)eval:*]` がそうしている。**`false` も省略されない** — 出るかどうかを決めるのは値ではなくキーが YAML にあるかどうかで、`eval: false` は `eval:false` として出る (キーごと省いた場合とは別物)。

**区切り文字は、その buffer に出てこない 1 文字にする。** 受け側の `${(@ps:$delimiter:)...}` は buffer 内の同じ文字も境界として split するので、既定のタブのままだと `buffer: "echo a\tb"` は `BUFFER=[echo a]` になる。バインディング単位の `delimiter` (`src/schema.ts`、1 文字) はこのためにあるが、**与えれば直るのではなく、衝突しない文字を選んで初めて直る** — 同じ buffer に `delimiter: 'b'` を与えると今度は `BUFFER=[echo a<TAB>]` で切れる。config 全体の `outputDelimiter` ではなくバインディング単位で与えるのが正しい形。

既定フィクスチャの区切り文字はタブなので、`\t\t` を見ても「1 つ目のフィールドだから 2 個」なのか「buffer にタブがある」のか区別できない。撃ち分けるには `delimiter: '|'` を持つバインディングを `$SP` に置く (`stdout: ||echo hi|eval:true` のように先頭 2 文字も追従する)。生バイトは `TMPDIR=$SP WK_KEEP=1` で残るサンドボックスの `out` / `err` / `status` で見る (パスは stderr に出る)。

**特殊キーは `\xHH`。この綴りは 3 層とも通る。**

```bash
./.claude/skills/run-wk/driver.sh keys '\x1b'     # escape → exit: 3 (階層の途中でも 1 つ戻らず中断)
./.claude/skills/run-wk/driver.sh keys '\x20'     # スペースキー
```

**引数を省くとキーを一切送らない。** `config.yaml` の `timeout` を見るのはこの形。

## screen — メニューの描画

tmux ペインで走らせ、キーを 1 つ送るごとに `capture-pane` する。**TUI にとってのスクリーンショットはこれ。** 既定フィクスチャは 2 階層なので、`screen g` で出るパンくずは ` g` の 1 段だけ。**`»` で連なるところまで見るには `e2e/fixtures/nested.bindings.yaml`** (`g` → `p` → `f`)。

```bash
$ WK_BINDINGS=e2e/fixtures/nested.bindings.yaml ./.claude/skills/run-wk/driver.sh screen g p
=== after 'g' ===
 g
 p ➜ +Push
=== after 'p' ===
 g » p
 f ➜ Force
```

パンくずに並ぶのは desc ではなく**押したキー**。**`type: command` を選ぶと `wk run` が終了する = ペインも消える**ので、リーフまで降りると画面は残らない。これは成功で、出力は `keys` で見る。

画面に出る記号はどれも `config.yaml` の `symbols` で差し替えられる (`src/schema.ts` の `defaultContext`)。

| 画面上 | `symbols` のキー | 既定値 | 出る場所 |
|---|---|---|---|
| (不可視) | `prompt` | U+F460 | 各画面の 1 行目、パンくずの行頭 |
| `»` | `breadcrumb` | ` » ` | パンくずのキーとキーの間 |
| `➜` | `separator` | `➜` | キーと desc の間 |
| `+` | `group` | `+` | `type: bindings` の desc の頭 |
| `␣` など | `keys` | キーごとのマップ | **キーの描画そのもの。メニュー行とパンくずの両方に効く。** **虚像** — `keys: { g: "★" }` なら `★ ➜ +Git` と描かれるが、**押すキーは YAML の元のキーのまま** (`★` を送ると未定義キー = exit 5) |

**虚像 — メニュー 1 行目は空行ではない。** 既定のプロンプト記号は Nerd Font のグリフ U+F460 で `capture-pane` 越しにはほぼ見えず、上の ` g` の行頭も半角スペースではなくこのグリフ。画面待ちの grep はバインディング行に当てる。同定するなら `od -c` (`357 221 240` = U+F460、`302 273` = `»`)。

**虚像 — 描画そのものを見るなら既定の 80 桁で。** メニューの行が端末幅で折り返すと、次の再描画に前の画面が 1 行残る。wk が「前回描いた論理行数」だけカーソルを上げており、折り返しで増えた物理行を数えていないため。`WK_COLS` を絞ると再現する。

`timeout` のように**時間で消えるものは、キーごとの待ち (`WK_SETTLE`、既定 0.4 秒) より短ければ写らない。** 消えたのか出なかったのかは `keys` に流せば分かる (exit 4)。

driver が 125 で止まる 2 つのメッセージは意味が正反対で、**ペインが生きているか**と所要時間で見分ける。`wk exited before drawing a menu` はペインが死んでいて即座 — wk のクラッシュか即終了で、原因は「弾かれる入力・落ちる入力」の節のものと**ポーリング粒度 0.05 秒より短い `timeout`** (この場合は一度描いてから消しているので字面と実態がずれる)。`menu never appeared` はペインが生きたまま 5 秒 — wk は正常にキー待ちで、`keys <key>` を送れば応答する。

## widget — zsh の BUFFER まで

本物の zsh に `wk init` の出力を eval させ、リーダーキーから叩く。**契約が成立するのはこの層だけ。** `BUFFER` と `CURSOR` は画面ではなく `C-x` のダンプウィジェット経由で読む。

```bash
$ ./.claude/skills/run-wk/driver.sh widget g p
=== BUFFER ===
BUFFER=[git push] CURSOR=[8]
```

**展開はウィジェット側 (`${(e)reply[1]}`) の仕事で、`wk run` の stdout は常にリテラル。** `e` と `E` は同じ buffer `$WK_TEST_VAR` を持ち `eval: true` の有無だけが違う (値の `WK_TEST_VAR=expanded` はフィクスチャではなく driver の `.zshrc` 側にある)。`BUFFER=[] CURSOR=[0]` は「未定義キーで wk が終了し、ウィジェットが `BUFFER` に触らなかった」実値。

`accept: true` は既定でスタブに差し替わりコマンドは走らない。**`WK_REAL_ACCEPT=1` は本当に実行する** ので、buffer を読んで安全と分かっているバインディングにだけ使う。

**リーダーキーは既定では `BUFFER` が空のときしか効かない** (`_wk_self_insert_or_wk`)。`wk init --bind-global` で BUFFER の中身によらず発火し、そこで初めて `BUFFER="${LBUFFER}${reply[1]}${RBUFFER}"` の**カーソル位置への差し込み**が見える。`widget g p` 単体では `BUFFER` が空から始まるので、置換と差し込みの区別が付かない。

**`CURSOR` は差し込み位置ではなく常に行末。** `src/widget.eta` が差し込み直後に `CURSOR=${#BUFFER}` を無条件で走らせる。`WK_PRETYPE` は行末にしか置けない (生バイト送信なので矢印キーが送れない) ため、両者が一致してしまい撃ち分けにならない。カーソルを行の途中に置くには `WK_ZSHRC` で初期状態を作る。

```bash
$ cat > $SP/mid.zsh <<'ZSH'
_wk_mid() { BUFFER='echoZZ'; CURSOR=4 }
zle -N zle-line-init _wk_mid
ZSH
$ WK_BIND_GLOBAL=1 WK_ZSHRC=$SP/mid.zsh ./.claude/skills/run-wk/driver.sh widget x
BUFFER=[echoXZZ] CURSOR=[7]   # echo|ZZ の | に差し込まれ、CURSOR は 5 ではなく行末の 7
```

**`WK_PRETYPE` にリーダーキーと同じ文字が混じるなら、リーダーを制御キーに振り替える (`WK_LEADER='^O'`)。** pretype は生バイトなので、`WK_BIND_GLOBAL=1` の下では途中の 1 文字でもそこでメニューが開き、続く文字が wk のキーとして食われる。**消えるだけでは済まない** — 食われた文字が別のバインディングを引けば、その buffer が `BUFFER` に混入する。既定のリーダーは空白なので `WK_BIND_GLOBAL=1 WK_PRETYPE='echo 0123456789 abc'` は `a` が Accept を引き、driver は pretype 段のものとして別見出しで読み上げる。wk のバグに見えるが全部この罠。

**振り替え先が制御キーである必要がある。** wk は ctrl + 印字可能キーを黙って捨てる (`src/main.ts`) ので、`^O` なら開いたメニューに届いても何も起きない。印字可能な文字に振り替えると未定義キーで exit 5 になり、続くキーは素の zsh に自己挿入される。

**major リーダー (既定 `,`) は最上段を飛ばして `--major-prefix` (既定 `m`) のグループへ直接降りる。** driver が送るのは `WK_LEADER` のキーだけなので、major は `WK_PRETYPE` に載せる — リーダーより前に生バイトで届き、`BUFFER` が空なので `--bind-global` は要らない。ただしその後 driver が送るリーダーが**開いたままのメニューにキーとして食われる**ので、ここでもリーダーを制御キーに振り替える。

```bash
$ WK_LEADER='^O' WK_PRETYPE=',' ./.claude/skills/run-wk/driver.sh widget t
BUFFER=[make test] CURSOR=[9]
```

## 弾かれる入力・落ちる入力

**設定ファイルの不備は落ちずに exit 7 になる。** stderr は `<ファイル>: <パス>: <期待>` の 1 行で、パスが悪いフィールドまで案内する (`.../bindings.yaml: [0].bindings[0].key: expected a key name or a digit 0-9`)。`screen` からは `wk exited before drawing a menu` に見えるだけなので、**原因は `keys` に流して stderr を読む。** 配列でない `bindings.yaml`、`desc` の無い `type: bindings`、`bindings:` にスカラを置いたグループ、`buffer: 42`、`colors.prompt: {}`、`outputDelimiter: 42` — 描画時にスタックトレースを吐いていた入力は全部ここに畳まれている。グローバルとローカルで症状が変わることも無い。

**`key` はクォート無しの数字でも通る。** YAML が数値にした `0`〜`9` は wk が文字列に戻す。**クォートが要るのは YAML のインジケータ文字だけ** — `.` / `$` / `(` / `)` / `+` / `/` / `;` / `<` / `=` / `\` / `^` / `_` はそのまま通る。クォート無しだと `~` / `!` / `?` / `#` は null になって wk が弾き、`"` / `%` / `&` / `'` / `*` / `,` / `-` / `:` / `@` / `[` / `]` / `` ` `` / `{` / `}` は YAML 側の構文エラー、`>` / `|` はブロックスカラ扱いで空文字列になって wk が弾く。どれも exit 7 だが、構文エラーの文言だけパーサ由来。

**exit 1 で落ちるのは `--inputs ' '` だけ。** 空白 split の結果が空文字列 2 つになりキーコードパーサが落ちる。スペースキーは `\x20`。

**空ファイルは落ちない。** 空ドキュメント (0 バイト・改行だけ・空白だけ・コメントだけ・`---`・`null`・`~`) は `src/run.ts` の `loadYaml()` が不在ファイルと同じ扱いに畳む。bindings なら全キー未定義 = exit 5、config なら既定値。

**虚像 — `$PWD/wk.bindings.yaml` は `XDG_CONFIG_HOME` 側を上書きせず後ろに連結される。** 同じキーがあるとメニューには 2 行とも出るが、選ばれるのは先にある XDG 側で、ローカル側は表示だけされて到達不能になる。
