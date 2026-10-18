<div align="center">
<p>&nbsp;</p>
<img src="https://github.com/user-attachments/assets/07e6f86c-9f5c-4716-a07a-140dcb38efca" />
<h1>wk</h1>
<small><i>:keyboard: which-key like menu for zsh</i></small>
</div>

## :package: Installation

1. Download the archive for your platform from the latest release and extract it:

   <https://github.com/844196/wk/releases/latest>

   ```shell
   tar xzf wk-x86_64-unknown-linux-gnu.tar.gz
   ```

   It holds the `wk` binary, the JSON Schemas for the configuration files, and the license.

2. Put the binary into your `$PATH`:

   ```shell
   install -m 755 wk-x86_64-unknown-linux-gnu/wk ~/.local/bin/
   ```

3. Activate in `$ZDOTDIR/.zshrc`:

   ```shell
   # Bind space as the leader key and comma as the major-leader key.
   # The major-prefix "m" is used for the major menu.
   eval "$(wk init --leader ' ' --major-leader ',' --major-prefix 'm')"
   ```

4. Restart zsh.

> [!TIP]
> If you want to register only the widgets, change it as follows:
>
> ```shell
> eval "$(wk init)"
> ```

## :gear: Configuration

wk reads two files of the same shape: a global one, and a local one in the working directory that
overrides it.

- Global: `${XDG_CONFIG_HOME:-$HOME/.config}/wk/config.yaml`
- Local: `$PWD/wk.yaml`

Either may also be named with `.yml`. If both exist in the same place, only the `.yaml` one is read.

Each file has two sections, `config:` and `bindings:`, and either may be left out. Any other key at
the top level is an error.

```yaml
# yaml-language-server: $schema=/path/to/wk-x86_64-unknown-linux-gnu/schemas/config.json
config:
  timeout: 60000
  symbols:
    prompt: '❯ '
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
bindings:
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

The modeline on the first line points your editor at the schema in the extracted archive, for
completion and validation. The same schema covers both files.

A `key` is the key to press. YAML reads an unquoted digit as a number, and wk reads it back as that
digit, so `key: 1` and `key: '1'` both bind the `1` key. Most punctuation needs no quoting either —
`key: .` above is one. YAML's indicator characters do, though: unquoted they are read as null or
rejected outright, so write `key: '~'` and `key: ':'`.

### Overriding per project

`$PWD/wk.yaml` is laid over the global file:

- `config:` is merged field by field, so the local file only needs the fields it changes. A colour is
  replaced whole, `attrs` included; `symbols.keys` is merged key by key.
- `bindings:` adds to the global bindings. A local binding replaces a global one with the same `key`
  entirely — a group is not merged with the global group it replaces.

The menu is sorted by key, wherever each binding was defined.

```yaml
config:
  colors:
    prompt: 5 # only in this project
bindings:
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
