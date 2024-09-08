<div align="center">
<p>&nbsp;</p>
<img src="https://github.com/user-attachments/assets/07e6f86c-9f5c-4716-a07a-140dcb38efca" />
<h1>wk</h1>
<small><i>:keyboard: which-key like menu for shell</i></small>
</div>

## :package: Installation

1. Download the latest release and put into your `$PATH`:

   <https://github.com/844196/wk/releases/latest>

2. Activate in `$ZDOTDIR/.zshrc`:

   ```shell
   # Register a widget with the name "_wk_widget", and bind it to the ^G.
   eval "$(wk widget zsh)"
   ```

3. Restart zsh.

> [!TIP]
> If you want to change the trigger key, change it as follows:
>
> ```shell
> eval "$(wk widget zsh --bindkey '^T')"
> ```
>
> If you want to register only the widget, change it as follows:
>
> ```shell
> eval "$(wk widget zsh --no-bindkey)"
> ```

## :gear: Configuration

### Config

`${XDG_CONFIG_HOME:-$HOME/.config}/wk/config.yaml`

```yaml
---
timeout: 60000
symbols:
  prompt: "❯ "
colors:
  prompt: 8
  inputKeys:
    color: 8
    attrs: [dim]
  breadcrumb:
    color: 8
    attrs: [dim]
  lastInputKey:
    color: 6
    attrs: [underline]
  bindingKey: 5
  separator:
    color: 5
    attrs: [dim]
  group: 8
  bindingIcon: 8
  bindingDescription: 8
```

See [schemas/config.json](./schemas/config.json) for more details.

### Global bindings

`${XDG_CONFIG_HOME:-$HOME/.config}/wk/bindings.yaml`

```yaml
---
- key: g
  desc: Git
  type: bindings
  bindings:
    - key: p
      desc: Push/Pull
      type: bindings
      bindings:
        - key: return
          desc: git push
          type: command
          buffer: 'git push origin $(git symbolic-ref --short HEAD)'
          eval: true
        - key: f
          desc: git push -f
          type: command
          buffer: 'git push --force-with-lease --force-if-includes origin $(git symbolic-ref --short HEAD)'
          eval: true
        - key: l
          type: command
          buffer: 'git pull'
          accept: true
- key: y
  desc: Yank
  type: bindings
  bindings:
    - key: .
      desc: Copy $PWD
      type: command
      buffer: ' echo -ne "\e]52;c;$(base64 <(pwd | tee >$TTY | sed -z ''$s/\n$//''))\a"'
      accept: true
```

See [schemas/bindings.json](./schemas/bindings.json) for more details.

### Local bindings

`$PWD/wk.bindings.yaml`

```yaml
---
- key: m
  desc: Major
  type: bindings
  bindings:
    - key: b
      type: command
      buffer: 'npm run build'
      accept: true
    - key: l
      type: command
      buffer: 'npm run lint'
      accept: true
    - key: t
      type: command
      buffer: 'npm run test'
      accept: true
```
