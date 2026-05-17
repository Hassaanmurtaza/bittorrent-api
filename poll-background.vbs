Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Coffee Lake\Documents\GitHub\bittorrent-api"
WshShell.Run """C:\Users\Coffee Lake\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"" poller.js", 0, False
