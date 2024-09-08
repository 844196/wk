<div align="center">
<p>&nbsp;</p>
<img src="https://github.com/user-attachments/assets/07e6f86c-9f5c-4716-a07a-140dcb38efca" />
<h1>wk</h1>
<small><i>:keyboard: which-key like menu for shell</i></small>
</div>

## :package: Installation

<https://github.com/844196/wk/releases>

## :gear: Configuration example (zsh)

```shell
# $ZDOTDIR/.zshrc

space-wk() {
  case $BUFFER in
    '')
      # Avoid cursor flickering
      echo -n $'\x1b[?25l\x1b[0`' >$TTY

      local res=''
      res=$(wk run --no-validation 2>&1)
      local wk_exit=$?

      zle redisplay

      case $wk_exit in
        0)
          # NOOP
          ;;
        1|2)
          # Abort, Timeout
          return
          ;;
        *)
          zle -M "wk: $res"
          return $wk_exit
          ;;
      esac

      res=("${(@ps:\t:)res}")

      if [[ "${res[(rb:2:)eval:*]}" == 'eval:true' ]]; then
        BUFFER=${(e)res[1]}
      else
        BUFFER=${res[1]}
      fi
      CURSOR=${#BUFFER}

      case "${res[(rb:2:)trigger:*]}" in
        trigger:ACCEPT)
          zle accept-line
          ;;
        trigger:COMPLETE)
          zle expand-or-complete
          ;;
      esac

      zle redisplay
      ;;

    *)
      zle self-insert
      ;;
  esac
}

zle -N space-wk
bindkey ' ' space-wk
```
