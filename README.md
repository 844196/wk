<div align="center">
  <p>&nbsp;</p>

  <img src="https://github.com/user-attachments/assets/510d7972-bae9-4775-ab7c-00a6acbc1db5" />

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
      tput cub 9999

      local res=''
      res=$(wk --no-validation 2>&1)
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
