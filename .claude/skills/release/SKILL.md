---
name: release
description: wk をリリースする手順。「リリースして」「タグを打って」「バージョンを上げて」と言われたら使う。
---

# リリース

タグを push すれば `.github/workflows/release.yaml` が走り、4 ターゲットのビルド・convco でのリリースノート生成・**draft** release の作成・packslip での署名まで済む。手でやるのはタグを打つことと、最後の publish だけ。

```bash
git switch main && git pull
v="v$(convco version --bump)"   # Conventional Commits から次バージョンを算出
git tag -a "$v" -m "$v"
git push origin "$v"
```

- タグは `v` 始まりにする。`on.push.tags` が `v*` にしか反応しない。
- `--bump` の判定を上書きするなら `convco version --minor` / `--major`、または `v=v1.1.0` と直に決める。
- 何がビルドされ何が添付されるかは `.github/workflows/release.yaml` を読む。

## publish の前に draft を確かめる

immutable releases が有効なので、publish した release のアセットは後から足せも消せもしない。publish の前に draft を見る。

```bash
gh release view "$v" --json isDraft,isPrerelease,assets,body
gh release download "$v" --pattern packslip.sigstore.json --dir "$(mktemp -d)"
```

- アセットは 4 つの tarball (`wk-{linux,darwin}-{x64,arm64}.tar.gz`) と `packslip.sigstore.json`。bundle が無ければ mise は入れられない。
- bundle の中の manifest で、各 artifact の os/arch/libc と bin (`wk`) が tarball の名前と合っているかを見る。
- リリースノート (`body`) が空でないか。
- **publish は人間がやる** — 中身を見せて判断を仰ぐ。

## プレリリース

```bash
v="v$(convco version --bump --prerelease rc)"   # 例: v2.0.0-rc.1
```

- タグに `-` を含むと、ワークフローが draft に `--prerelease` を付ける。mise はプレリリースを既定で選ばないので、利用者には完全一致の版 (`mise use packslip:github.com/844196/wk@2.0.0-rc.1`) で届く。
- 次の rc は同じコマンドで `rc.2` になる。rc を飛ばして正式版を出すときは `convco version --bump --ignore-prereleases` で、最後の正式版から数える。
- 正式版のタグで `convco changelog` が作るノートは、rc の分も含めて前の正式版からの差分になる。ワークフローは変えなくてよい。
