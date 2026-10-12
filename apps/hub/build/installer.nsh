; Cadence Hub installer: an extra page to pick the Cadence apps. The choices
; are written to "%APPDATA%\Cadence Hub\install-on-first-run.txt", and the hub
; installs them (from GitHub releases) when it starts. Silent installs (/S)
; skip the page and write nothing.

!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

; The page exists only in the installer (this file is also read when the
; uninstaller is built, where unused functions would be an error).
!ifndef BUILD_UNINSTALLER

Var CadenceAppsDialog
Var CadencePlusBox
Var CadenceVideoBox
Var CadenceWantPlus
Var CadenceWantVideo

!macro customPageAfterChangeDir
  Page custom CadenceAppsPage CadenceAppsLeave
!macroend

Function CadenceAppsPage
  !insertmacro MUI_HEADER_TEXT "Choose your apps" "Cadence Hub installs these for you, free. You can add or remove apps later."
  nsDialogs::Create 1018
  Pop $CadenceAppsDialog
  ${If} $CadenceAppsDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 20u "Cadence Hub downloads the latest version of each app you tick from the project's GitHub releases, installs it and keeps it up to date."
  Pop $0
  ${NSD_CreateCheckbox} 0 30u 100% 12u "Cadence+  —  image editing: photos, layers, retouching, camera RAW, PSD"
  Pop $CadencePlusBox
  ${NSD_CreateCheckbox} 0 48u 100% 12u "Cadence Video  —  video editing: timeline, colour grading, audio mixing"
  Pop $CadenceVideoBox
  ; Remember choices when going Back and forth; tick both the first time.
  ${If} $CadenceWantPlus == ""
    StrCpy $CadenceWantPlus ${BST_CHECKED}
    StrCpy $CadenceWantVideo ${BST_CHECKED}
  ${EndIf}
  ${NSD_SetState} $CadencePlusBox $CadenceWantPlus
  ${NSD_SetState} $CadenceVideoBox $CadenceWantVideo
  ${NSD_CreateLabel} 0 72u 100% 20u "An app that has no release yet is installed automatically as soon as its first version comes out."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function CadenceAppsLeave
  ${NSD_GetState} $CadencePlusBox $CadenceWantPlus
  ${NSD_GetState} $CadenceVideoBox $CadenceWantVideo
FunctionEnd
!endif

!macro customInstall
  ${If} $CadenceWantPlus == ${BST_CHECKED}
  ${OrIf} $CadenceWantVideo == ${BST_CHECKED}
    CreateDirectory "$APPDATA\Cadence Hub"
    FileOpen $0 "$APPDATA\Cadence Hub\install-on-first-run.txt" w
    ${If} $CadenceWantPlus == ${BST_CHECKED}
      FileWrite $0 "plus$\r$\n"
    ${EndIf}
    ${If} $CadenceWantVideo == ${BST_CHECKED}
      FileWrite $0 "video$\r$\n"
    ${EndIf}
    FileClose $0
  ${EndIf}
!macroend
