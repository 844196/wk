---
name: release
description: wk をリリースする手順。「リリースして」「タグを打って」「バージョンを上げて」と言われたら使う。
---

# リリース

タグを push すれば `.github/workflows/release.yaml` が走り、4 ターゲットのビルド・convco でのリリースノート生成・**draft** release の作成まで済む。手でやるのはタグを打つことと、最後の publish だけ。

```bash
git switch main && git pull
v="v$(convco version --bump)"   # Conventional Commits から次バージョンを算出
git tag -a "$v" -m "$v"
git push origin "$v"
```

- タグは `v` 始まりにする。`on.push.tags` が `v*` にしか反応しない。
- `--bump` の判定を上書きするなら `convco version --minor` / `--major`、または `v=v1.1.0` と直に決める。
- push 後 Releases に draft が出る。**publish は人間がやる** — 中身を見せて判断を仰ぐ。
- 何がビルドされ何が添付されるかは `.github/workflows/release.yaml` を読む。
